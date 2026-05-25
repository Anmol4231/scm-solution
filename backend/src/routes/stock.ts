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

// Stock receipt
const receiptSchema = z.object({
  medicineId: z.string(),
  batchNumber: z.string(),
  expiryDate: z.string(),
  quantityReceived: z.number().positive(),
  quantityRequested: z.number().positive().optional(),
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
  quantityUsed: z.number().positive(),
  reportingPeriod: z.string(),
});

router.post("/consumption", async (req, res, next) => {
  try {
    const data = consumptionSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

    const batches = await prisma.stockBatch.findMany({
      where: { medicineId: data.medicineId, facilityId, quantity: { gt: 0 } },
      orderBy: { expiryDate: "asc" },
    });

    let remaining = data.quantityUsed;
    for (const batch of batches) {
      if (remaining <= 0) break;
      const deduct = Math.min(batch.quantity, remaining);
      await prisma.stockBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: deduct } },
      });
      remaining -= deduct;
    }

    if (remaining > 0) {
      return res.status(400).json({ error: "Insufficient stock for consumption report" });
    }

    await prisma.consumptionReport.create({
      data: { facilityId, medicineId: data.medicineId, quantityUsed: data.quantityUsed, reportingPeriod: data.reportingPeriod },
    });

    const balance = await getMedicineBalance(data.medicineId, facilityId);
    const tx = await prisma.stockTransaction.create({
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

    res.status(201).json({ transaction: tx, balance });
  } catch (e) {
    next(e);
  }
});

// Stock adjustment
const adjustmentSchema = z.object({
  medicineId: z.string(),
  physicalCount: z.number().min(0),
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
    const facilityId = getFacilityId(req, req.query.facilityId as string)!;
    const medicineId = req.query.medicineId as string | undefined;

    if (medicineId) {
      const batches = await prisma.stockBatch.findMany({
        where: { facilityId, medicineId, quantity: { gt: 0 } },
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
    const facilityId = getFacilityId(req, req.query.facilityId as string)!;
    const batches = await prisma.stockBatch.findMany({
      where: { facilityId, quantity: { gt: 0 } },
      include: { medicine: true },
      orderBy: { expiryDate: "asc" },
    });
    res.json(batches);
  } catch (e) {
    next(e);
  }
});

router.get("/export", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string)!;
    const batches = await prisma.stockBatch.findMany({
      where: { facilityId },
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
    const facilityId = getFacilityId(req, req.query.facilityId as string)!;
    const txs = await prisma.stockTransaction.findMany({
      where: { facilityId },
      include: { medicine: true, batch: true, performedBy: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(txs);
  } catch (e) {
    next(e);
  }
});

export default router;
