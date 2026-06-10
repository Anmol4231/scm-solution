/**
 * Batch lifecycle service — drives the StockBatch state machine:
 *
 *   ACTIVE ──(expiry passed)──▶ EXPIRED ──(disposal)──▶ DISPOSED
 *      │                                   ▲
 *      └──────(manual hold)──▶ QUARANTINED─┘
 *
 * The authoritative protection against *using* expired/quarantined stock lives in
 * the per-transaction guards (`assertBatchAvailable` in stockGuards). This service
 * keeps the persisted `status` column in step with reality so inventory views and
 * the expiry/disposal workflow have an explicit, queryable lifecycle state.
 */

import { prisma } from "../lib/prisma";
import { logAudit } from "./audit";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Flip any ACTIVE batch whose expiry has passed to EXPIRED. Idempotent and cheap;
 * safe to call opportunistically before serving expiry/inventory views. Returns the
 * number of batches transitioned.
 */
export async function refreshExpiredBatches(facilityId?: string | null): Promise<number> {
  const res = await prisma.stockBatch.updateMany({
    where: {
      status: "ACTIVE",
      expiryDate: { lt: startOfToday() },
      ...(facilityId ? { facilityId } : {}),
    },
    data: { status: "EXPIRED" },
  });
  return res.count;
}

/**
 * Move a batch to QUARANTINED (held, unavailable for issue). Allowed from ACTIVE or
 * EXPIRED. Quantity is untouched — the stock still physically exists, it is just not
 * usable until released or disposed.
 */
export async function quarantineBatch(params: {
  batchId: string;
  userId: string;
  reason: string;
}): Promise<void> {
  const batch = await prisma.stockBatch.findUnique({ where: { id: params.batchId } });
  if (!batch) throw new Error("Batch not found");
  if (batch.status === "DISPOSED") throw new Error("Disposed batches cannot be quarantined");
  if (batch.status === "QUARANTINED") return;

  await prisma.stockBatch.update({
    where: { id: params.batchId },
    data: { status: "QUARANTINED", quarantinedAt: new Date(), quarantineReason: params.reason },
  });

  await logAudit({
    facilityId: batch.facilityId,
    userId: params.userId,
    action: "BATCH_QUARANTINE",
    entityType: "StockBatch",
    entityId: batch.id,
    details: {
      batchNumber: batch.batchNumber,
      medicineId: batch.medicineId,
      quantity: batch.quantity,
      reason: params.reason,
    },
  });
}
