import { Router } from "express";
import { z } from "zod";
import { StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { daysUntilExpiry } from "../utils/stock";
import { config } from "../utils/config";
import { logAudit } from "../services/audit";
import { decrementBatchOrThrow } from "../utils/stockGuards";
import { refreshExpiredBatches, quarantineBatch } from "../services/batchLifecycle";

const router = Router();
router.use(authenticate, requireFacility);

const expiryView   = requirePermission("expiry", "view");
const expiryEdit   = requirePermission("expiry", "edit");
const expiryApprove = requirePermission("expiry", "approve");

router.get("/alerts", expiryView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const categoryId = req.query.categoryId as string | undefined;
    const facilityFilter = req.query.facilityFilter as string | undefined;
    const withinDaysParam = req.query.withinDays as string | undefined;
    const statusFilter = (req.query.status as string) || "all";

    // Keep the persisted batch lifecycle in step: flip newly-expired ACTIVE batches
    // to EXPIRED before reporting, so expired stock is consistently unavailable.
    await refreshExpiredBatches(facilityFilter || facilityId);

    const withinDays =
      withinDaysParam === "all" || !withinDaysParam
        ? null
        : parseInt(withinDaysParam, 10);

    const where: {
      facilityId?: string;
      quantity: { gt: number };
      medicine?: { categoryId?: string; isActive: boolean };
    } = {
      quantity: { gt: 0 },
      medicine: { isActive: true, ...(categoryId ? { categoryId } : {}) },
    };
    if (facilityFilter) where.facilityId = facilityFilter;
    else if (facilityId) where.facilityId = facilityId;

    const batches = await prisma.stockBatch.findMany({
      where,
      include: {
        medicine: { include: { category: true } },
        facility: true,
      },
      orderBy: { expiryDate: "asc" },
    });

    const categorized = batches
      .map((b) => {
        const days = daysUntilExpiry(b.expiryDate);
        let severity: "ok" | "warning" | "critical" | "expired" = "ok";
        if (days < 0) severity = "expired";
        else if (days <= config.expiryCriticalDays) severity = "critical";
        else if (days <= config.expiryWarningDays) severity = "warning";

        return { ...b, daysUntilExpiry: days, severity };
      })
      .filter((b) => {
        if (withinDays !== null && !Number.isNaN(withinDays)) {
          if (b.daysUntilExpiry > withinDays) return false;
        } else if (statusFilter === "default") {
          if (b.severity === "ok") return false;
        }

        if (statusFilter === "expired") return b.severity === "expired";
        if (statusFilter === "critical") return b.severity === "critical";
        if (statusFilter === "warning") return b.severity === "warning";
        if (statusFilter === "ok") return b.severity === "ok";
        return true;
      });

    const categoryAnalytics: Record<string, { count: number; quantity: number; critical: number }> = {};
    const facilityAnalytics: Record<string, { count: number; quantity: number; name: string }> = {};

    for (const b of categorized) {
      const catName = b.medicine.category?.name ?? "Uncategorized";
      if (!categoryAnalytics[catName]) categoryAnalytics[catName] = { count: 0, quantity: 0, critical: 0 };
      categoryAnalytics[catName].count++;
      categoryAnalytics[catName].quantity += b.quantity;
      if (b.severity === "critical" || b.severity === "expired") categoryAnalytics[catName].critical++;

      const facName = b.facility.name;
      if (!facilityAnalytics[facName]) facilityAnalytics[facName] = { count: 0, quantity: 0, name: facName };
      facilityAnalytics[facName].count++;
      facilityAnalytics[facName].quantity += b.quantity;
    }

    const recommendations = categorized
      .filter((b) => b.severity === "critical" || b.severity === "warning")
      .slice(0, 10)
      .map((b) => ({
        medicineId: b.medicineId,
        medicineName: b.medicine.medicineName,
        batchNumber: b.batchNumber,
        facility: b.facility.name,
        daysUntilExpiry: b.daysUntilExpiry,
        quantity: b.quantity,
        recommendation:
          b.severity === "critical"
            ? `Urgent: Transfer or dispense ${b.medicine.medicineName} (${b.batchNumber}) before expiry`
            : `Consider redistribution of ${b.quantity} units to facilities with higher demand`,
      }));

    res.json({
      filters: {
        withinDays: withinDaysParam ?? "all",
        categoryId: categoryId ?? null,
        facilityFilter: facilityFilter ?? null,
        status: statusFilter,
      },
      total: categorized.length,
      batches: categorized,
      categoryAnalytics: Object.entries(categoryAnalytics).map(([category, stats]) => ({
        category,
        ...stats,
      })),
      facilityAnalytics: Object.values(facilityAnalytics),
      recommendations,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/redistribution", expiryApprove, async (_req, res, next) => {
  try {
    const batches = await prisma.stockBatch.findMany({
      where: { quantity: { gt: 0 } },
      include: { medicine: { include: { category: true } }, facility: true },
    });

    const recommendations = batches
      .map((b) => {
        const days = daysUntilExpiry(b.expiryDate);
        if (days > config.expiryWarningDays || days < 0) return null;
        return {
          batch: b,
          daysUntilExpiry: days,
          fromFacility: b.facility,
          recommendation: `Surplus near-expiry ${b.medicine.medicineName} (${b.batchNumber}) — consider transfer`,
        };
      })
      .filter(Boolean);

    res.json(recommendations);
  } catch (e) {
    next(e);
  }
});

const expiredSchema = z.object({
  medicineId: z.string(),
  batchNumber: z.string(),
  expiryDate: z.string(),
  quantity: z.number().positive(),
  disposalMethod: z.string(),
  disposalWitness: z.string().optional(),
  facilityId: z.string().optional(),
});

router.post("/record-expired", expiryEdit, async (req, res, next) => {
  try {
    const data = expiredSchema.parse(req.body);
    const facilityId = data.facilityId ?? getFacilityId(req);
    if (!facilityId) return res.status(400).json({ error: "Facility is required" });
    const userId = req.user!.userId;

    const batch = await prisma.stockBatch.findUnique({
      where: {
        medicineId_facilityId_batchNumber: {
          medicineId: data.medicineId,
          facilityId,
          batchNumber: data.batchNumber,
        },
      },
    });

    // Disposal removes physical stock and writes the EXPIRED ledger entry + the
    // disposal record atomically, and transitions the batch to DISPOSED when emptied.
    const deduct = batch ? Math.min(batch.quantity, data.quantity) : 0;

    const record = await prisma.$transaction(async (tx) => {
      if (batch && deduct > 0) {
        // Conditional decrement — disposal can never drive the batch negative.
        await decrementBatchOrThrow(tx, batch.id, deduct, `batch ${data.batchNumber}`);
        const fresh = await tx.stockBatch.findUnique({ where: { id: batch.id } });
        await tx.stockBatch.update({
          where: { id: batch.id },
          data: (fresh?.quantity ?? 0) <= 0
            ? { status: "DISPOSED", disposedAt: new Date() }
            : { status: "QUARANTINED", quarantinedAt: batch.quarantinedAt ?? new Date() },
        });
      }

      const created = await tx.expiredMedicineRecord.create({
        data: {
          facilityId,
          medicineId: data.medicineId,
          batchNumber: data.batchNumber,
          expiryDate: new Date(data.expiryDate),
          quantity: data.quantity,
          disposalMethod: data.disposalMethod,
          disposalWitness: data.disposalWitness ?? null,
          processedById: userId,
        },
      });

      await tx.stockTransaction.create({
        data: {
          facilityId,
          medicineId: data.medicineId,
          batchId: batch?.id,
          type: StockTransactionType.EXPIRED,
          quantity: -deduct,
          reason: `Disposal: ${data.disposalMethod}`,
          performedById: userId,
        },
      });
      return created;
    });

    await logAudit({
      facilityId,
      userId,
      action: "DISPOSAL",
      entityType: "ExpiredMedicine",
      entityId: record.id,
      details: {
        medicineId: data.medicineId,
        batchNumber: data.batchNumber,
        quantityDisposed: deduct,
        quantityRecorded: data.quantity,
        disposalMethod: data.disposalMethod,
        disposalWitness: data.disposalWitness ?? null,
      },
    });
    res.status(201).json(record);
  } catch (e) {
    next(e);
  }
});

const quarantineSchema = z.object({
  batchId: z.string().min(1),
  reason: z.string().trim().min(1, "A quarantine reason is required"),
});

// POST /quarantine — place a batch on hold (ACTIVE|EXPIRED → QUARANTINED), making
// it unavailable for dispensing/transfer pending disposal or release.
router.post("/quarantine", expiryEdit, async (req, res, next) => {
  try {
    const data = quarantineSchema.parse(req.body);
    await quarantineBatch({ batchId: data.batchId, userId: req.user!.userId, reason: data.reason });
    const batch = await prisma.stockBatch.findUnique({ where: { id: data.batchId } });
    res.json(batch);
  } catch (e) {
    if (e instanceof Error && e.message === "Batch not found") {
      return res.status(404).json({ error: "Batch not found" });
    }
    next(e);
  }
});

router.get("/disposal-history", expiryView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const records = await prisma.expiredMedicineRecord.findMany({
      where: facilityId ? { facilityId } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    // Augment with medicine names
    const medicineIds = [...new Set(records.map((r) => r.medicineId))];
    const medicines = await prisma.medicine.findMany({
      where: { id: { in: medicineIds } },
      select: { id: true, medicineName: true },
    });
    const medMap = Object.fromEntries(medicines.map((m) => [m.id, m.medicineName]));
    res.json(records.map((r) => ({ ...r, medicineName: medMap[r.medicineId] ?? "Unknown" })));
  } catch (e) {
    next(e);
  }
});

export default router;
