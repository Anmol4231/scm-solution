import { Router } from "express";
import { z } from "zod";
import { StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireRoles } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { UserRole } from "@prisma/client";
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

router.get("/", async (req, res, next) => {
  try {
    const q = (req.query.q as string) || "";
    const categoryId = req.query.categoryId as string | undefined;

    const medicines = await prisma.medicine.findMany({
      where: {
        isActive: true,
        ...(categoryId ? { categoryId } : {}),
        OR: q
          ? [
              { medicineName: { contains: q, mode: "insensitive" } },
              { genericName: { contains: q, mode: "insensitive" } },
            ]
          : undefined,
      },
      include: { category: true },
      orderBy: [{ category: { sortOrder: "asc" } }, { medicineName: "asc" }],
    });
    res.json(medicines);
  } catch (e) {
    next(e);
  }
});

const medicineSchema = z.object({
  medicineName: z.string().min(1),
  genericName: z.string().optional(),
  dosageForm: z.string().optional(),
  strength: z.string().optional(),
  unitType: z.string().default("tablets"),
  reorderThreshold: z.number().min(0).default(50),
  categoryId: z.string().min(1),
});

router.post(
  "/",
  requireRoles(
    UserRole.STOREKEEPER,
    UserRole.PHARMACIST,
    UserRole.NURSE_ADMIN,
    UserRole.PROVINCIAL_MANAGER
  ),
  async (req, res, next) => {
    try {
      const data = medicineSchema.parse(req.body);

      const category = await prisma.medicineCategory.findUnique({
        where: { id: data.categoryId },
      });
      if (!category?.isActive) {
        return res.status(400).json({ error: "Invalid category" });
      }

      const existing = await prisma.medicine.findFirst({
        where: { medicineName: { equals: data.medicineName, mode: "insensitive" }, isActive: true },
      });
      if (existing) {
        return res.status(409).json({ error: "A medicine with this name already exists" });
      }

      const medicine = await prisma.medicine.create({
        data,
        include: { category: true },
      });
      await logAudit({
        facilityId: req.user!.facilityId,
        userId: req.user!.userId,
        action: "CREATE",
        entityType: "Medicine",
        entityId: medicine.id,
        details: { medicineName: medicine.medicineName, category: category.name },
      });
      res.status(201).json(medicine);
    } catch (e) {
      next(e);
    }
  }
);

router.get("/:id/detail", async (req, res, next) => {
  try {
    const medicineId = req.params.id;
    const facilityId = getFacilityId(req, req.query.facilityId as string);

    const medicine = await prisma.medicine.findUnique({
      where: { id: medicineId },
      include: { category: true },
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

    const now = new Date();
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

router.patch(
  "/:id/category",
  requireRoles(
    UserRole.STOREKEEPER,
    UserRole.PHARMACIST,
    UserRole.NURSE_ADMIN,
    UserRole.PROVINCIAL_MANAGER
  ),
  async (req, res, next) => {
    try {
      const { categoryId } = z.object({ categoryId: z.string() }).parse(req.body);
      const medicine = await prisma.medicine.update({
        where: { id: req.params.id },
        data: { categoryId },
        include: { category: true },
      });
      res.json(medicine);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
