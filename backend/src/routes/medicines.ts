import { Router } from "express";
import { z } from "zod";
import { StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { logAudit } from "../services/audit";
import { logChangeHistory } from "../services/changeHistory";
import {
  daysUntilExpiry,
  getMedicineBalance,
  getBatchSupplyTotals,
  periodStart,
  INBOUND_TYPES,
  OUTBOUND_TYPES,
} from "../utils/stock";
import { config } from "../utils/config";

const router = Router();
router.use(authenticate);

const medicineView   = requirePermission("medicines", "view");
const medicineCreate = requirePermission("medicines", "create");
const medicineEdit   = requirePermission("medicines", "edit");
const medicineDelete = requirePermission("medicines", "delete");

const namePattern = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 \-/]*$/;
const dosageFormOtherPattern = /^(?=.*[A-Za-z])[A-Za-z0-9][A-Za-z0-9 -]*$/;
const normalizeText = (value?: string | null) => value?.trim() || undefined;
const normalizeStrengths = (strengths?: string[]) => {
  const seen = new Set<string>();
  return (strengths ?? [])
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .filter((strength) => {
      const key = strength.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const thresholdSchema = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
  z.number().int("Stock Threshold must be a whole number").min(0).default(50)
);

const medicineSchema = z.object({
  medicineName: z.string().trim().min(1).regex(namePattern, "Medicine Name must be alphanumeric"),
  genericName: z
    .string()
    .trim()
    .regex(namePattern, "Generic Name must be alphanumeric")
    .optional()
    .or(z.literal("")),
  dosageForm: z.string().trim().min(1, "Dosage Form is required"),
  dosageFormOther: z
    .string()
    .trim()
    .regex(dosageFormOtherPattern, "Dosage form must be alphanumeric")
    .optional()
    .nullable()
    .or(z.literal("")),
  strength: z.string().trim().optional().or(z.literal("")),
  strengths: z.array(z.string()).optional(),
  reorderThreshold: thresholdSchema,
  leadTimeDays: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    z.number().int().min(1, "Lead Days must be greater than 0")
  ),
  minimumOrderLevel: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    z.number().int().min(1, "Minimum Order Level must be greater than 0")
  ),
  categoryId: z.string().min(1),
});

function isIvfMedicine(data: { medicineName: string; genericName?: string | null; dosageForm?: string | null }) {
  const haystack = `${data.medicineName} ${data.genericName ?? ""} ${data.dosageForm ?? ""}`.toLowerCase();
  return /\bivf\b|iv fluid|iv-fluid|intravenous fluid|normal saline|ringer|dextrose/.test(haystack);
}

async function validateCategory(categoryId: string, medicine: { medicineName: string; genericName?: string | null; dosageForm?: string | null }) {
  const category = await prisma.medicineCategory.findFirst({
    where: { id: categoryId, isActive: true, deletedAt: null },
  });
  if (!category) return { error: "Invalid category" };
  if (category.name.toLowerCase().includes("antibiotic") && isIvfMedicine(medicine)) {
    return { error: "IVF medicines must not be categorized under Antibiotics" };
  }
  return { category };
}

