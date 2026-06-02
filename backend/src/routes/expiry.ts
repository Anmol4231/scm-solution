import { Router } from "express";
import { z } from "zod";
import { StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility, requireRoles } from "../middleware/auth";
import { daysUntilExpiry } from "../utils/stock";
import { config } from "../utils/config";
import { logAudit } from "../services/audit";

const router = Router();
router.use(authenticate, requireFacility);

router.get("/alerts", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const categoryId = req.query.categoryId as string | undefined;
    const facilityFilter = req.query.facilityFilter as string | undefined;
    const withinDaysParam = req.query.withinDays as string | undefined;
    const statusFilter = (req.query.status as string) || "all";

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

router.get("/redistribution", requireRoles("PROVINCIAL_MANAGER", "SUPER_ADMIN"), async (_req, res, next) => {
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
});

router.post("/record-expired", async (req, res, next) => {
  try {
    const data = expiredSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
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

    if (batch) {
      const deduct = Math.min(batch.quantity, data.quantity);
      await prisma.stockBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: deduct } },
      });
    }

    const record = await prisma.expiredMedicineRecord.create({
      data: {
        facilityId,
        medicineId: data.medicineId,
        batchNumber: data.batchNumber,
        expiryDate: new Date(data.expiryDate),
        quantity: data.quantity,
        disposalMethod: data.disposalMethod,
        processedById: userId,
      },
    });

    await prisma.stockTransaction.create({
      data: {
        facilityId,
        medicineId: data.medicineId,
        batchId: batch?.id,
        type: StockTransactionType.EXPIRED,
        quantity: -data.quantity,
        reason: data.disposalMethod,
        performedById: userId,
      },
    });

    await logAudit({ facilityId, userId, action: "EXPIRED_MEDICINE", entityType: "ExpiredMedicine", entityId: record.id });
    res.status(201).json(record);
  } catch (e) {
    next(e);
  }
});

export default router;
