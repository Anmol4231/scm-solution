import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { getMedicineBalance, daysUntilExpiry } from "../utils/stock";
import { config } from "../utils/config";

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

    const stockBalances = await Promise.all(
      medicines.map(async (m) => ({
        medicine: m,
        balance: await getMedicineBalance(m.id, facilityId),
      }))
    );

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

    const topConsumed = await Promise.all(
      dispensingByMedicine.map(async (d) => {
        const med = await prisma.medicine.findUnique({
          where: { id: d.medicineId },
          include: { category: true },
        });
        return { medicine: med, quantity: d._sum.quantity ?? 0 };
      })
    );

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
    });
  } catch (e) {
    next(e);
  }
});

router.get("/admin", async (req, res, next) => {
  try {
    if (req.user!.role !== "PROVINCIAL_MANAGER") {
      return res.status(403).json({ error: "Provincial manager access required" });
    }

    const facilities = await prisma.facility.findMany({ where: { isActive: true } });
    const medicines = await prisma.medicine.findMany({ where: { isActive: true } });

    const facilityStats = await Promise.all(
      facilities.map(async (f) => {
        let totalStock = 0;
        let lowCount = 0;
        let stockoutCount = 0;
        for (const m of medicines) {
          const bal = await getMedicineBalance(m.id, f.id);
          totalStock += bal;
          if (bal <= 0) stockoutCount++;
          else if (bal <= m.reorderThreshold) lowCount++;
        }
        const expiringBatches = await prisma.stockBatch.count({
          where: {
            facilityId: f.id,
            quantity: { gt: 0 },
            expiryDate: {
              lte: new Date(Date.now() + config.expiryWarningDays * 86400000),
              gte: new Date(),
            },
          },
        });
        const lastReport = await prisma.consumptionReport.findFirst({
          where: { facilityId: f.id },
          orderBy: { reportedAt: "desc" },
        });
        const daysSinceReport = lastReport
          ? Math.floor((Date.now() - lastReport.reportedAt.getTime()) / 86400000)
          : 999;

        return {
          facility: f,
          totalStock,
          lowCount,
          stockoutCount,
          expiringBatches,
          daysSinceReport,
          nonReporting: daysSinceReport > config.nonReportingDays,
        };
      })
    );

    const consumption = await prisma.consumptionReport.groupBy({
      by: ["reportingPeriod", "medicineId"],
      _sum: { quantityUsed: true },
      orderBy: { reportingPeriod: "desc" },
      take: 20,
    });

    const expiryHeatmap = await prisma.stockBatch.findMany({
      where: { quantity: { gt: 0 } },
      include: { medicine: true, facility: true },
    });

    const heatmap = expiryHeatmap.map((b) => ({
      facility: b.facility.name,
      medicine: b.medicine.medicineName,
      batch: b.batchNumber,
      days: daysUntilExpiry(b.expiryDate),
      quantity: b.quantity,
    }));

    res.json({
      facilityStats,
      consumptionTrends: consumption,
      expiryHeatmap: heatmap,
      nonReportingFacilities: facilityStats.filter((f) => f.nonReporting),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
