import { Router } from "express";
import { z } from "zod";
import { StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { getMedicineBalance, getBatchSupplyTotals, periodStart, daysUntilExpiry } from "../utils/stock";
import { assertFutureExpiry, decrementBatchOrThrow, NegativeStockError } from "../utils/stockGuards";
import { config } from "../utils/config";
import { logAudit } from "../services/audit";
import { createAlert } from "../services/alerts";
import { AlertType, AlertSeverity } from "@prisma/client";

const router = Router();
router.use(authenticate, requireFacility);

const stockView         = requirePermission("stock", "view");
const stockCreate       = requirePermission("stock", "create");
const stockEdit         = requirePermission("stock", "edit");
const receiveStockCreate = requirePermission("receiveStock", "create");

const positiveWholeNumber = z.number().int("Quantity must be a whole number").positive("Quantity must be greater than zero");
const nonNegativeWholeNumber = z.number().int("Count must be a whole number").min(0, "Count cannot be negative");

// Stock receipt
const receiptSchema = z.object({
  medicineId: z.string(),
  batchNumber: z.string().trim().min(1, "Batch Number is mandatory"),
  expiryDate: z.string().trim().min(1, "Expiry Date is mandatory"),
  quantityReceived: positiveWholeNumber,
  quantityRequested: positiveWholeNumber.optional(),
  notes: z.string().optional(),
});

router.post("/receipt", receiveStockCreate, async (req, res, next) => {
  try {
    const data = receiptSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

    // Expired stock can never be received.
    assertFutureExpiry(data.expiryDate, data.batchNumber);

    const expiryDate = new Date(data.expiryDate);
    let batch = await prisma.stockBatch.findUnique({
      where: {
        medicineId_facilityId_batchNumber: {
          medicineId: data.medicineId,
          facilityId,
          batchNumber: data.batchNumber,
        },
      },
    });

    if (batch) {
      batch = await prisma.stockBatch.update({
        where: { id: batch.id },
        data: { quantity: { increment: data.quantityReceived }, expiryDate },
      });
    } else {
      batch = await prisma.stockBatch.create({
        data: {
          medicineId: data.medicineId,
          facilityId,
          batchNumber: data.batchNumber,
          expiryDate,
          quantity: data.quantityReceived,
        },
      });
    }

    let shortfallFlag = false;
    let shortfallPercent: number | undefined;
    if (data.quantityRequested) {
      const shortfall = data.quantityRequested - data.quantityReceived;
      shortfallPercent = (shortfall / data.quantityRequested) * 100;
      if (shortfallPercent > config.shortfallThresholdPercent) {
        shortfallFlag = true;
        await createAlert({
          facilityId,
          type: AlertType.SHORTFALL,
          severity: AlertSeverity.WARNING,
          title: "Stock receipt shortfall",
          message: `Received ${data.quantityReceived} vs requested ${data.quantityRequested} (${shortfallPercent.toFixed(0)}% shortfall)`,
          medicineId: data.medicineId,
        });
      }
    }

    const balance = await getMedicineBalance(data.medicineId, facilityId);
    const tx = await prisma.stockTransaction.create({
      data: {
        facilityId,
        medicineId: data.medicineId,
        batchId: batch.id,
        type: StockTransactionType.RECEIPT,
        quantity: data.quantityReceived,
        receivedQty: data.quantityReceived,
        requestedQty: data.quantityRequested,
        shortfallFlag,
        shortfallPercent,
        balanceAfter: balance,
        performedById: userId,
        notes: data.notes,
      },
    });

    await logAudit({ facilityId, userId, action: "STOCK_RECEIPT", entityType: "StockBatch", entityId: batch.id, details: data });
    res.status(201).json({ batch, transaction: tx, balance });
  } catch (e) {
    next(e);
  }
});

// Consumption reporting
const consumptionSchema = z.object({
  medicineId: z.string(),
  quantityUsed: positiveWholeNumber,
  reportingPeriod: z.string(),
});

// Thrown inside a $transaction to roll it back and answer 400 instead of 500.
class InsufficientStockError extends Error {}

router.post("/consumption", stockCreate, async (req, res, next) => {
  try {
    const data = consumptionSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

    let result: { balance: number; transactionId: string };
    try {
      result = await prisma.$transaction(async (tx) => {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        // Consume only ACTIVE, non-expired stock (FEFO). Expired / quarantined
        // batches are never drawn down.
        const batches = await tx.stockBatch.findMany({
          where: {
            medicineId: data.medicineId,
            facilityId,
            quantity: { gt: 0 },
            status: "ACTIVE",
            expiryDate: { gte: startOfToday },
          },
          orderBy: { expiryDate: "asc" },
        });

        let remaining = data.quantityUsed;
        for (const batch of batches) {
          if (remaining <= 0) break;
          const deduct = Math.min(batch.quantity, remaining);
          // Conditional decrement so concurrent operations can't oversell.
          const upd = await tx.stockBatch.updateMany({
            where: { id: batch.id, quantity: { gte: deduct } },
            data: { quantity: { decrement: deduct } },
          });
          if (upd.count === 0) continue; // raced — this batch was taken meanwhile
          remaining -= deduct;
        }
        // All-or-nothing: if the full quantity can't be covered, roll everything back.
        if (remaining > 0) throw new InsufficientStockError("Insufficient non-expired stock for the recorded consumption");

        await tx.consumptionReport.create({
          data: { facilityId, medicineId: data.medicineId, quantityUsed: data.quantityUsed, reportingPeriod: data.reportingPeriod },
        });
        const agg = await tx.stockBatch.aggregate({
          _sum: { quantity: true },
          where: { medicineId: data.medicineId, facilityId },
        });
        const balance = agg._sum.quantity ?? 0;
        const transaction = await tx.stockTransaction.create({
          data: {
            facilityId,
            medicineId: data.medicineId,
            type: StockTransactionType.CONSUMPTION,
            quantity: -data.quantityUsed,
            balanceAfter: balance,
            reportingPeriod: data.reportingPeriod,
            performedById: userId,
          },
        });
        return { balance, transactionId: transaction.id };
      });
    } catch (e) {
      if (e instanceof InsufficientStockError) return res.status(400).json({ error: e.message });
      throw e;
    }

    res.status(201).json(result);
  } catch (e) {
    next(e);
  }
});

// Stock adjustment
const adjustmentSchema = z.object({
  medicineId: z.string(),
  physicalCount: nonNegativeWholeNumber,
  reason: z.string(),
  facilityId: z.string().optional(),
});

router.post("/adjustment", stockEdit, async (req, res, next) => {
  try {
    const data = adjustmentSchema.parse(req.body);
    const facilityId = getFacilityId(req, data.facilityId);
    if (!facilityId) return res.status(400).json({ error: "Facility selection is required." });
    const userId = req.user!.userId;
    const systemBalance = await getMedicineBalance(data.medicineId, facilityId);
    const discrepancy = data.physicalCount - systemBalance;

    // Reconcile inside a transaction so the batch adjustment and the ledger entry
    // are atomic, and so a downward adjustment can NEVER drive a batch negative.
    const adjustmentTx = await prisma.$transaction(async (txc) => {
      const batches = await txc.stockBatch.findMany({
        where: { medicineId: data.medicineId, facilityId },
        orderBy: { expiryDate: "asc" }, // FEFO — draw down soonest-expiring first
      });

      if (discrepancy < 0) {
        // Spread the reduction across batches; conditional decrements guarantee no
        // batch goes below zero. If the count dropped below what physically exists
        // (a race), roll back rather than create negative stock.
        let toRemove = -discrepancy;
        for (const b of batches) {
          if (toRemove <= 0) break;
          const take = Math.min(b.quantity, toRemove);
          if (take <= 0) continue;
          await decrementBatchOrThrow(txc, b.id, take, `${data.medicineId} (batch ${b.batchNumber})`);
          toRemove -= take;
        }
        if (toRemove > 0) {
          throw new NegativeStockError(
            "Physical count is below current stock by more than is available — adjustment would create negative inventory."
          );
        }
      } else if (discrepancy > 0) {
        // Surplus must land on a real batch (with an expiry). Without one we cannot
        // represent it safely — direct the user to the receiving flow instead.
        const target = batches.find((b) => b.status === "ACTIVE") ?? batches[0];
        if (!target) {
          throw new NegativeStockError(
            "Cannot increase stock for a medicine with no existing batch. Use Receive Stock to book in new inventory with a batch and expiry."
          );
        }
        await txc.stockBatch.update({
          where: { id: target.id },
          data: { quantity: { increment: discrepancy } },
        });
      }

      return txc.stockTransaction.create({
        data: {
          facilityId,
          medicineId: data.medicineId,
          batchId: batches[0]?.id,
          type: StockTransactionType.ADJUSTMENT,
          quantity: discrepancy,
          balanceAfter: data.physicalCount,
          reason: data.reason,
          performedById: userId,
        },
      });
    });

    await logAudit({
      facilityId,
      userId,
      action: "STOCK_ADJUSTMENT",
      entityType: "Medicine",
      entityId: data.medicineId,
      details: { systemBalance, physicalCount: data.physicalCount, discrepancy, reason: data.reason },
    });

    res.status(201).json({ transaction: adjustmentTx, systemBalance, physicalCount: data.physicalCount, discrepancy });
  } catch (e) {
    next(e);
  }
});

router.get("/balance", stockView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const medicineId = req.query.medicineId as string | undefined;

    if (medicineId) {
      const batches = await prisma.stockBatch.findMany({
        where: { ...(facilityId ? { facilityId } : {}), medicineId, quantity: { gt: 0 } },
        include: { medicine: true },
        orderBy: { expiryDate: "asc" },
      });
      const balance = batches.reduce((s, b) => s + b.quantity, 0);
      return res.json({ medicineId, balance, batches });
    }

    const medicines = await prisma.medicine.findMany({ where: { isActive: true } });
    const balances = await Promise.all(
      medicines.map(async (m) => ({
        medicine: m,
        balance: await getMedicineBalance(m.id, facilityId),
      }))
    );
    res.json(balances);
  } catch (e) {
    next(e);
  }
});

