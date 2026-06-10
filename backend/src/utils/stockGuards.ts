/**
 * Shared stock-safety guards — the single source of truth for two production-
 * critical invariants:
 *
 *   1. Stock can never go negative. Every quantity-reducing operation must route
 *      its decrement through `decrementBatchOrThrow`, which performs a conditional
 *      `UPDATE … WHERE quantity >= n` so concurrent operations cannot oversell.
 *
 *   2. Expired (or non-ACTIVE) stock can never be received, transferred, or
 *      dispensed. Use `assertFutureExpiry` when accepting new stock and
 *      `assertBatchAvailable` / `assertNotExpired` when issuing existing stock.
 *
 * All guards throw typed errors that the central error handler maps to HTTP 400,
 * so route handlers only need to call the guard and let it propagate.
 */

import type { Prisma, StockBatch, BatchStatus } from "@prisma/client";

/** Operation would drive a batch below zero (or the batch is gone). → 400 */
export class NegativeStockError extends Error {
  constructor(message = "Operation would drive inventory below zero.") {
    super(message);
    this.name = "NegativeStockError";
  }
}

/** Stock is expired / quarantined and cannot be received, transferred, or dispensed. → 400 */
export class ExpiredStockError extends Error {
  constructor(message = "Expired stock cannot be used.") {
    super(message);
    this.name = "ExpiredStockError";
  }
}

/** Midnight (local) today — the boundary for all expiry comparisons. */
function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/**
 * True when `expiry` is strictly in the future (after today). A batch dated today
 * is NOT a valid future expiry for *incoming* stock.
 */
export function isFutureExpiry(expiry: Date | string): boolean {
  const exp = toDate(expiry);
  exp.setHours(0, 0, 0, 0);
  return exp.getTime() > startOfToday().getTime();
}

/**
 * True when stock has expired — i.e. its expiry date is before today. Stock that
 * expires *today* is still usable through the end of the day, so this returns
 * false for today's date (mirrors `daysUntilExpiry < 0`).
 */
export function isExpired(expiry: Date | string): boolean {
  const exp = toDate(expiry);
  exp.setHours(0, 0, 0, 0);
  return exp.getTime() < startOfToday().getTime();
}

/**
 * Guard for ACCEPTING stock (purchase receipt, receipt edit). Expiry must be a
 * real future date — you cannot book in stock that is already expired or expires
 * today.
 */
export function assertFutureExpiry(expiry: Date | string, label?: string): void {
  if (!isFutureExpiry(expiry)) {
    throw new ExpiredStockError(
      `Expiry date must be a future date${label ? ` for ${label}` : ""}. Expired stock cannot be received.`
    );
  }
}

/**
 * Guard for ISSUING stock (dispense, transfer, return-to-stock). Throws if the
 * batch has already expired.
 */
export function assertNotExpired(expiry: Date | string, label?: string): void {
  if (isExpired(expiry)) {
    throw new ExpiredStockError(
      `${label ?? "This stock"} has expired and cannot be dispensed, transferred, or returned to inventory.`
    );
  }
}

/**
 * Full usability guard for an existing batch about to be issued: it must be
 * non-expired AND in ACTIVE lifecycle state (not EXPIRED / QUARANTINED / DISPOSED).
 */
export function assertBatchAvailable(
  batch: Pick<StockBatch, "expiryDate" | "status" | "batchNumber">,
  label?: string
): void {
  const name = label ?? `batch ${batch.batchNumber}`;
  const status = batch.status as BatchStatus;
  if (status !== "ACTIVE") {
    throw new ExpiredStockError(
      `${name} is ${status.toLowerCase()} and is not available for use.`
    );
  }
  assertNotExpired(batch.expiryDate, name);
}

/**
 * Atomically decrement a batch only if it still holds enough stock. The conditional
 * `WHERE quantity >= qty` makes check-and-decrement a single SQL statement, so
 * concurrent operations can never drive stock negative. Throws `NegativeStockError`
 * (→ 400) when the decrement could not be applied.
 *
 * `qty` must be positive; a non-positive amount is a no-op.
 */
export async function decrementBatchOrThrow(
  tx: Prisma.TransactionClient,
  batchId: string,
  qty: number,
  label?: string
): Promise<void> {
  if (qty <= 0) return;
  const res = await tx.stockBatch.updateMany({
    where: { id: batchId, quantity: { gte: qty } },
    data: { quantity: { decrement: qty } },
  });
  if (res.count === 0) {
    throw new NegativeStockError(
      `Insufficient stock${label ? ` for ${label}` : ""} — this operation would drive inventory below zero.`
    );
  }
}
