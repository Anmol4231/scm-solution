import { Router } from "express";
import { z } from "zod";
import { DispensingRecipientType, Prisma, StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { logAudit } from "../services/audit";
import { checkLowStockAndStockout } from "../services/alerts";

const router = Router();
router.use(authenticate, requireFacility);

const dispenseView   = requirePermission("dispensing", "view");
const dispenseCreate = requirePermission("dispensing", "create");

const positiveWholeNumber = z.number().int("Quantity must be a whole number").positive("Quantity must be greater than zero");

/** Thrown inside a $transaction to roll it back and surface a 400 instead of a 500. */
class InsufficientStockError extends Error {}

/**
 * Resolves the facility to dispense from. Pharmacists use their own facility;
 * cross-facility users (facilityId = null) must supply one explicitly. Returns
 * null when none can be determined so the caller can answer 400 instead of crashing.
 */
function resolveDispenseFacility(req: Parameters<typeof getFacilityId>[0], explicit?: string): string | null {
  return getFacilityId(req, explicit) ?? null;
}

/**
 * Atomically decrement a batch only if it still holds enough stock. The conditional
 * `WHERE quantity >= qty` makes the check-and-decrement a single SQL statement, so
 * concurrent dispenses can never drive stock negative. Returns false if it couldn't.
 */
async function decrementBatch(
  tx: Prisma.TransactionClient,
  batchId: string,
  quantity: number
): Promise<boolean> {
  const result = await tx.stockBatch.updateMany({
    where: { id: batchId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  return result.count > 0;
}

const dispenseSchema = z.object({
  patientId: z.string().min(1),
  prescriptionId: z.string().min(1),
  medicineId: z.string(),
  batchId: z.string(),
  facilityId: z.string().optional(),
  dosage: z.string().optional(),
  form: z.string().optional(),
  quantity: positiveWholeNumber,
  duration: z.string().optional(),
  notes: z.string().optional(),
  dispensingPurpose: z.string().optional(),
  prescribingDepartment: z.string().optional(),
});

router.post("/", dispenseCreate, async (req, res, next) => {
  try {
    const data = dispenseSchema.parse(req.body);
    const facilityId = resolveDispenseFacility(req, data.facilityId);
    if (!facilityId) return res.status(400).json({ error: "Select a facility to dispense from." });
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

    // Enforce requiresPrescription: medicine must be listed on the prescription.
    const medicine = await prisma.medicine.findFirst({
      where: { id: data.medicineId },
      select: { medicineName: true, category: { select: { requiresPrescription: true } } },
    });
    if (medicine?.category?.requiresPrescription) {
      const onRx = await prisma.prescriptionMedicine.findFirst({
        where: { prescriptionId: data.prescriptionId, medicineId: data.medicineId },
      });
      if (!onRx) {
        return res.status(400).json({
          error: `"${medicine.medicineName}" requires a prescription. It must be listed on the prescription before dispensing.`,
        });
      }
    }

    const batch = await prisma.stockBatch.findFirst({
      where: { id: data.batchId, facilityId, medicineId: data.medicineId },
    });
    if (!batch) return res.status(404).json({ error: "Batch not found" });

    let record;
    try {
      record = await prisma.$transaction(async (tx) => {
        const ok = await decrementBatch(tx, batch.id, data.quantity);
        if (!ok) throw new InsufficientStockError("Insufficient batch quantity");

        const created = await tx.dispensingRecord.create({
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
          include: { patient: true, healthcareWorker: true, medicine: true, prescription: true },
        });

        await tx.stockTransaction.create({
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
        return created;
      });
    } catch (e) {
      if (e instanceof InsufficientStockError) return res.status(400).json({ error: e.message });
      throw e;
    }

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

/**
 * Builds a dispensing "plan" from a prescription: each prescribed medicine with
 * its available batches (FEFO order) and a recommended batch. Powers the unified
 * dispensing workflow so the pharmacist sees auto-loaded lines + auto-picked batch.
 */
router.get("/prescription/:id/plan", dispenseView, async (req, res, next) => {
  try {
    const facilityId = resolveDispenseFacility(req, req.query.facilityId as string | undefined);
    if (!facilityId) return res.status(400).json({ error: "Select a facility to dispense from." });
    const prescription = await prisma.prescription.findFirst({
      where: { id: req.params.id, facilityId },
      include: {
        patient: true,
        medicines: {
          include: { medicine: { include: { category: { select: { requiresPrescription: true } } } } },
        },
      },
    });
    if (!prescription) return res.status(404).json({ error: "Prescription not found at this facility" });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lines = await Promise.all(
      prescription.medicines.map(async (pm) => {
        // FEFO: soonest non-expired batch with stock first.
        const batches = await prisma.stockBatch.findMany({
          where: { facilityId, medicineId: pm.medicineId, quantity: { gt: 0 }, expiryDate: { gte: today } },
          orderBy: { expiryDate: "asc" },
          select: { id: true, batchNumber: true, expiryDate: true, quantity: true },
        });
        const onHand = batches.reduce((sum, b) => sum + b.quantity, 0);
        return {
          medicineId: pm.medicineId,
          medicineName: pm.medicine.medicineName,
          dosage: pm.dosage ?? "",
          form: pm.form ?? pm.medicine.dosageForm ?? "",
          duration: pm.duration ?? "",
          requestedQuantity: pm.quantity ?? null,
          onHand,
          recommendedBatchId: batches[0]?.id ?? null,
          batches,
          requiresPrescription: pm.medicine.category?.requiresPrescription ?? false,
        };
      })
    );

    res.json({
      prescription: {
        id: prescription.id,
        prescriptionId: prescription.prescriptionId,
        status: prescription.status,
        patientId: prescription.patientId,
        patient: prescription.patient,
        department: prescription.department,
        doctorName: prescription.doctorName,
      },
      lines,
    });
  } catch (e) {
    next(e);
  }
});

const batchLineSchema = z.object({
  medicineId: z.string().min(1),
  batchId: z.string().min(1),
  quantity: positiveWholeNumber,
  dosage: z.string().optional(),
  form: z.string().optional(),
  duration: z.string().optional(),
  notes: z.string().optional(),
});

const batchDispenseSchema = z.object({
  patientId: z.string().min(1),
  prescriptionId: z.string().min(1),
  facilityId: z.string().optional(),
  dispensingPurpose: z.string().optional(),
  prescribingDepartment: z.string().optional(),
  lines: z.array(batchLineSchema).min(1, "At least one medicine line is required"),
});

/** Dispense all confirmed lines for a prescription in a single atomic transaction. */
router.post("/batch", dispenseCreate, async (req, res, next) => {
  try {
    const data = batchDispenseSchema.parse(req.body);
    const facilityId = resolveDispenseFacility(req, data.facilityId);
    if (!facilityId) return res.status(400).json({ error: "Select a facility to dispense from." });
    const userId = req.user!.userId;

    const prescription = await prisma.prescription.findFirst({
      where: { id: data.prescriptionId, patientId: data.patientId, facilityId, status: "ACTIVE" },
    });
    if (!prescription) {
      return res.status(400).json({ error: "Active prescription required for this patient" });
    }

    // Enforce requiresPrescription: every Rx-required medicine must appear on the prescription.
    const medicinesForCheck = await prisma.medicine.findMany({
      where: { id: { in: data.lines.map((l) => l.medicineId) } },
      select: { id: true, medicineName: true, category: { select: { requiresPrescription: true } } },
    });
    const rxRequiredMeds = medicinesForCheck.filter((m) => m.category?.requiresPrescription);
    if (rxRequiredMeds.length > 0) {
      const prescriptionMedIds = new Set(
        (await prisma.prescriptionMedicine.findMany({
          where: { prescriptionId: data.prescriptionId },
          select: { medicineId: true },
        })).map((r) => r.medicineId)
      );
      for (const med of rxRequiredMeds) {
        if (!prescriptionMedIds.has(med.id)) {
          return res.status(400).json({
            error: `"${med.medicineName}" requires a prescription. It must be listed on the prescription before dispensing.`,
          });
        }
      }
    }

    // Pre-validate batch ↔ medicine pairing (cheap, friendly error). The authoritative
    // stock check is the conditional decrement inside the transaction below.
    const batches = await prisma.stockBatch.findMany({
      where: { id: { in: data.lines.map((l) => l.batchId) }, facilityId },
    });
    const batchById = new Map(batches.map((b) => [b.id, b]));
    for (const line of data.lines) {
      const batch = batchById.get(line.batchId);
      if (!batch || batch.medicineId !== line.medicineId) {
        return res.status(404).json({ error: `Batch not found for one of the medicines` });
      }
    }

    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const records = [];
        for (const line of data.lines) {
          const batch = batchById.get(line.batchId)!;
          const ok = await decrementBatch(tx, batch.id, line.quantity);
          if (!ok) throw new InsufficientStockError(`Insufficient stock in batch ${batch.batchNumber}`);
          const record = await tx.dispensingRecord.create({
          data: {
            facilityId,
            recipientType: DispensingRecipientType.PATIENT,
            patientId: data.patientId,
            prescriptionId: data.prescriptionId,
            medicineId: line.medicineId,
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            dosage: line.dosage,
            form: line.form,
            quantity: line.quantity,
            duration: line.duration,
            notes: line.notes,
            dispensingPurpose: data.dispensingPurpose,
            prescribingDepartment: data.prescribingDepartment,
            dispensedById: userId,
          },
        });
        await tx.stockTransaction.create({
          data: {
            facilityId,
            medicineId: line.medicineId,
            batchId: batch.id,
            type: StockTransactionType.DISPENSING,
            quantity: -line.quantity,
            patientId: data.patientId,
            prescriptionId: data.prescriptionId,
            performedById: userId,
            notes: line.notes,
          },
        });
        records.push(record);
      }
      return records;
      });
    } catch (e) {
      if (e instanceof InsufficientStockError) return res.status(400).json({ error: e.message });
      throw e;
    }

    await logAudit({
      facilityId,
      userId,
      action: "DISPENSE",
      entityType: "Prescription",
      entityId: data.prescriptionId,
      details: {
        prescriptionId: data.prescriptionId,
        patientId: data.patientId,
        lineCount: created.length,
        lines: data.lines.map((l) => ({ medicineId: l.medicineId, quantity: l.quantity })),
      },
    });

    await checkLowStockAndStockout(facilityId);
    res.status(201).json({ count: created.length, records: created });
  } catch (e) {
    next(e);
  }
});

router.get("/", dispenseView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const records = await prisma.dispensingRecord.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
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
