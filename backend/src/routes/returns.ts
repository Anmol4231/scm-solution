import { Router } from "express";
import { z } from "zod";
import { ReturnType, MedicineCondition, StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { logAudit } from "../services/audit";

const router = Router();
router.use(authenticate, requireFacility);

const facilityReturnSchema = z.object({
  returnType: z.literal("FACILITY_TO_AMS"),
  medicineId: z.string(),
  batchNumber: z.string(),
  expiryDate: z.string(),
  quantity: z.number().positive(),
  returnReason: z.string(),
  returnDestination: z.string().optional(),
  notes: z.string().optional(),
});

const patientReturnSchema = z.object({
  returnType: z.literal("PATIENT_RETURN"),
  patientId: z.string(),
  medicineId: z.string(),
  quantity: z.number().positive(),
  condition: z.nativeEnum(MedicineCondition),
  returnReason: z.string(),
  batchNumber: z.string().optional(),
  notes: z.string().optional(),
});

router.post("/facility-to-ams", async (req, res, next) => {
  try {
    const data = facilityReturnSchema.parse({ ...req.body, returnType: "FACILITY_TO_AMS" });
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;
    const expiryDate = new Date(data.expiryDate);

    const batch = await prisma.stockBatch.findUnique({
      where: {
        medicineId_facilityId_batchNumber: {
          medicineId: data.medicineId,
          facilityId,
          batchNumber: data.batchNumber,
        },
      },
    });

    if (batch) {
      await prisma.stockBatch.update({
        where: { id: batch.id },
        data: { quantity: { decrement: data.quantity } },
      });
    }

    const ret = await prisma.medicineReturn.create({
      data: {
        returnType: ReturnType.FACILITY_TO_AMS,
        facilityId,
        medicineId: data.medicineId,
        batchId: batch?.id,
        batchNumber: data.batchNumber,
        expiryDate,
        quantity: data.quantity,
        returnReason: data.returnReason,
        returnDestination: data.returnDestination || "AMS",
        reusable: true,
        stockAdjusted: true,
        processedById: userId,
        notes: data.notes,
      },
    });

    await prisma.stockTransaction.create({
      data: {
        facilityId,
        medicineId: data.medicineId,
        batchId: batch?.id,
        type: StockTransactionType.RETURN_OUT,
        quantity: -data.quantity,
        reason: data.returnReason,
        performedById: userId,
      },
    });

    await logAudit({ facilityId, userId, action: "RETURN_AMS", entityType: "MedicineReturn", entityId: ret.id });
    res.status(201).json(ret);
  } catch (e) {
    next(e);
  }
});

router.post("/patient", async (req, res, next) => {
  try {
    const data = patientReturnSchema.parse({ ...req.body, returnType: "PATIENT_RETURN" });
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;
    const reusable = data.condition === "UNOPENED" || data.condition === "OPENED_UNDAMAGED";

    let batchId: string | undefined;
    if (reusable && data.batchNumber) {
      const batch = await prisma.stockBatch.findUnique({
        where: {
          medicineId_facilityId_batchNumber: {
            medicineId: data.medicineId,
            facilityId,
            batchNumber: data.batchNumber,
          },
        },
      });
      if (batch) {
        await prisma.stockBatch.update({
          where: { id: batch.id },
          data: { quantity: { increment: data.quantity } },
        });
        batchId = batch.id;
        await prisma.stockTransaction.create({
          data: {
            facilityId,
            medicineId: data.medicineId,
            batchId: batch.id,
            type: StockTransactionType.RETURN_IN,
            quantity: data.quantity,
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
        stockAdjusted: reusable,
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

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string)!;
    const returns = await prisma.medicineReturn.findMany({
      where: { facilityId },
      include: { medicine: true, patient: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(returns);
  } catch (e) {
    next(e);
  }
});

export default router;