router.get("/batches", stockView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const batches = await prisma.stockBatch.findMany({
      where: { ...(facilityId ? { facilityId } : {}), quantity: { gt: 0 } },
      include: { medicine: true, facility: { select: { id: true, name: true } } },
      orderBy: { expiryDate: "asc" },
    });
    res.json(batches);
  } catch (e) {
    next(e);
  }
});

router.get("/export", stockView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const batches = await prisma.stockBatch.findMany({
      where: { ...(facilityId ? { facilityId } : {}) },
      include: {
        medicine: { include: { category: true } },
        facility: true,
      },
      orderBy: [{ medicine: { medicineName: "asc" } }, { expiryDate: "asc" }],
    });

    const supply = await getBatchSupplyTotals(batches.map((b) => b.id), periodStart(30));

    const escape = (v: string | number) => {
      const s = String(v);
      return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = [
      "Medicine",
      "Category",
      "Batch Number",
      "Facility",
      "Quantity On Hand",
      "Expiry Date",
      "Days Until Expiry",
      "Inbound Supply (30d)",
      "Outbound Supply (30d)",
    ];

    const rows = batches.map((b) => [
      b.medicine.medicineName,
      b.medicine.category?.name ?? "",
      b.batchNumber,
      b.facility.name,
      b.quantity,
      b.expiryDate.toISOString().slice(0, 10),
      daysUntilExpiry(b.expiryDate),
      supply[b.id]?.inbound ?? 0,
      supply[b.id]?.outbound ?? 0,
    ]);

    const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const filename = `scm-stock-${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("\uFEFF" + csv);
  } catch (e) {
    next(e);
  }
});

router.get("/transactions", stockView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const type = req.query.type as string | undefined;
    const medicineId = req.query.medicineId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const pageParam = req.query.page as string | undefined;
    const pageSizeParam = req.query.pageSize as string | undefined;
    const pageSize = Math.min(Math.max(parseInt(pageSizeParam ?? (req.query.take as string) ?? "50", 10) || 50, 1), 200);
    const page = Math.max(
      1,
      parseInt(pageParam ?? "", 10) || Math.floor((parseInt((req.query.skip as string) ?? "0", 10) || 0) / pageSize) + 1
    );
    const skip = pageParam !== undefined || pageSizeParam !== undefined
      ? (page - 1) * pageSize
      : Math.max(parseInt((req.query.skip as string) ?? "0", 10) || 0, 0);
    const take = pageSize;
    const sortBy = req.query.sortBy as string | undefined;
    const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";

    const where: any = {
      ...(facilityId ? { facilityId } : {}),
      ...(type ? { type } : {}),
      ...(medicineId ? { medicineId } : {}),
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) } : {}),
        },
      } : {}),
    };

    const orderBy: any =
      sortBy === "type" ? { type: sortDir }
      : sortBy === "medicine" ? { medicine: { medicineName: sortDir } }
      : sortBy === "facility" ? { facility: { name: sortDir } }
      : sortBy === "batch" ? { batch: { batchNumber: sortDir } }
      : sortBy === "quantity" ? { quantity: sortDir }
      : sortBy === "balanceAfter" ? { balanceAfter: sortDir }
      : sortBy === "reason" ? { reason: sortDir }
      : sortBy === "performedBy" ? { performedBy: { firstName: sortDir } }
      : sortBy === "destination" ? { transfer: { toFacility: { name: sortDir } } }
      : { createdAt: sortDir };

    const [total, txs] = await prisma.$transaction([
      prisma.stockTransaction.count({ where }),
      prisma.stockTransaction.findMany({
        where,
        include: {
          medicine: { select: { id: true, medicineName: true } },
          batch: { select: { batchNumber: true, expiryDate: true } },
          performedBy: { select: { firstName: true, lastName: true } },
          facility: { select: { id: true, name: true, code: true } },
        },
        orderBy,
        skip,
        take,
      }),
    ]);

    const transferIds = [...new Set(txs.map((tx) => tx.transferId).filter(Boolean))] as string[];
    const transfers = transferIds.length
      ? await prisma.transfer.findMany({
          where: { id: { in: transferIds } },
          include: {
            fromFacility: { select: { id: true, name: true, code: true } },
            toFacility: { select: { id: true, name: true, code: true } },
          },
        })
      : [];
    const transferMap = Object.fromEntries(transfers.map((transfer) => [transfer.id, transfer]));
    const transactions = txs.map((tx) => {
      const transfer = tx.transferId ? transferMap[tx.transferId] : null;
      return {
        ...tx,
        sourceFacility: transfer?.fromFacility ?? null,
        destinationFacility: transfer?.toFacility ?? null,
      };
    });

    res.json({ data: transactions, total, page, pageSize, skip, take, transactions });
  } catch (e) {
    next(e);
  }
});

// GET /stock/transactions/export — CSV export of the ledger, mirroring every filter
// from /stock/transactions (no pagination — all matching rows).
router.get("/transactions/export", stockView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const type = req.query.type as string | undefined;
    const medicineId = req.query.medicineId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where: any = {
      ...(facilityId ? { facilityId } : {}),
      ...(type ? { type } : {}),
      ...(medicineId ? { medicineId } : {}),
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) } : {}),
        },
      } : {}),
    };

    const txs = await prisma.stockTransaction.findMany({
      where,
      include: {
        medicine: { select: { medicineName: true } },
        batch: { select: { batchNumber: true, expiryDate: true } },
        performedBy: { select: { firstName: true, lastName: true } },
        facility: { select: { name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10000,
    });

    const transferIds = [...new Set(txs.map((tx) => tx.transferId).filter(Boolean))] as string[];
    const transfers = transferIds.length
      ? await prisma.transfer.findMany({
          where: { id: { in: transferIds } },
          include: {
            fromFacility: { select: { name: true } },
            toFacility: { select: { name: true } },
          },
        })
      : [];
    const transferMap = Object.fromEntries(transfers.map((t) => [t.id, t]));

    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ["Date & Time", "Type", "Medicine", "Facility", "Source Facility", "Destination Facility", "Batch", "Expiry", "Quantity", "Balance After", "Reason", "Performed By"];
    const rows = txs.map((tx) => {
      const transfer = tx.transferId ? transferMap[tx.transferId] : null;
      return [
        tx.createdAt.toISOString(),
        tx.type,
        tx.medicine?.medicineName ?? "",
        tx.facility?.name ?? "",
        transfer?.fromFacility?.name ?? "",
        transfer?.toFacility?.name ?? "",
        tx.batch?.batchNumber ?? "",
        tx.batch?.expiryDate ? tx.batch.expiryDate.toISOString().slice(0, 10) : "",
        tx.quantity,
        tx.balanceAfter ?? "",
        tx.reason ?? tx.notes ?? "",
        tx.performedBy ? `${tx.performedBy.firstName} ${tx.performedBy.lastName}` : "",
      ];
    });

    const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const filename = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("﻿" + csv);
  } catch (e) {
    next(e);
  }
});

// GET /stock/movement — stock movement summary: opening + receipts − issues = closing per period
router.get("/movement", stockView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const medicineId = req.query.medicineId as string | undefined;
    const categoryId = req.query.categoryId as string | undefined;

    if (!from || !to) return res.status(400).json({ error: "from and to date parameters required (YYYY-MM-DD)" });

    const fromDate = new Date(from);
    const toDate = new Date(to);
    toDate.setHours(23, 59, 59, 999);

    // Get all transactions in the period for this facility
    const transactions = await prisma.stockTransaction.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        ...(medicineId ? { medicineId } : {}),
        createdAt: { gte: fromDate, lte: toDate },
        ...(categoryId
          ? { medicine: { categoryId } }
          : {}),
      },
      include: { medicine: { include: { category: { select: { id: true, name: true } } } } },
    });

    // Get all transactions BEFORE the period to compute opening balance
    const priorTransactions = await prisma.stockTransaction.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        ...(medicineId ? { medicineId } : {}),
        createdAt: { lt: fromDate },
        ...(categoryId ? { medicine: { categoryId } } : {}),
      },
      select: { medicineId: true, quantity: true },
    });

    // Aggregate by medicine
    type Row = {
      medicineId: string;
      medicineName: string;
      category: string;
      openingBalance: number;
      receipts: number;
      transfersIn: number;
      returnsIn: number;
      consumptions: number;
      dispensings: number;
      transfersOut: number;
      disposals: number;
      adjustments: number;
      closingBalance: number;
    };

    const rowMap: Record<string, Row> = {};

    const getOrCreate = (tx: { medicineId: string; medicine: { medicineName: string; category?: { name: string } | null } }): Row => {
      if (!rowMap[tx.medicineId]) {
        rowMap[tx.medicineId] = {
          medicineId: tx.medicineId,
          medicineName: tx.medicine.medicineName,
          category: tx.medicine.category?.name ?? "Uncategorized",
          openingBalance: 0, receipts: 0, transfersIn: 0, returnsIn: 0,
          consumptions: 0, dispensings: 0, transfersOut: 0, disposals: 0, adjustments: 0, closingBalance: 0,
        };
      }
      return rowMap[tx.medicineId];
    };

    // Opening balance from prior transactions
    for (const pt of priorTransactions) {
      if (!rowMap[pt.medicineId]) {
        rowMap[pt.medicineId] = {
          medicineId: pt.medicineId, medicineName: "", category: "",
          openingBalance: 0, receipts: 0, transfersIn: 0, returnsIn: 0,
          consumptions: 0, dispensings: 0, transfersOut: 0, disposals: 0, adjustments: 0, closingBalance: 0,
        };
      }
      rowMap[pt.medicineId].openingBalance += pt.quantity;
    }

    // Hydrate medicine names for opening balance rows
    const allMedIds = [...new Set([...priorTransactions.map((p) => p.medicineId), ...transactions.map((t) => t.medicineId)])];
    const medicines = await prisma.medicine.findMany({
      where: { id: { in: allMedIds } },
      include: { category: { select: { name: true } } },
    });
    const medMap = Object.fromEntries(medicines.map((m) => [m.id, m]));
    for (const row of Object.values(rowMap)) {
      if (!row.medicineName && medMap[row.medicineId]) {
        row.medicineName = medMap[row.medicineId].medicineName;
        row.category = medMap[row.medicineId].category?.name ?? "Uncategorized";
      }
    }

    // Period transactions
    for (const tx of transactions) {
      const row = getOrCreate(tx as any);
      if (!row.medicineName && medMap[tx.medicineId]) {
        row.medicineName = medMap[tx.medicineId].medicineName;
        row.category = medMap[tx.medicineId].category?.name ?? "Uncategorized";
      }
      const qty = tx.quantity;
      switch (tx.type) {
        case "RECEIPT": row.receipts += qty; break;
        case "TRANSFER_IN": case "RETURN_IN": row.transfersIn += qty; break;
        case "CONSUMPTION": row.consumptions += Math.abs(qty); break;
        case "DISPENSING": row.dispensings += Math.abs(qty); break;
        case "TRANSFER_OUT": row.transfersOut += Math.abs(qty); break;
        case "EXPIRED": row.disposals += Math.abs(qty); break;
        case "ADJUSTMENT": row.adjustments += qty; break;
      }
    }

    // Compute closing balance
    for (const row of Object.values(rowMap)) {
      row.closingBalance = row.openingBalance + row.receipts + row.transfersIn + row.returnsIn
        - row.consumptions - row.dispensings - row.transfersOut - row.disposals + row.adjustments;
    }

    res.json({
      period: { from, to },
      facilityId: facilityId ?? null,
      rows: Object.values(rowMap).sort((a, b) => a.medicineName.localeCompare(b.medicineName)),
    });
  } catch (e) {
    next(e);
  }
});

// GET /stock/in-hand — real-time inventory (all batches with qty > 0)
router.get("/in-hand", stockView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const q = (req.query.q as string | undefined)?.trim();
    const medicineId = req.query.medicineId as string | undefined;
    const batchNumber = (req.query.batchNumber as string | undefined)?.trim();
    const categoryId = req.query.categoryId as string | undefined;
    const expiryStatus = req.query.expiryStatus as string | undefined; // "expired"|"expiring"|"ok"
    const sortBy = (req.query.sortBy as string | undefined) ?? "medicineName";
    const sortDir = req.query.sortDir === "desc" ? "desc" : "asc";
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize as string, 10) || 100));

    const where = {
      ...(facilityId ? { facilityId } : {}),
      ...(batchNumber ? { batchNumber: { contains: batchNumber, mode: "insensitive" as const } } : {}),
      quantity: { gt: 0 },
      medicine: {
        isActive: true,
        deletedAt: null,
        ...(medicineId ? { id: medicineId } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(q
          ? {
              OR: [
                { medicineName: { contains: q, mode: "insensitive" as const } },
                { genericName: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
    };
    const orderBy = (() => {
      if (sortBy === "expiryDate") return { expiryDate: sortDir } as const;
      if (sortBy === "quantity") return { quantity: sortDir } as const;
      if (sortBy === "batchNumber") return { batchNumber: sortDir } as const;
      if (sortBy === "category") return { medicine: { category: { name: sortDir } } } as const;
      if (sortBy === "facility") return { facility: { name: sortDir } } as const;
      return { medicine: { medicineName: sortDir } } as const;
    })();
    const include = {
      medicine: {
        include: { category: { select: { id: true, name: true, coldStorage: true, controlledDrug: true } } },
      },
      facility: { select: { id: true, name: true, code: true } },
    };

    // Fetch all matching batches for expiry-status post-filter, then paginate in memory.
    // This is necessary because daysLeft is computed after fetch (expiryStatus is a derived field).
    const allBatches = await prisma.stockBatch.findMany({ where, include, orderBy });

    const now = new Date();
    const warningDays = config.expiryWarningDays;

    const decorated = allBatches.map((b) => {
      const daysLeft = Math.ceil((b.expiryDate.getTime() - now.getTime()) / 86400000);
      const status =
        daysLeft <= 0
          ? "Expired"
          : daysLeft <= config.expiryCriticalDays
            ? "Expiring Soon (Critical)"
            : daysLeft <= warningDays
              ? "Expiring Soon"
              : "In Date";
      return { ...b, daysLeft, status };
    });

    const filtered = decorated.filter((b) => {
      if (!expiryStatus) return true;
      if (expiryStatus === "expired") return b.daysLeft <= 0;
      if (expiryStatus === "not-expired") return b.daysLeft > 0;
      if (expiryStatus === "expiring") return b.daysLeft > 0 && b.daysLeft <= warningDays;
      if (expiryStatus === "ok") return b.daysLeft > warningDays;
      return true;
    });

    const total = filtered.length;
    const data = filtered.slice((page - 1) * pageSize, page * pageSize);

    res.json({ data, total, page, pageSize });
  } catch (e) {
    next(e);
  }
});

// GET /stock/in-hand/export — CSV export, mirrors every filter from /stock/in-hand
router.get("/in-hand/export", stockView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const q = (req.query.q as string | undefined)?.trim();
    const medicineId = req.query.medicineId as string | undefined;
    const batchNumber = (req.query.batchNumber as string | undefined)?.trim();
    const categoryId = req.query.categoryId as string | undefined;
    const expiryStatus = req.query.expiryStatus as string | undefined;
    const warningDays = config.expiryWarningDays;

    const batches = await prisma.stockBatch.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        ...(batchNumber ? { batchNumber: { contains: batchNumber, mode: "insensitive" } } : {}),
        quantity: { gt: 0 },
        medicine: {
          isActive: true,
          deletedAt: null,
          ...(medicineId ? { id: medicineId } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(q
            ? { OR: [{ medicineName: { contains: q, mode: "insensitive" } }, { genericName: { contains: q, mode: "insensitive" } }] }
            : {}),
        },
      },
      include: {
        medicine: {
          select: {
            medicineName: true,
            genericName: true,
            dosageForm: true,
            category: { select: { name: true } },
          },
        },
        facility: { select: { name: true, code: true } },
      },
      orderBy: { medicine: { medicineName: "asc" } },
    });

    const now = new Date();
    const escape = (v: unknown) => {
      const s = String(v ?? "");
      return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ["Medicine", "Generic Name", "Dosage Form", "Category", "Facility", "Facility Code", "Batch Number", "Quantity", "Expiry Date", "Days Left", "Status"];
    const rows = batches
      .map((b) => {
        const daysLeft = Math.ceil((b.expiryDate.getTime() - now.getTime()) / 86400000);
        const status =
          daysLeft <= 0 ? "Expired"
          : daysLeft <= config.expiryCriticalDays ? "Expiring Soon (Critical)"
          : daysLeft <= warningDays ? "Expiring Soon"
          : "In Date";
        return { b, daysLeft, status };
      })
      .filter(({ daysLeft }) => {
        if (!expiryStatus) return true;
        if (expiryStatus === "expired") return daysLeft <= 0;
        if (expiryStatus === "not-expired") return daysLeft > 0;
        if (expiryStatus === "expiring") return daysLeft > 0 && daysLeft <= warningDays;
        if (expiryStatus === "ok") return daysLeft > warningDays;
        return true;
      })
      .map(({ b, daysLeft, status }) => [
        b.medicine.medicineName,
        b.medicine.genericName ?? "",
        b.medicine.dosageForm ?? "",
        b.medicine.category?.name ?? "",
        b.facility.name,
        b.facility.code,
        b.batchNumber,
        b.quantity,
        b.expiryDate.toISOString().slice(0, 10),
        daysLeft,
        status,
      ]);

    const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const filename = `stock-in-hand-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send("﻿" + csv);
  } catch (e) {
    next(e);
  }
});

export default router;