async function assertUnique(medicineName: string, strength: string | null, excludeId?: string) {
  const existing = await prisma.medicine.findFirst({
    where: {
      medicineName: { equals: medicineName, mode: "insensitive" },
      ...(strength
        ? { strength: { equals: strength, mode: "insensitive" } }
        : {}),
      isActive: true,
      deletedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  return !existing;
}

function medicineInclude() {
  return {
    category: true,
    strengths: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" as const }, { strength: "asc" as const }] },
  };
}

router.get("/deleted", medicineDelete, async (_req, res, next) => {
  try {
    const medicines = await prisma.medicine.findMany({
      where: { OR: [{ isActive: false }, { deletedAt: { not: null } }] },
      include: medicineInclude(),
      orderBy: { medicineName: "asc" },
    });
    res.json(medicines);
  } catch (e) {
    next(e);
  }
});

router.get("/suggestions", async (req, res, next) => {
  try {
    const q = ((req.query.q as string) || "").trim();
    const limit = Math.min(Number(req.query.limit) || 8, 12);
    if (q.length < 2) return res.json([]);
    const needle = q.toLowerCase();

    const medicines = await prisma.medicine.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        OR: [
          { medicineName: { contains: q, mode: "insensitive" } },
          { genericName: { contains: q, mode: "insensitive" } },
          { dosageForm: { contains: q, mode: "insensitive" } },
          { strength: { contains: q, mode: "insensitive" } },
          { strengths: { some: { strength: { contains: q, mode: "insensitive" }, isActive: true } } },
          { category: { name: { contains: q, mode: "insensitive" } } },
        ],
      },
      include: medicineInclude(),
      orderBy: [{ medicineName: "asc" }],
      take: 40,
    });

    const suggestions: {
      id: string;
      medicineName: string;
      genericName: string | null;
      dosageForm: string | null;
      categoryName: string | null;
      label: string;
      strength: string | null;
      score: number;
    }[] = [];

    const scoreSuggestion = (label: string, medicine: { medicineName: string; genericName: string | null; category?: { name: string } | null }, strength?: string | null) => {
      const values = {
        label: label.toLowerCase(),
        name: medicine.medicineName.toLowerCase(),
        generic: medicine.genericName?.toLowerCase() ?? "",
        strength: strength?.toLowerCase() ?? "",
        category: medicine.category?.name.toLowerCase() ?? "",
      };
      if (values.label === needle || values.name === needle || values.strength === needle) return 100;
      if (values.label.startsWith(needle) || values.name.startsWith(needle)) return 90;
      if (values.generic.startsWith(needle)) return 80;
      if (values.strength.startsWith(needle)) return 75;
      if (values.category.startsWith(needle)) return 65;
      if (values.label.includes(needle) || values.name.includes(needle)) return 55;
      if (values.generic.includes(needle) || values.strength.includes(needle) || values.category.includes(needle)) return 45;
      return 0;
    };

    for (const medicine of medicines) {
      const strengths = medicine.strengths.length ? medicine.strengths : medicine.strength ? [{ strength: medicine.strength }] : [];
      const base = {
        id: medicine.id,
        medicineName: medicine.medicineName,
        genericName: medicine.genericName,
        dosageForm: medicine.dosageForm,
        categoryName: medicine.category?.name ?? null,
      };
      if (!strengths.length) {
        suggestions.push({ ...base, label: medicine.medicineName, strength: null, score: scoreSuggestion(medicine.medicineName, medicine) });
      } else {
        suggestions.push({ ...base, label: medicine.medicineName, strength: null, score: scoreSuggestion(medicine.medicineName, medicine) });
        for (const s of strengths) {
          // Skip if the medicine name already contains this strength (avoids "Amoxicillin 250mg 250mg")
          const strengthLower = s.strength.toLowerCase();
          const nameLower = medicine.medicineName.toLowerCase();
          if (nameLower.endsWith(strengthLower) || nameLower.includes(` ${strengthLower}`)) continue;
          const label = `${medicine.medicineName} ${s.strength}`;
          suggestions.push({ ...base, label, strength: s.strength, score: scoreSuggestion(label, medicine, s.strength) });
        }
      }
    }

    res.json(
      suggestions
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
        .slice(0, limit)
        .map(({ score, ...suggestion }) => suggestion)
    );
  } catch (e) {
    next(e);
  }
});

