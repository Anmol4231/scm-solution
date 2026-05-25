import { Router } from "express";
import { z } from "zod";
import { DispensingRecipientType, StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { checkLowStockAndStockout } from "../services/alerts";

const router = Router();
router.use(authenticate, requireFacility);

const dispenseSchema = z.object({
  patientId: z.string().min(1),
  prescriptionId: z.string().min(1),
  medicineId: z.string(),
  batchId: z.string(),
  dosage: z.string().optional(),
  form: z.string().optional(),
  quantity: z.number().positive(),
  duration: z.string().optional(),
  notes: z.string().optional(),
  dispensingPurpose: z.string().optional(),
  prescribingDepartment: z.string().optional(),
});

router.post("/", async (req, res, next) => {
  try {
    const data = dispenseSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

    const prescription = await prisma.prescription.findFirst({
      where: {
        id: data.prescriptionId,
        patientId: data.patientId,
        facilityId,
        status: "ACTIVE",
      },
    });
    if (!prescription) {
      return res.status(400).json({ error: "Active prescription required for this patient" });
    }

    const batch = await prisma.stockBatch.findFirst({
      where: { id: data.batchId, facilityId, medicineId: data.medicineId },
    });
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    if (batch.quantity < data.quantity) {
      return res.status(400).json({ error: "Insufficient batch quantity" });
    }

    await prisma.stockBatch.update({
      where: { id: batch.id },
      data: { quantity: { decrement: data.quantity } },
    });

    const record = await prisma.dispensingRecord.create({
      data: {
        facilityId,
        recipientType: DispensingRecipientType.PATIENT,
        patientId: data.patientId,
        prescriptionId: data.prescriptionId,
        medicineId: data.medicineId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        dosage: data.dosage,
        form: data.form,
        quantity: data.quantity,
        duration: data.duration,
        notes: data.notes,
        dispensingPurpose: data.dispensingPurpose,
        prescribingDepartment: data.prescribingDepartment,
        dispensedById: userId,
      },
      include: {
        patient: true,
        healthcareWorker: true,
        medicine: true,
        prescription: true,
      },
    });

    await prisma.stockTransaction.create({
      data: {
        facilityId,
        medicineId: data.medicineId,
        batchId: batch.id,
        type: StockTransactionType.DISPENSING,
        quantity: -data.quantity,
        patientId: data.patientId,
        prescriptionId: data.prescriptionId,
        performedById: userId,
        notes: data.notes,
      },
    });

    await logAudit({
      facilityId,
      userId,
      action: "DISPENSE",
      entityType: "DispensingRecord",
      entityId: record.id,
      details: data,
    });

    await checkLowStockAndStockout(facilityId);
    res.status(201).json(record);
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string)!;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const records = await prisma.dispensingRecord.findMany({
      where: {
        facilityId,
        ...(req.query.today === "true" ? { dispensedAt: { gte: today } } : {}),
      },
      include: { patient: true, healthcareWorker: true, medicine: true },
      orderBy: { dispensedAt: "desc" },
      take: 50,
    });
    res.json(records);
  } catch (e) {
    next(e);
  }
});

export default router;
