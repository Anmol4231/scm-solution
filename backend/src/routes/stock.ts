import { Router } from "express";
import { z } from "zod";
import { StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { getMedicineBalance, getBatchSupplyTotals, periodStart, daysUntilExpiry } from "../utils/stock";
import { config } from "../utils/config";
import { logAudit } from "../services/audit";
import { createAlert } from "../services/alerts";
import { AlertType, AlertSeverity } from "@prisma/client";

const router = Router();
router.use(authenticate, requireFacility);

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

router.post("/receipt", async (req, res, next) => {
  try {
    const data = receiptSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

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

router.post("/consumption", async (req, res, next) => {
  try {
    const data = consumptionSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

    let result: { balance: number; transactionId: string };
    try {
      result = await prisma.$transaction(async (tx) => {
        const batches = await tx.stockBatch.findMany({
          where: { medicineId: data.medicineId, facilityId, quantity: { gt: 0 } },
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
        if (remaining > 0) throw new InsufficientStockError("Insufficient stock for the recorded consumption");

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
});

router.post("/adjustment", async (req, res, next) => {
  try {
    const data = adjustmentSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;
    const systemBalance = await getMedicineBalance(data.medicineId, facilityId);
    const discrepancy = data.physicalCount - systemBalance;

    const batches = await prisma.stockBatch.findMany({
      where: { medicineId: data.medicineId, facilityId },
      orderBy: { createdAt: "asc" },
      take: 1,
    });

    if (batches[0] && discrepancy !== 0) {
      await prisma.stockBatch.update({
        where: { id: batches[0].id },
        data: { quantity: { increment: discrepancy } },
      });
    }

    const tx = await prisma.stockTransaction.create({
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

    await logAudit({
      facilityId,
      userId,
      action: "STOCK_ADJUSTMENT",
      entityType: "Medicine",
      entityId: data.medicineId,
      details: { systemBalance, physicalCount: data.physicalCount, discrepancy, reason: data.reason },
    });

    res.status(201).json({ transaction: tx, systemBalance, physicalCount: data.physicalCount, discrepancy });
  } catch (e) {
    next(e);
  }
});

router.get("/balance", async (req, res, next) => {
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

router.get("/batches", async (req, res, next) => {
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

router.get("/export", async (req, res, next) => {
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

router.get("/transactions", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const type = req.query.type as string | undefined;
    const medicineId = req.query.medicineId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const skip = parseInt((req.query.skip as string) ?? "0", 10) || 0;
    const take = Math.min(parseInt((req.query.take as string) ?? "50", 10) || 50, 200);

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
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ]);

    res.json({ total, skip, take, transactions: txs });
  } catch (e) {
    next(e);
  }
});

// GET /stock/movement — stock movement summary: opening + receipts − issues = closing per period
router.get("/movement", async (req, res, next) => {
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
router.get("/in-hand", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const q = (req.query.q as string | undefined)?.trim();
    const categoryId = req.query.categoryId as string | undefined;
    const expiryStatus = req.query.expiryStatus as string | undefined; // "expired"|"expiring"|"ok"
    const sortBy = (req.query.sortBy as string | undefined) ?? "medicineName";
    const sortDir = req.query.sortDir === "desc" ? "desc" : "asc";

    const batches = await prisma.stockBatch.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        quantity: { gt: 0 },
        medicine: {
          isActive: true,
          deletedAt: null,
          ...(categoryId ? { categoryId } : {}),
          ...(q
            ? {
                OR: [
                  { medicineName: { contains: q, mode: "insensitive" } },
                  { genericName: { contains: q, mode: "insensitive" } },
                ],
              }
            : {}),
        },
      },
      include: {
        medicine: {
          include: { category: { select: { id: true, name: true, coldStorage: true, controlledDrug: true } } },
        },
        facility: { select: { id: true, name: true, code: true } },
      },
      orderBy: (() => {
        if (sortBy === "expiryDate") return { expiryDate: sortDir } as const;
        if (sortBy === "quantity") return { quantity: sortDir } as const;
        if (sortBy === "batchNumber") return { batchNumber: sortDir } as const;
        return { medicine: { medicineName: sortDir } } as const;
      })(),
    });

    const now = new Date();
    const warningDays = config.expiryWarningDays;

    const result = batches
      .map((b) => {
        const daysLeft = Math.ceil((b.expiryDate.getTime() - now.getTime()) / 86400000);
        const status =
          daysLeft <= 0
            ? "Expired"
            : daysLeft <= config.expiryCriticalDays
              ? "Expiring Soon (Critical)"
              : daysLeft <= warningDays
                ? "Expiring Soon"
                : "OK";
        return { ...b, daysLeft, status };
      })
      .filter((b) => {
        if (!expiryStatus) return true;
        if (expiryStatus === "expired") return b.daysLeft <= 0;
        if (expiryStatus === "expiring") return b.daysLeft > 0 && b.daysLeft <= warningDays;
        if (expiryStatus === "ok") return b.daysLeft > warningDays;
        return true;
      });

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// GET /stock/in-hand/export — CSV export, mirrors every filter from /stock/in-hand
router.get("/in-hand/export", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const q = (req.query.q as string | undefined)?.trim();
    const categoryId = req.query.categoryId as string | undefined;
    const expiryStatus = req.query.expiryStatus as string | undefined;
    const warningDays = config.expiryWarningDays;

    const batches = await prisma.stockBatch.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        quantity: { gt: 0 },
        medicine: {
          isActive: true,
          deletedAt: null,
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
          : "OK";
        return { b, daysLeft, status };
      })
      .filter(({ daysLeft }) => {
        if (!expiryStatus) return true;
        if (expiryStatus === "expired") return daysLeft <= 0;
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
