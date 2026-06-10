import { Router } from "express";
import { z } from "zod";
import { DispensingRecipientType, StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { logAudit } from "../services/audit";
import { checkLowStockAndStockout } from "../services/alerts";
import { assertBatchAvailable, decrementBatchOrThrow } from "../utils/stockGuards";
import { getMedicineBalanceTx } from "../utils/stock";
import type { Prisma } from "@prisma/client";

const router = Router();
router.use(authenticate, requireFacility);

const dispenseView   = requirePermission("dispensing", "view");
const dispenseCreate = requirePermission("dispensing", "create");

const positiveWholeNumber = z.number().int("Quantity must be a whole number").positive("Quantity must be greater than zero");

/**
 * Resolves the facility to dispense from. Pharmacists use their own facility;
 * cross-facility users (facilityId = null) must supply one explicitly. Returns
 * null when none can be determined so the caller can answer 400 instead of crashing.
 */
function resolveDispenseFacility(req: Parameters<typeof getFacilityId>[0], explicit?: string): string | null {
  return getFacilityId(req, explicit) ?? null;
}

// ── Prescription fulfillment tracking (B-1) ──────────────────────────────────────

/**
 * Prescribed quantity per medicine for a prescription, summed across lines.
 * Returns `null` for a medicine when no line specifies a quantity (no cap to enforce).
 */
async function prescribedByMedicine(prescriptionId: string): Promise<Map<string, number | null>> {
  const lines = await prisma.prescriptionMedicine.findMany({
    where: { prescriptionId },
    select: { medicineId: true, quantity: true },
  });
  const map = new Map<string, number | null>();
  for (const l of lines) {
    if (l.quantity == null) {
      if (!map.has(l.medicineId)) map.set(l.medicineId, null);
    } else {
      const prev = map.get(l.medicineId);
      map.set(l.medicineId, (prev ?? 0) + l.quantity);
    }
  }
  return map;
}

/** Already-dispensed quantity per medicine for a prescription. */
async function dispensedByMedicine(prescriptionId: string): Promise<Map<string, number>> {
  const grouped = await prisma.dispensingRecord.groupBy({
    by: ["medicineId"],
    where: { prescriptionId },
    _sum: { quantity: true },
  });
  return new Map(grouped.map((g) => [g.medicineId, g._sum.quantity ?? 0]));
}

/**
 * Mark a prescription COMPLETED once every prescribed (quantified) medicine line
 * is fully dispensed. Prescriptions with any unquantified line stay ACTIVE.
 */
async function maybeCompletePrescription(tx: Prisma.TransactionClient, prescriptionId: string): Promise<void> {
  const lines = await tx.prescriptionMedicine.findMany({
    where: { prescriptionId },
    select: { medicineId: true, quantity: true },
  });
  const prescribed = new Map<string, number | null>();
  for (const l of lines) {
    if (l.quantity == null) { if (!prescribed.has(l.medicineId)) prescribed.set(l.medicineId, null); }
    else prescribed.set(l.medicineId, (prescribed.get(l.medicineId) ?? 0) + l.quantity);
  }
  if (prescribed.size === 0) return;

  const grouped = await tx.dispensingRecord.groupBy({
    by: ["medicineId"], where: { prescriptionId }, _sum: { quantity: true },
  });
  const dispensed = new Map(grouped.map((g) => [g.medicineId, g._sum.quantity ?? 0]));

  for (const [medicineId, qty] of prescribed) {
    if (qty == null) return; // can't auto-complete an open-ended line
    if ((dispensed.get(medicineId) ?? 0) < qty) return;
  }
  await tx.prescription.update({ where: { id: prescriptionId }, data: { status: "COMPLETED" } });
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

    // B-1: enforce prescribed quantity — cannot dispense more than remains on the Rx line.
    const prescribedMap = await prescribedByMedicine(data.prescriptionId);
    const prescribed = prescribedMap.get(data.medicineId);
    if (prescribed != null) {
      const already = (await dispensedByMedicine(data.prescriptionId)).get(data.medicineId) ?? 0;
      const remaining = prescribed - already;
      if (data.quantity > remaining) {
        return res.status(400).json({
          error: `Cannot dispense ${data.quantity} of "${medicine?.medicineName ?? "this medicine"}" — only ${Math.max(0, remaining)} remaining of ${prescribed} prescribed (${already} already dispensed).`,
        });
      }
    }

    const batch = await prisma.stockBatch.findFirst({
      where: { id: data.batchId, facilityId, medicineId: data.medicineId },
    });
    if (!batch) return res.status(404).json({ error: "Batch not found" });
    // Block dispensing of expired / quarantined stock.
    assertBatchAvailable(batch, `${medicine?.medicineName ?? "medicine"} (batch ${batch.batchNumber})`);

    const record = await prisma.$transaction(async (tx) => {
        const balanceBefore = await getMedicineBalanceTx(tx, data.medicineId, facilityId);
        await decrementBatchOrThrow(tx, batch.id, data.quantity, `batch ${batch.batchNumber}`);

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
            balanceBefore,
            balanceAfter: balanceBefore - data.quantity,
            patientId: data.patientId,
            prescriptionId: data.prescriptionId,
            performedById: userId,
            reason: "Dispensed to patient",
            notes: data.notes,
          },
        });
        await maybeCompletePrescription(tx, data.prescriptionId);
        return created;
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
        // FEFO: soonest non-expired, ACTIVE batch with stock first.
        const batches = await prisma.stockBatch.findMany({
          where: { facilityId, medicineId: pm.medicineId, quantity: { gt: 0 }, status: "ACTIVE", expiryDate: { gte: today } },
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

    const medNameById = new Map(medicinesForCheck.map((m) => [m.id, m.medicineName]));

    // B-1: enforce prescribed quantities. Aggregate requested-per-medicine across
    // this batch's lines and add to what has already been dispensed on the Rx.
    const prescribedMap = await prescribedByMedicine(data.prescriptionId);
    const alreadyMap = await dispensedByMedicine(data.prescriptionId);
    const requestedByMed = new Map<string, number>();
    for (const line of data.lines) {
      requestedByMed.set(line.medicineId, (requestedByMed.get(line.medicineId) ?? 0) + line.quantity);
    }
    for (const [medId, requested] of requestedByMed) {
      const prescribed = prescribedMap.get(medId);
      if (prescribed != null) {
        const already = alreadyMap.get(medId) ?? 0;
        const remaining = prescribed - already;
        if (requested > remaining) {
          return res.status(400).json({
            error: `Cannot dispense ${requested} of "${medNameById.get(medId) ?? "this medicine"}" — only ${Math.max(0, remaining)} remaining of ${prescribed} prescribed (${already} already dispensed).`,
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
      // Block dispensing of expired / quarantined stock.
      assertBatchAvailable(batch, `${medNameById.get(line.medicineId) ?? "medicine"} (batch ${batch.batchNumber})`);
    }

    const created = await prisma.$transaction(async (tx) => {
        const records = [];
        for (const line of data.lines) {
          const batch = batchById.get(line.batchId)!;
          const balanceBefore = await getMedicineBalanceTx(tx, line.medicineId, facilityId);
          await decrementBatchOrThrow(tx, batch.id, line.quantity, `batch ${batch.batchNumber}`);
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
            balanceBefore,
            balanceAfter: balanceBefore - line.quantity,
            patientId: data.patientId,
            prescriptionId: data.prescriptionId,
            performedById: userId,
            reason: "Dispensed to patient",
            notes: line.notes,
          },
        });
        records.push(record);
      }
      await maybeCompletePrescription(tx, data.prescriptionId);
      return records;
    });

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
