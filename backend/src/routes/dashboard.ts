import { Router } from "express";
import { TransferStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { daysUntilExpiry } from "../utils/stock";
import { config } from "../utils/config";
import { isAdminDashboardRole } from "../utils/roles";
import { buildAdminDashboard } from "../services/adminDashboard";

const router = Router();
router.use(authenticate);

router.get("/facility", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    if (!facilityId) return res.status(400).json({ error: "Facility required" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [medicines, dispensingToday, patientsToday, prescriptions, alerts, batches, transactions] =
      await Promise.all([
        prisma.medicine.findMany({ where: { isActive: true }, include: { category: true } }),
        prisma.dispensingRecord.count({ where: { facilityId, dispensedAt: { gte: today } } }),
        prisma.dispensingRecord.groupBy({
          by: ["patientId"],
          where: { facilityId, dispensedAt: { gte: today } },
        }),
        prisma.prescription.findMany({
          where: { facilityId },
          include: { patient: true },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
        prisma.alert.findMany({
          where: { facilityId, isRead: false },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
        prisma.stockBatch.findMany({
          where: { facilityId, quantity: { gt: 0 } },
          include: { medicine: { include: { category: true } } },
          orderBy: { expiryDate: "asc" },
        }),
        prisma.stockTransaction.findMany({
          where: { facilityId },
          include: { medicine: true, performedBy: { select: { firstName: true, lastName: true } } },
          orderBy: { createdAt: "desc" },
          take: 10,
        }),
      ]);

    const batchAgg = await prisma.stockBatch.groupBy({
      by: ["medicineId"],
      where: { facilityId, quantity: { gt: 0 } },
      _sum: { quantity: true },
    });
    const balByMed = new Map(batchAgg.map((b) => [b.medicineId, b._sum.quantity ?? 0]));
    const stockBalances = medicines.map((m) => ({ medicine: m, balance: balByMed.get(m.id) ?? 0 }));

    const lowStock = stockBalances.filter((s) => s.balance <= s.medicine.reorderThreshold && s.balance > 0);
    const stockouts = stockBalances.filter((s) => s.balance <= 0);
    const expiring = batches
      .map((b) => ({ ...b, days: daysUntilExpiry(b.expiryDate) }))
      .filter((b) => b.days <= config.expiryWarningDays);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dispensingByMedicine = await prisma.dispensingRecord.groupBy({
      by: ["medicineId"],
      where: { facilityId, dispensedAt: { gte: thirtyDaysAgo } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 8,
    });

    const topMedIds = dispensingByMedicine.map((d) => d.medicineId);
    const topMeds = await prisma.medicine.findMany({
      where: { id: { in: topMedIds } },
      include: { category: true },
    });
    const topMedMap = new Map(topMeds.map((m) => [m.id, m]));
    const topConsumed = dispensingByMedicine.map((d) => ({
      medicine: topMedMap.get(d.medicineId) ?? null,
      quantity: d._sum.quantity ?? 0,
    }));

    const categoryBreakdown: Record<string, number> = {};
    for (const item of stockBalances) {
      const cat = item.medicine.category?.name ?? "Other";
      categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + item.balance;
    }

    const monthlyDispensing = await prisma.dispensingRecord.groupBy({
      by: ["recipientType"],
      where: { facilityId, dispensedAt: { gte: thirtyDaysAgo } },
      _count: true,
      _sum: { quantity: true },
    });

    const nearStockout = stockBalances
      .filter((s) => s.balance > 0 && s.balance <= s.medicine.reorderThreshold * 0.25)
      .map((s) => ({
        medicine: s.medicine,
        balance: s.balance,
        threshold: s.medicine.reorderThreshold,
        daysToStockout: Math.max(1, Math.round(s.balance / Math.max(1, (topConsumed.find((t) => t.medicine?.id === s.medicine.id)?.quantity ?? 10) / 30))),
      }));

    const stockMovementTrend = await prisma.stockTransaction.findMany({
      where: { facilityId, createdAt: { gte: thirtyDaysAgo } },
      select: { type: true, quantity: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    const movementByDay: Record<string, { inbound: number; outbound: number }> = {};
    for (const tx of stockMovementTrend) {
      const day = tx.createdAt.toISOString().slice(0, 10);
      if (!movementByDay[day]) movementByDay[day] = { inbound: 0, outbound: 0 };
      const inbound = ["RECEIPT", "RETURN_IN", "TRANSFER_IN"].includes(tx.type);
      if (inbound) movementByDay[day].inbound += Math.abs(tx.quantity);
      else movementByDay[day].outbound += Math.abs(tx.quantity);
    }

    const [
      totalMedicines,
      totalPatients,
      totalWorkers,
      activeShipments,
      pendingTransfers,
      pendingReturns,
    ] = await Promise.all([
      prisma.medicine.count({ where: { isActive: true } }),
      prisma.patient.count({ where: { facilityId } }),
      prisma.healthcareWorker.count({ where: { facilityId, status: "ACTIVE" } }),
      prisma.shipment.count({
        where: {
          status: { not: "RECEIVED" },
          OR: [{ destinationFacilityId: facilityId }, { sourceFacilityId: facilityId }],
        },
      }),
      prisma.transfer.count({
        where: {
          status: { in: [TransferStatus.PENDING, TransferStatus.IN_TRANSIT] },
          OR: [{ fromFacilityId: facilityId }, { toFacilityId: facilityId }],
        },
      }),
      prisma.medicineReturn.count({ where: { facilityId, stockAdjusted: false } }),
    ]);

    res.json({
      stockBalances,
      lowStock,
      stockouts,
      expiring,
      dispensingToday,
      patientsServedToday: patientsToday.length,
      recentPrescriptions: prescriptions,
      alerts,
      recentActivity: transactions,
      categoryBreakdown: Object.entries(categoryBreakdown).map(([category, totalStock]) => ({
        category,
        totalStock,
      })),
      topConsumedMedicines: topConsumed.filter((t) => t.medicine),
      monthlyDispensing,
      nearStockoutPrediction: nearStockout,
      stockMovementTrend: Object.entries(movementByDay).map(([date, v]) => ({ date, ...v })),
      widgets: {
        totalMedicines,
        totalPatients,
        totalHealthcareWorkers: totalWorkers,
        totalFacilities: 1,
        dispensingToday,
        lowStockCount: lowStock.length + stockouts.length,
        nearExpiryCount: expiring.length,
        activeShipments,
        pendingTransfers,
        pendingReturns,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/admin", async (req, res, next) => {
  try {
    if (!isAdminDashboardRole(req.user!.role)) {
      return res.status(403).json({ error: "Admin access required" });
    }
    const facilityId = (req.query.facilityId as string) || undefined;
    const data = await buildAdminDashboard(facilityId);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

export default router;
