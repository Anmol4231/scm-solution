import { Router } from "express";
import { z } from "zod";
import { ReturnType, MedicineCondition, StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { isCrossFacilityRole } from "../utils/roles";
import { logAudit } from "../services/audit";
import { assertNotExpired, isExpired, decrementBatchOrThrow } from "../utils/stockGuards";
import { getMedicineBalance, getMedicineBalanceTx } from "../utils/stock";

const router = Router();
router.use(authenticate, requireFacility);

const returnsView   = requirePermission("returns", "view");
const returnsCreate = requirePermission("returns", "create");

const positiveNum = z.number().positive();

// ─── Patient Return ───────────────────────────────────────────────────────────

const patientReturnSchema = z.object({
  patientId: z.string(),
  dispensingRecordId: z.string().optional(),
  medicineId: z.string(),
  quantity: positiveNum,
  condition: z.nativeEnum(MedicineCondition),
  returnReason: z.string().min(1),
  batchNumber: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/patient", returnsCreate, async (req, res, next) => {
  try {
    const data = patientReturnSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;
    const reusable = data.condition === "UNOPENED" || data.condition === "OPENED_UNDAMAGED";

    // If a dispensingRecordId is provided, validate quantity
    if (data.dispensingRecordId) {
      const record = await prisma.dispensingRecord.findFirst({ where: { id: data.dispensingRecordId, facilityId } });
      if (record && data.quantity > record.quantity) {
        return res.status(400).json({ error: `Quantity returned (${data.quantity}) exceeds quantity dispensed (${record.quantity})` });
      }
    }

    let batchId: string | undefined;
    let restocked = false;
    if (reusable && data.batchNumber) {
      const batch = await prisma.stockBatch.findUnique({
        where: { medicineId_facilityId_batchNumber: { medicineId: data.medicineId, facilityId, batchNumber: data.batchNumber } },
      });
      // Only return stock to available inventory if the batch is ACTIVE and not expired.
      // Expired / quarantined stock must never re-enter usable inventory via a return.
      if (batch && batch.status === "ACTIVE" && !isExpired(batch.expiryDate)) {
        const balanceBefore = await getMedicineBalance(data.medicineId, facilityId);
        await prisma.stockBatch.update({ where: { id: batch.id }, data: { quantity: { increment: data.quantity } } });
        batchId = batch.id;
        restocked = true;
        await prisma.stockTransaction.create({
          data: {
            facilityId,
            medicineId: data.medicineId,
            batchId: batch.id,
            type: StockTransactionType.RETURN_IN,
            quantity: data.quantity,
            balanceBefore,
            balanceAfter: balanceBefore + data.quantity,
            patientId: data.patientId,
            reason: data.returnReason,
            performedById: userId,
          },
        });
      }
    }

    const ret = await prisma.medicineReturn.create({
      data: {
        returnType: ReturnType.PATIENT_RETURN,
        facilityId,
        medicineId: data.medicineId,
        patientId: data.patientId,
        batchId,
        batchNumber: data.batchNumber,
        quantity: data.quantity,
        condition: data.condition,
        returnReason: data.returnReason,
        reusable,
        stockAdjusted: restocked,
        processedById: userId,
        notes: data.notes,
      },
      include: { patient: true, medicine: true },
    });

    await logAudit({ facilityId, userId, action: "PATIENT_RETURN", entityType: "MedicineReturn", entityId: ret.id });
    res.status(201).json(ret);
  } catch (e) {
    next(e);
  }
});

// ─── Facility → AMS / Inter-Facility Return ───────────────────────────────────

const facilityReturnSchema = z.object({
  returnType: z.enum(["FACILITY_TO_AMS", "INTER_FACILITY"]),
  receivingFacilityId: z.string().min(1, "Receiving facility is required"),
  batchId: z.string().min(1, "Batch is required"),
  quantity: positiveNum,
  returnReason: z.string().min(1),
  notes: z.string().optional(),
});

router.post("/facility", returnsCreate, async (req, res, next) => {
  try {
    const data = facilityReturnSchema.parse(req.body);
    const userId = req.user!.userId;

    // Source medicine, batch, expiry and facility are all derived from the selected
    // batch (mirrors the Transfers "Send" workflow) — never trusted from free-text input.
    const sourceBatch = await prisma.stockBatch.findUnique({ where: { id: data.batchId } });
    if (!sourceBatch || sourceBatch.quantity < data.quantity) {
      return res.status(400).json({ error: "Invalid batch or insufficient quantity" });
    }
    const facilityId = sourceBatch.facilityId;
    const medicineId = sourceBatch.medicineId;
    const batchNumber = sourceBatch.batchNumber;
    const expiryDate = sourceBatch.expiryDate;

    // Facility-scoped users may only return stock held by their own facility.
    if (!isCrossFacilityRole(req.user!.role)) {
      if (!req.user!.facilityId) return res.status(400).json({ error: "Facility selection required" });
      if (facilityId !== req.user!.facilityId) {
        return res.status(403).json({ error: "You can only return stock from your own facility" });
      }
    }

    if (data.receivingFacilityId === facilityId) {
      return res.status(400).json({ error: "Receiving facility must differ from source" });
    }

    // A facility return credits the destination as usable inventory, so it is a
    // form of receiving — expired stock must never flow through it. Dispose expired
    // stock via the Expiry / disposal workflow instead.
    assertNotExpired(expiryDate, batchNumber);

    await prisma.$transaction(async (tx) => {
      // Deduct from returning facility (conditional decrement — never goes negative)
      const srcBefore = await getMedicineBalanceTx(tx, medicineId, facilityId);
      await decrementBatchOrThrow(tx, sourceBatch.id, data.quantity, `batch ${batchNumber}`);
      await tx.stockTransaction.create({
        data: {
          facilityId,
          medicineId,
          batchId: sourceBatch.id,
          type: StockTransactionType.RETURN_OUT,
          quantity: -data.quantity,
          balanceBefore: srcBefore,
          balanceAfter: srcBefore - data.quantity,
          reason: data.returnReason,
          performedById: userId,
        },
      });

      // Credit receiving facility (AMS or peer)
      const destBefore = await getMedicineBalanceTx(tx, medicineId, data.receivingFacilityId);
      let destBatch = await tx.stockBatch.findUnique({
        where: { medicineId_facilityId_batchNumber: { medicineId, facilityId: data.receivingFacilityId, batchNumber } },
      });
      if (destBatch) {
        destBatch = await tx.stockBatch.update({ where: { id: destBatch.id }, data: { quantity: { increment: data.quantity } } });
      } else {
        destBatch = await tx.stockBatch.create({
          data: { medicineId, facilityId: data.receivingFacilityId, batchNumber, expiryDate, quantity: data.quantity },
        });
      }
      await tx.stockTransaction.create({
        data: {
          facilityId: data.receivingFacilityId,
          medicineId,
          batchId: destBatch.id,
          type: StockTransactionType.RETURN_IN,
          quantity: data.quantity,
          balanceBefore: destBefore,
          balanceAfter: destBefore + data.quantity,
          reason: `Return from ${facilityId}: ${data.returnReason}`,
          performedById: userId,
        },
      });

      // Return record
      await tx.medicineReturn.create({
        data: {
          returnType: data.returnType as ReturnType,
          facilityId,
          medicineId,
          batchId: sourceBatch.id,
          batchNumber,
          expiryDate,
          quantity: data.quantity,
          returnReason: data.returnReason,
          returnDestination: data.receivingFacilityId,
          receivingFacilityId: data.receivingFacilityId,
          reusable: true,
          stockAdjusted: true,
          processedById: userId,
          notes: data.notes,
        },
      });
    });

    await logAudit({ facilityId, userId, action: data.returnType === "FACILITY_TO_AMS" ? "RETURN_AMS" : "RETURN_INTER_FACILITY", entityType: "MedicineReturn", entityId: facilityId, details: { receivingFacilityId: data.receivingFacilityId } });
    res.status(201).json({ message: "Return processed successfully" });
  } catch (e) {
    next(e);
  }
});

// Keep legacy endpoint for backward compat
router.post("/facility-to-ams", returnsCreate, async (req, res, next) => {
  req.body.returnType = "FACILITY_TO_AMS";
  if (!req.body.receivingFacilityId) req.body.receivingFacilityId = req.body.returnDestination;
  // Delegate to the new facility endpoint
  const handler = router.stack.find((l: any) => l.route?.path === "/facility");
  if (handler) return (handler as any).route.stack[0].handle(req, res, next);
  next();
});

router.get("/", returnsView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const returnType = req.query.returnType as string | undefined;
    const patientId = req.query.patientId as string | undefined;
    const returns = await prisma.medicineReturn.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        ...(returnType ? { returnType: returnType as ReturnType } : {}),
        ...(patientId ? { patientId } : {}),
      },
      include: {
        medicine: true,
        patient: true,
        facility: { select: { id: true, name: true, code: true } },
        processedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(returns);
  } catch (e) {
    next(e);
  }
});

export default router;
