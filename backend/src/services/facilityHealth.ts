import { prisma } from "../lib/prisma";
import { getMedicineBalance } from "../utils/stock";
import { config } from "../utils/config";

export type FacilityHealthStatus = "healthy" | "warning" | "critical";

export async function getFacilityHealthStatus(facilityId: string): Promise<{
  status: FacilityHealthStatus;
  stockoutCount: number;
  lowCount: number;
  expiringBatches: number;
  criticalAlerts: number;
}> {
  const medicines = await prisma.medicine.findMany({ where: { isActive: true } });
  let stockoutCount = 0;
  let lowCount = 0;
  for (const m of medicines) {
    const bal = await getMedicineBalance(m.id, facilityId);
    if (bal <= 0) stockoutCount++;
    else if (bal <= m.reorderThreshold) lowCount++;
  }

  const expiryCutoff = new Date(Date.now() + config.expiryWarningDays * 86400000);
  const expiringBatches = await prisma.stockBatch.count({
    where: {
      facilityId,
      quantity: { gt: 0 },
      expiryDate: { lte: expiryCutoff, gte: new Date() },
    },
  });

  const criticalAlerts = await prisma.alert.count({
    where: {
      facilityId,
      resolvedAt: null,
      severity: "CRITICAL",
    },
  });

  let status: FacilityHealthStatus = "healthy";
  if (stockoutCount > 0 || criticalAlerts > 0) status = "critical";
  else if (lowCount > 0 || expiringBatches > 0) status = "warning";

  return { status, stockoutCount, lowCount, expiringBatches, criticalAlerts };
}
