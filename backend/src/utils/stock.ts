import { StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";

export const INBOUND_TYPES: StockTransactionType[] = [
  StockTransactionType.RECEIPT,
  StockTransactionType.RETURN_IN,
  StockTransactionType.TRANSFER_IN,
];

export const OUTBOUND_TYPES: StockTransactionType[] = [
  StockTransactionType.DISPENSING,
  StockTransactionType.CONSUMPTION,
  StockTransactionType.EXPIRED,
  StockTransactionType.TRANSFER_OUT,
  StockTransactionType.RETURN_OUT,
];

export function periodStart(days: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d;
}

export async function getBatchSupplyTotals(
  batchIds: string[],
  since?: Date
): Promise<Record<string, { inbound: number; outbound: number }>> {
  if (batchIds.length === 0) return {};

  const txs = await prisma.stockTransaction.findMany({
    where: {
      batchId: { in: batchIds },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    select: { batchId: true, type: true, quantity: true },
  });

  const result: Record<string, { inbound: number; outbound: number }> = {};
  for (const id of batchIds) {
    result[id] = { inbound: 0, outbound: 0 };
  }
  for (const tx of txs) {
    if (!tx.batchId) continue;
    if (!result[tx.batchId]) result[tx.batchId] = { inbound: 0, outbound: 0 };
    const qty = Math.abs(tx.quantity);
    if (INBOUND_TYPES.includes(tx.type)) result[tx.batchId].inbound += qty;
    if (OUTBOUND_TYPES.includes(tx.type)) result[tx.batchId].outbound += qty;
  }
  return result;
}

export async function getMedicineBalance(
  medicineId: string,
  facilityId: string | null
): Promise<number> {
  const batches = await prisma.stockBatch.findMany({
    where: { medicineId, ...(facilityId ? { facilityId } : {}), quantity: { gt: 0 } },
  });
  return batches.reduce((sum, b) => sum + b.quantity, 0);
}

export async function getBatchBalance(batchId: string): Promise<number> {
  const batch = await prisma.stockBatch.findUnique({ where: { id: batchId } });
  return batch?.quantity ?? 0;
}

export function daysUntilExpiry(expiryDate: Date): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const exp = new Date(expiryDate);
  exp.setHours(0, 0, 0, 0);
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export function getExpirySeverity(
  daysLeft: number,
  warningDays: number,
  criticalDays: number
): "ok" | "warning" | "critical" | "expired" {
  if (daysLeft < 0) return "expired";
  if (daysLeft <= criticalDays) return "critical";
  if (daysLeft <= warningDays) return "warning";
  return "ok";
}
