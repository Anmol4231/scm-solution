import { TransferStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { daysUntilExpiry } from "../utils/stock";
import { config } from "../utils/config";

const INBOUND_TYPES = ["RECEIPT", "RETURN_IN", "TRANSFER_IN"];
const OUTBOUND_TYPES = ["CONSUMPTION", "DISPENSING", "TRANSFER_OUT", "RETURN_OUT", "EXPIRED"];

function periodStart(days: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function buildMovementTrend(
  facilityIds: string[],
  days: number
): Promise<{ date: string; inbound: number; outbound: number }[]> {
  const since = periodStart(days);
  const txs = await prisma.stockTransaction.findMany({
    where: { facilityId: { in: facilityIds }, createdAt: { gte: since } },
    select: { type: true, quantity: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const byDay: Record<string, { inbound: number; outbound: number }> = {};
  for (const tx of txs) {
    const day = tx.createdAt.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { inbound: 0, outbound: 0 };
    if (INBOUND_TYPES.includes(tx.type)) byDay[day].inbound += Math.abs(tx.quantity);
    else byDay[day].outbound += Math.abs(tx.quantity);
  }
  return Object.entries(byDay).map(([date, v]) => ({ date, ...v }));
}

async function countDispensingTrend(facilityIds: string[], days: number) {
  const since = periodStart(days);
  const records = await prisma.dispensingRecord.findMany({
    where: { facilityId: { in: facilityIds }, dispensedAt: { gte: since } },
    select: { dispensedAt: true, quantity: true },
  });
  const byDay: Record<string, number> = {};
  for (const r of records) {
    const day = r.dispensedAt.toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + r.quantity;
  }
  return Object.entries(byDay).map(([date, quantity]) => ({ date, quantity }));
}

async function countTransferTrend(facilityIds: string[], days: number) {
  const since = periodStart(days);
  const transfers = await prisma.transfer.findMany({
    where: {
      OR: [{ fromFacilityId: { in: facilityIds } }, { toFacilityId: { in: facilityIds } }],
      createdAt: { gte: since },
    },
    select: { createdAt: true, status: true },
  });
  const byDay: Record<string, { created: number; completed: number }> = {};
  for (const t of transfers) {
    const day = t.createdAt.toISOString().slice(0, 10);
    if (!byDay[day]) byDay[day] = { created: 0, completed: 0 };
    byDay[day].created++;
    if (t.status === TransferStatus.RECEIVED) byDay[day].completed++;
  }
  return Object.entries(byDay).map(([date, v]) => ({ date, ...v }));
}

async function countExpiryTrend(facilityIds: string[], days: number) {
  const warningDate = new Date(Date.now() + config.expiryWarningDays * 86400000);
  const batches = await prisma.stockBatch.findMany({
    where: {
      facilityId: { in: facilityIds },
      quantity: { gt: 0 },
      expiryDate: { lte: warningDate, gte: new Date() },
    },
    select: { expiryDate: true, quantity: true },
  });
  const byMonth: Record<string, number> = {};
  for (const b of batches) {
    const key = b.expiryDate.toISOString().slice(0, 7);
    byMonth[key] = (byMonth[key] ?? 0) + b.quantity;
  }
  return Object.entries(byMonth)
    .slice(-Math.max(1, Math.ceil(days / 30)))
    .map(([period, quantity]) => ({ period, quantity }));
}

export async function buildAdminDashboard(facilityIdFilter?: string) {
  const facilities = await prisma.facility.findMany({
    where: {
      isActive: true,
      ...(facilityIdFilter ? { id: facilityIdFilter } : {}),
    },
    orderBy: { name: "asc" },
  });
  const facilityIds = facilities.map((f) => f.id);

  const medicines = await prisma.medicine.findMany({ where: { isActive: true } });
  const today = todayStart();
  const expiryCutoff = new Date(Date.now() + config.expiryWarningDays * 86400000);

  const [
    totalPatients,
    totalWorkers,
    dispensingToday,
    pendingTransfers,
    pendingReturns,
    stockBatchAgg,
    nearExpiryBatches,
    lowStockAlerts,
  ] = await Promise.all([
    prisma.patient.count({
      where: facilityIds.length ? { facilityId: { in: facilityIds } } : undefined,
    }),
    prisma.healthcareWorker.count({
      where: facilityIds.length ? { facilityId: { in: facilityIds }, status: "ACTIVE" } : { status: "ACTIVE" },
    }),
    prisma.dispensingRecord.count({
      where: {
        ...(facilityIds.length ? { facilityId: { in: facilityIds } } : {}),
        dispensedAt: { gte: today },
      },
    }),
    prisma.transfer.count({
      where: {
        status: { in: [TransferStatus.PENDING, TransferStatus.IN_TRANSIT] },
        ...(facilityIds.length
          ? { OR: [{ fromFacilityId: { in: facilityIds } }, { toFacilityId: { in: facilityIds } }] }
          : {}),
      },
    }),
    prisma.medicineReturn.count({
      where: {
        stockAdjusted: false,
        ...(facilityIds.length ? { facilityId: { in: facilityIds } } : {}),
      },
    }),
    prisma.stockBatch.aggregate({
      where: {
        quantity: { gt: 0 },
        ...(facilityIds.length ? { facilityId: { in: facilityIds } } : {}),
      },
      _sum: { quantity: true },
    }),
    prisma.stockBatch.count({
      where: {
        quantity: { gt: 0 },
        expiryDate: { lte: expiryCutoff, gte: new Date() },
        ...(facilityIds.length ? { facilityId: { in: facilityIds } } : {}),
      },
    }),
    prisma.alert.count({
      where: {
        resolvedAt: null,
        type: { in: ["LOW_STOCK", "STOCKOUT", "SHORTFALL"] },
        ...(facilityIds.length ? { facilityId: { in: facilityIds } } : {}),
      },
    }),
  ]);

  // One query for all facility+medicine balances instead of F×M sequential calls
  const rawBalances = await prisma.stockBatch.groupBy({
    by: ["facilityId", "medicineId"],
    where: {
      facilityId: { in: facilityIds },
      quantity: { gt: 0 },
    },
    _sum: { quantity: true },
  });
  const balMap = new Map<string, number>(
    rawBalances.map((b) => [`${b.facilityId}:${b.medicineId}`, b._sum.quantity ?? 0])
  );

  const facilityStats = await Promise.all(
    facilities.map(async (f) => {
      let totalStock = 0;
      let lowCount = 0;
      let stockoutCount = 0;
      for (const m of medicines) {
        const bal = balMap.get(`${f.id}:${m.id}`) ?? 0;
        totalStock += bal;
        if (bal <= 0) stockoutCount++;
        else if (bal <= m.reorderThreshold) lowCount++;
      }

      const [expiringBatches, patientsCount, dispensingCount, patientsServedToday] = await Promise.all([
        prisma.stockBatch.count({
          where: {
            facilityId: f.id,
            quantity: { gt: 0 },
            expiryDate: { lte: expiryCutoff, gte: new Date() },
          },
        }),
        prisma.patient.count({ where: { facilityId: f.id } }),
        prisma.dispensingRecord.count({
          where: { facilityId: f.id, dispensedAt: { gte: periodStart(30) } },
        }),
        prisma.dispensingRecord.groupBy({
          by: ["patientId"],
          where: { facilityId: f.id, dispensedAt: { gte: today } },
        }),
      ]);

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
        patientsCount,
        patientsServedToday: patientsServedToday.length,
        dispensingCount,
        daysSinceReport,
        nonReporting: daysSinceReport > config.nonReportingDays,
      };
    })
  );

  const allFacilityIds =
    facilityIds.length > 0
      ? facilityIds
      : (await prisma.facility.findMany({ where: { isActive: true }, select: { id: true } })).map(
          (f) => f.id
        );

  const [consumption, expiryHeatmapRaw, movementDaily, movementWeekly, movementMonthly] =
    await Promise.all([
      prisma.consumptionReport.groupBy({
        by: ["reportingPeriod", "medicineId"],
        where: facilityIds.length ? { facilityId: { in: facilityIds } } : undefined,
        _sum: { quantityUsed: true },
        orderBy: { reportingPeriod: "desc" },
        take: 20,
      }),
      prisma.stockBatch.findMany({
        where: {
          quantity: { gt: 0 },
          ...(facilityIds.length ? { facilityId: { in: facilityIds } } : {}),
        },
        include: { medicine: true, facility: true },
        take: 100,
      }),
      buildMovementTrend(allFacilityIds, 7),
      buildMovementTrend(allFacilityIds, 30),
      buildMovementTrend(allFacilityIds, 90),
    ]);

  const heatmap = expiryHeatmapRaw.map((b) => ({
    facility: b.facility.name,
    facilityId: b.facilityId,
    medicine: b.medicine.medicineName,
    medicineId: b.medicineId,
    batch: b.batchNumber,
    days: daysUntilExpiry(b.expiryDate),
    quantity: b.quantity,
  }));

  const [dispensingTrend, transferTrend, expiryTrend, recentActivity] = await Promise.all([
    countDispensingTrend(allFacilityIds, 30),
    countTransferTrend(allFacilityIds, 30),
    countExpiryTrend(allFacilityIds, 90),
    prisma.stockTransaction.findMany({
      where: facilityIds.length ? { facilityId: { in: facilityIds } } : undefined,
      include: { medicine: true, facility: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
  ]);

  return {
    summary: {
      totalFacilities: facilities.length,
      totalMedicines: medicines.length,
      totalPatients,
      totalHealthcareWorkers: totalWorkers,
      totalStockAvailable: stockBatchAgg._sum.quantity ?? 0,
      lowStockItems: lowStockAlerts,
      nearExpiryItems: nearExpiryBatches,
      pendingTransfers,
      pendingReturns,
      dispensingToday,
    },
    facilityStats,
    consumptionTrends: consumption,
    expiryHeatmap: heatmap.sort((a, b) => a.days - b.days),
    nonReportingFacilities: facilityStats.filter((f) => f.nonReporting),
    recentActivity: recentActivity.map((tx) => ({
      type: tx.type,
      quantity: Math.abs(tx.quantity),
      createdAt: tx.createdAt.toISOString(),
      medicine: { medicineName: tx.medicine.medicineName },
      facility: { name: tx.facility.name },
    })),
    trends: {
      stockMovement: {
        daily: movementDaily,
        weekly: movementWeekly,
        monthly: movementMonthly,
      },
      dispensing: dispensingTrend,
      transfers: transferTrend,
      expiry: expiryTrend,
    },
  };
}