router.get("/recent-changes", medicineView, async (_req, res, next) => {
  try {
    const logs = await prisma.auditLog.findMany({
      where: { entityType: { in: ["Medicine", "MedicineCategory"] } },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(
      logs.map((log) => {
        const details = log.details as { medicineName?: string; name?: string } | null;
        return {
          id: log.id,
          entityId: log.entityId,
          entityType: log.entityType,
          recordName: details?.medicineName ?? details?.name ?? "Record",
          changeType:
            log.action === "CREATE"
              ? "Created"
              : log.action === "UPDATE"
                ? "Updated"
                : log.action === "SOFT_DELETE"
                  ? "Deleted"
                  : log.action === "RESTORE"
                    ? "Restored"
                    : log.action,
          changedBy: log.user ? `${log.user.firstName} ${log.user.lastName}`.trim() || log.user.email : "System",
          createdAt: log.createdAt,
          canRestore: log.action === "SOFT_DELETE" && !!log.entityId,
        };
      })
    );
  } catch (e) {
    next(e);
  }
});

router.get("/", medicineView, async (req, res, next) => {
  try {
    const q = (req.query.q as string) || "";
    const categoryId = req.query.categoryId as string | undefined;
    const pageParam = req.query.page as string | undefined;

    const where = {
      isActive: true,
      deletedAt: null,
      ...(categoryId ? { categoryId } : {}),
      OR: q
        ? [
            { medicineName: { contains: q, mode: "insensitive" as const } },
            { genericName: { contains: q, mode: "insensitive" as const } },
            { dosageForm: { contains: q, mode: "insensitive" as const } },
            { strength: { contains: q, mode: "insensitive" as const } },
            { strengths: { some: { strength: { contains: q, mode: "insensitive" as const }, isActive: true } } },
            { category: { name: { contains: q, mode: "insensitive" as const } } },
          ]
        : undefined,
    };
    const orderBy = [{ category: { name: "asc" as const } }, { medicineName: "asc" as const }];

    if (pageParam !== undefined) {
      const page = Math.max(1, parseInt(pageParam, 10) || 1);
      const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string, 10) || 50));
      const [total, data] = await Promise.all([
        prisma.medicine.count({ where }),
        prisma.medicine.findMany({ where, include: medicineInclude(), orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      ]);
      return res.json({ data, total, page, pageSize });
    }

    const medicines = await prisma.medicine.findMany({
      where,
      include: medicineInclude(),
      orderBy,
      take: 500,
    });
    res.json(medicines);
  } catch (e) {
    next(e);
  }
});

router.post("/", medicineCreate, async (req, res, next) => {
  try {
    const parsed = medicineSchema.parse(req.body);
    const resolvedDosageForm = normalizeText(parsed.dosageForm);
    const data = {
      medicineName: parsed.medicineName,
      genericName: normalizeText(parsed.genericName),
      dosageForm: resolvedDosageForm,
      dosageFormOther: resolvedDosageForm === "Other" ? (normalizeText(parsed.dosageFormOther ?? undefined) ?? null) : null,
      reorderThreshold: parsed.reorderThreshold,
      leadTimeDays: parsed.leadTimeDays,
      minimumOrderLevel: parsed.minimumOrderLevel,
      categoryId: parsed.categoryId,
    };
    const rawStrengths = normalizeStrengths(parsed.strengths?.length ? parsed.strengths : parsed.strength ? [parsed.strength] : []);
    if (rawStrengths.length === 0) {
      return res.status(400).json({ error: "Strength is required" });
    }
    const strength = rawStrengths[0];

    const categoryCheck = await validateCategory(data.categoryId, data);
    if ("error" in categoryCheck) return res.status(400).json({ error: categoryCheck.error });

    if (!(await assertUnique(data.medicineName, strength))) {
      return res.status(409).json({ error: "A medicine with this name and strength already exists" });
    }

    const medicine = await prisma.medicine.create({
      data: {
        ...data,
        strength,
        unitType: "units",
        strengths: { create: [{ strength, sortOrder: 0 }] },
      },
      include: medicineInclude(),
    });

    await logChangeHistory({
      facilityId: req.user!.facilityId,
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "Medicine",
      entityId: medicine.id,
      entityName: medicine.medicineName,
      currentValues: {
        medicineName: medicine.medicineName,
        genericName: medicine.genericName,
        dosageForm: medicine.dosageForm,
        dosageFormOther: medicine.dosageFormOther,
        reorderThreshold: medicine.reorderThreshold,
        leadTimeDays: medicine.leadTimeDays,
        minimumOrderLevel: medicine.minimumOrderLevel,
        categoryId: medicine.categoryId,
        strength,
      },
      changeDetails: `Created medicine: ${medicine.medicineName} ${strength}`,
    });

    res.status(201).json(medicine);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", medicineEdit, async (req, res, next) => {
  try {
    const parsed = medicineSchema.partial().parse(req.body);
    const existing = await prisma.medicine.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!existing) return res.status(404).json({ error: "Medicine not found" });

    const resolvedDosageForm = parsed.dosageForm !== undefined ? normalizeText(parsed.dosageForm) : existing.dosageForm;
    const nextMedicine = {
      medicineName: parsed.medicineName ?? existing.medicineName,
      genericName: parsed.genericName !== undefined ? normalizeText(parsed.genericName) : existing.genericName,
      dosageForm: resolvedDosageForm,
      dosageFormOther: parsed.dosageFormOther !== undefined
        ? (resolvedDosageForm === "Other" ? (normalizeText(parsed.dosageFormOther ?? undefined) ?? null) : null)
        : existing.dosageFormOther,
      categoryId: parsed.categoryId ?? existing.categoryId,
    };
    if (!nextMedicine.categoryId) return res.status(400).json({ error: "Please select a category" });

    const categoryCheck = await validateCategory(nextMedicine.categoryId, nextMedicine);
    if ("error" in categoryCheck) return res.status(400).json({ error: categoryCheck.error });

    const rawStrengths = normalizeStrengths(parsed.strengths?.length ? parsed.strengths : parsed.strength ? [parsed.strength] : []);
    const updateStrengths = parsed.strengths !== undefined || parsed.strength !== undefined;
    const newStrength = rawStrengths.length > 0 ? rawStrengths[0] : null;
    const effectiveStrength = updateStrengths ? newStrength : existing.strength;

    if (!(await assertUnique(nextMedicine.medicineName, effectiveStrength, existing.id))) {
      return res.status(409).json({ error: "A medicine with this name and strength already exists" });
    }

    // Capture previous values for audit trail
    const previousValues = {
      medicineName: existing.medicineName,
      genericName: existing.genericName,
      dosageForm: existing.dosageForm,
      dosageFormOther: existing.dosageFormOther,
      reorderThreshold: existing.reorderThreshold,
      leadTimeDays: existing.leadTimeDays,
      minimumOrderLevel: existing.minimumOrderLevel,
      categoryId: existing.categoryId,
    };

    const medicine = await prisma.$transaction(async (tx) => {
      if (updateStrengths) {
        await tx.medicineStrength.deleteMany({ where: { medicineId: existing.id } });
      }
      return tx.medicine.update({
        where: { id: existing.id },
        data: {
          medicineName: nextMedicine.medicineName,
          genericName: nextMedicine.genericName,
          dosageForm: nextMedicine.dosageForm,
          dosageFormOther: nextMedicine.dosageFormOther,
          reorderThreshold: parsed.reorderThreshold ?? existing.reorderThreshold,
          leadTimeDays: parsed.leadTimeDays ?? existing.leadTimeDays,
          minimumOrderLevel: parsed.minimumOrderLevel ?? existing.minimumOrderLevel,
          categoryId: nextMedicine.categoryId,
          ...(updateStrengths && newStrength
            ? {
                strength: newStrength,
                strengths: { create: [{ strength: newStrength, sortOrder: 0 }] },
              }
            : {}),
        },
        include: medicineInclude(),
      });
    });

    // Calculate what changed
    const currentValues = {
      medicineName: medicine.medicineName,
      genericName: medicine.genericName,
      dosageForm: medicine.dosageForm,
      dosageFormOther: medicine.dosageFormOther,
      reorderThreshold: medicine.reorderThreshold,
      leadTimeDays: medicine.leadTimeDays,
      minimumOrderLevel: medicine.minimumOrderLevel,
      categoryId: medicine.categoryId,
    };

    const changedFields = Object.keys(currentValues).filter(
      (key) => previousValues[key as keyof typeof previousValues] !== currentValues[key as keyof typeof currentValues]
    );

    await logChangeHistory({
      facilityId: req.user!.facilityId,
      userId: req.user!.userId,
      action: "UPDATE",
      entityType: "Medicine",
      entityId: medicine.id,
      entityName: medicine.medicineName,
      previousValues,
      currentValues,
      changeDetails: changedFields.length > 0 ? `Modified: ${changedFields.join(", ")}` : undefined,
    });

    res.json(medicine);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", medicineDelete, async (req, res, next) => {
  try {
    const medicine = await prisma.medicine.findFirst({ where: { id: req.params.id, deletedAt: null } });
    if (!medicine) return res.status(404).json({ error: "Medicine not found" });

    const updated = await prisma.medicine.update({
      where: { id: medicine.id },
      data: { isActive: false, deletedAt: new Date(), deletedById: req.user!.userId },
      include: medicineInclude(),
    });

    await logChangeHistory({
      facilityId: req.user!.facilityId,
      userId: req.user!.userId,
      action: "SOFT_DELETE",
      entityType: "Medicine",
      entityId: updated.id,
      entityName: updated.medicineName,
      previousValues: { isActive: true, deletedAt: null },
      currentValues: { isActive: false, deletedAt: new Date() },
      changeDetails: "Soft-deleted medicine",
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/restore", medicineDelete, async (req, res, next) => {
  try {
    const medicine = await prisma.medicine.findUnique({ where: { id: req.params.id } });
    if (!medicine) return res.status(404).json({ error: "Medicine not found" });
    if (!(await assertUnique(medicine.medicineName, medicine.strength, medicine.id))) {
      return res.status(409).json({ error: "Cannot restore: an active medicine with this name and strength already exists" });
    }
    const restored = await prisma.medicine.update({
      where: { id: medicine.id },
      data: { isActive: true, deletedAt: null, deletedById: null },
      include: medicineInclude(),
    });

    await logChangeHistory({
      facilityId: req.user!.facilityId,
      userId: req.user!.userId,
      action: "RESTORE",
      entityType: "Medicine",
      entityId: restored.id,
      entityName: restored.medicineName,
      previousValues: { isActive: false, deletedAt: medicine.deletedAt },
      currentValues: { isActive: true, deletedAt: null },
      changeDetails: "Restored soft-deleted medicine",
    });

    res.json(restored);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/detail", medicineView, async (req, res, next) => {
  try {
    const medicineId = req.params.id;
    const facilityId = getFacilityId(req, req.query.facilityId as string);

    const medicine = await prisma.medicine.findUnique({
      where: { id: medicineId },
      include: medicineInclude(),
    });
    if (!medicine) return res.status(404).json({ error: "Medicine not found" });

    const batchWhere = facilityId ? { medicineId, facilityId } : { medicineId };

    const [batches, transactions, dispensingRecords] = await Promise.all([
      prisma.stockBatch.findMany({
        where: batchWhere,
        include: { facility: true },
        orderBy: { expiryDate: "asc" },
      }),
      prisma.stockTransaction.findMany({
        where: { medicineId, ...(facilityId ? { facilityId } : {}) },
        include: { facility: true, batch: true, performedBy: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.dispensingRecord.findMany({
        where: { medicineId, ...(facilityId ? { facilityId } : {}) },
        include: { patient: true, healthcareWorker: true, facility: true },
        orderBy: { dispensedAt: "desc" },
        take: 30,
      }),
    ]);

    const sumQty = (types: StockTransactionType[], since: Date, fid?: string) =>
      prisma.stockTransaction.aggregate({
        where: {
          medicineId,
          type: { in: types },
          createdAt: { gte: since },
          ...(fid ? { facilityId: fid } : {}),
        },
        _sum: { quantity: true },
      });

    const [inDaily, inWeekly, inMonthly, outDaily, outWeekly, outMonthly] = await Promise.all([
      sumQty(INBOUND_TYPES, periodStart(1), facilityId ?? undefined),
      sumQty(INBOUND_TYPES, periodStart(7), facilityId ?? undefined),
      sumQty(INBOUND_TYPES, periodStart(30), facilityId ?? undefined),
      sumQty(OUTBOUND_TYPES, periodStart(1), facilityId ?? undefined),
      sumQty(OUTBOUND_TYPES, periodStart(7), facilityId ?? undefined),
      sumQty(OUTBOUND_TYPES, periodStart(30), facilityId ?? undefined),
    ]);

    const batchSupply30 = await getBatchSupplyTotals(
      batches.map((b) => b.id),
      periodStart(30)
    );
    const batchSupplyAll = await getBatchSupplyTotals(batches.map((b) => b.id));

    const abs = (n: number | null | undefined) => Math.abs(n ?? 0);

    const expiryInsights = {
      expired: batches.filter((b) => daysUntilExpiry(b.expiryDate) < 0),
      expiringSoon: batches.filter((b) => {
        const d = daysUntilExpiry(b.expiryDate);
        return d >= 0 && d <= config.expiryCriticalDays;
      }),
      warning: batches.filter((b) => {
        const d = daysUntilExpiry(b.expiryDate);
        return d > config.expiryCriticalDays && d <= config.expiryWarningDays;
      }),
      healthy: batches.filter((b) => daysUntilExpiry(b.expiryDate) > config.expiryWarningDays),
    };

    const facilityUsage = await prisma.stockTransaction.groupBy({
      by: ["facilityId"],
      where: {
        medicineId,
        type: { in: OUTBOUND_TYPES },
        createdAt: { gte: periodStart(90) },
      },
      _sum: { quantity: true },
    });

    const facilities = await prisma.facility.findMany({
      where: { id: { in: facilityUsage.map((f) => f.facilityId) } },
    });

    const facilityUsageMap = facilityUsage.map((f) => ({
      facility: facilities.find((x) => x.id === f.facilityId),
      totalOutbound: abs(f._sum.quantity),
    }));

    let balance: number | null = null;
    if (facilityId) balance = await getMedicineBalance(medicineId, facilityId);

    const outboundActivities = await prisma.stockTransaction.findMany({
      where: {
        medicineId,
        type: { in: OUTBOUND_TYPES },
        ...(facilityId ? { facilityId } : {}),
      },
      include: {
        facility: true,
        batch: true,
        performedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 40,
    });

    res.json({
      medicine,
      balance,
      batches: batches.map((b) => ({
        ...b,
        daysUntilExpiry: daysUntilExpiry(b.expiryDate),
        severity:
          daysUntilExpiry(b.expiryDate) < 0
            ? "expired"
            : daysUntilExpiry(b.expiryDate) <= config.expiryCriticalDays
              ? "critical"
              : daysUntilExpiry(b.expiryDate) <= config.expiryWarningDays
                ? "warning"
                : "healthy",
        inbound30d: batchSupply30[b.id]?.inbound ?? 0,
        outbound30d: batchSupply30[b.id]?.outbound ?? 0,
        inboundTotal: batchSupplyAll[b.id]?.inbound ?? 0,
        outboundTotal: batchSupplyAll[b.id]?.outbound ?? 0,
      })),
      stockAnalytics: {
        inbound: {
          daily: abs(inDaily._sum.quantity),
          weekly: abs(inWeekly._sum.quantity),
          monthly: abs(inMonthly._sum.quantity),
        },
        outbound: {
          daily: abs(outDaily._sum.quantity),
          weekly: abs(outWeekly._sum.quantity),
          monthly: abs(outMonthly._sum.quantity),
        },
      },
      expiryInsights,
      transactions,
      dispensingRecords,
      outboundActivities: outboundActivities.map((tx) => ({
        id: tx.id,
        activityType: tx.type,
        quantity: Math.abs(tx.quantity),
        batchNumber: tx.batch?.batchNumber ?? null,
        facility: tx.facility.name,
        performedBy: tx.performedBy
          ? `${tx.performedBy.firstName} ${tx.performedBy.lastName}`
          : null,
        notes: tx.notes,
        reason: tx.reason,
        createdAt: tx.createdAt,
      })),
      facilityUsage: facilityUsageMap.sort((a, b) => b.totalOutbound - a.totalOutbound),
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/category", medicineEdit, async (req, res, next) => {
  try {
    const { categoryId } = z.object({ categoryId: z.string() }).parse(req.body);
    const medicine = await prisma.medicine.findUnique({ where: { id: req.params.id } });
    if (!medicine) return res.status(404).json({ error: "Medicine not found" });

    const categoryCheck = await validateCategory(categoryId, medicine);
    if ("error" in categoryCheck) return res.status(400).json({ error: categoryCheck.error });

    const updated = await prisma.medicine.update({
      where: { id: req.params.id },
      data: { categoryId },
      include: medicineInclude(),
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// Change History & Recovery Endpoints
router.get("/:id/change-history", medicineView, async (req, res, next) => {
  try {
    const medicineId = req.params.id;
    const changes = await prisma.auditLog.findMany({
      where: {
        entityId: medicineId,
        entityType: "Medicine",
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = changes.map((log) => {
      const details = log.details as {
        name?: string;
        previousValues?: Record<string, unknown>;
        currentValues?: Record<string, unknown>;
        changeDetails?: string;
      } | null;

      return {
        id: log.id,
        timestamp: log.createdAt,
        action: log.action,
        actionLabel:
          log.action === "CREATE"
            ? "Created"
            : log.action === "UPDATE"
              ? "Updated"
              : log.action === "SOFT_DELETE"
                ? "Deleted"
                : log.action === "RESTORE"
                  ? "Restored"
                  : log.action,
        changedBy: log.user
          ? `${log.user.firstName} ${log.user.lastName}`.trim() || log.user.email
          : "System",
        changedByEmail: log.user?.email,
        previousValues: details?.previousValues,
        currentValues: details?.currentValues,
        changeDetails: details?.changeDetails,
      };
    });

    res.json(formatted);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/previous-version/:changeId", medicineView, async (req, res, next) => {
  try {
    const { id: medicineId, changeId } = req.params;

    const change = await prisma.auditLog.findUnique({
      where: { id: changeId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!change || change.entityId !== medicineId || change.entityType !== "Medicine") {
      return res.status(404).json({ error: "Change not found" });
    }

    const details = change.details as {
      previousValues?: Record<string, unknown>;
      currentValues?: Record<string, unknown>;
    } | null;

    res.json({
      change: {
        id: change.id,
        timestamp: change.createdAt,
        action: change.action,
        changedBy: change.user
          ? `${change.user.firstName} ${change.user.lastName}`.trim() || change.user.email
          : "System",
      },
      previousVersion: details?.previousValues,
      currentVersion: details?.currentValues,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
