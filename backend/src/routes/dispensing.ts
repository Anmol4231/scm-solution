import { Router } from "express";
import { z } from "zod";
import { DispensingRecipientType, StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { logAudit } from "../services/audit";
import { checkLowStockAndStockout } from "../services/alerts";
import { assertBatchAvailable, decrementBatchOrThrow, ValidationError } from "../utils/stockGuards";
import { getMedicineBalanceTx } from "../utils/stock";
import { isRxExpired, rxExpiresAt, RX_VALIDITY_DAYS, RX_VALIDITY_DAYS_CONTROLLED } from "../utils/rxValidity";
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
 * Authoritative in-transaction prescription guard. Takes a Postgres row lock on
 * the prescription (FOR UPDATE) so concurrent dispenses for the same Rx are
 * serialized, then re-verifies — under the lock — that the prescription is still
 * ACTIVE and that every requested quantity fits within what remains prescribed.
 *
 * The same checks run before the transaction for fast, friendly 400s; this is
 * the race-proof enforcement (two parallel requests can both pass the pre-check
 * under READ COMMITTED, but only one at a time can pass this one).
 */
async function lockAndValidatePrescription(
  tx: Prisma.TransactionClient,
  args: {
    prescriptionId: string;
    patientId: string;
    facilityId: string;
    requestedByMed: Map<string, number>;
    medNameById: Map<string, string>;
    /** Medicines in this request whose category is flagged controlledDrug. */
    controlledMedIds?: Set<string>;
  }
): Promise<void> {
  const { prescriptionId, patientId, facilityId, requestedByMed, medNameById, controlledMedIds } = args;

  // Serialize all dispensing for this prescription.
  await tx.$queryRaw`SELECT id FROM "Prescription" WHERE id = ${prescriptionId} FOR UPDATE`;

  const rx = await tx.prescription.findFirst({
    where: { id: prescriptionId, patientId, facilityId },
    select: { status: true, prescriptionDate: true },
  });
  if (!rx) throw new ValidationError("Prescription not found for this patient at this facility.");
  if (rx.status !== "ACTIVE") {
    throw new ValidationError(`Prescription is ${rx.status.toLowerCase()} and can no longer be dispensed.`);
  }
  // H3: prescription validity window.
  if (isRxExpired(rx.prescriptionDate)) {
    throw new ValidationError(
      `Prescription has expired — prescriptions are valid for ${RX_VALIDITY_DAYS} days (issued ${rx.prescriptionDate.toISOString().slice(0, 10)}).`
    );
  }
  if (controlledMedIds && controlledMedIds.size > 0 && isRxExpired(rx.prescriptionDate, true)) {
    const names = [...controlledMedIds].map((id) => medNameById.get(id) ?? "controlled medicine").join(", ");
    throw new ValidationError(
      `Controlled medicines (${names}) may only be dispensed within ${RX_VALIDITY_DAYS_CONTROLLED} days of prescribing.`
    );
  }

  const lines = await tx.prescriptionMedicine.findMany({
    where: { prescriptionId },
    select: { medicineId: true, quantity: true },
  });
  const prescribed = new Map<string, number | null>();
  for (const l of lines) {
    if (l.quantity == null) { if (!prescribed.has(l.medicineId)) prescribed.set(l.medicineId, null); }
    else prescribed.set(l.medicineId, (prescribed.get(l.medicineId) ?? 0) + l.quantity);
  }
  const grouped = await tx.dispensingRecord.groupBy({
    by: ["medicineId"], where: { prescriptionId }, _sum: { quantity: true },
  });
  const dispensed = new Map(grouped.map((g) => [g.medicineId, g._sum.quantity ?? 0]));

  for (const [medId, requested] of requestedByMed) {
    const cap = prescribed.get(medId);
    if (cap == null) {
      // C3/C4: controlled medicines must have an explicit prescribed quantity —
      // an open-ended line would otherwise allow unlimited dispensing.
      if (controlledMedIds?.has(medId)) {
        throw new ValidationError(
          `"${medNameById.get(medId) ?? "This medicine"}" is a controlled drug — it cannot be dispensed against a prescription line without a prescribed quantity.`
        );
      }
      continue; // unquantified legacy line — no cap to enforce
    }
    const already = dispensed.get(medId) ?? 0;
    const remaining = cap - already;
    if (requested > remaining) {
      throw new ValidationError(
        `Cannot dispense ${requested} of "${medNameById.get(medId) ?? "this medicine"}" — only ${Math.max(0, remaining)} remaining of ${cap} prescribed (${already} already dispensed).`
      );
    }
  }
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
    // H3: friendly pre-check (authoritative re-check happens under the row lock).
    if (isRxExpired(prescription.prescriptionDate)) {
      return res.status(400).json({
        error: `Prescription has expired — prescriptions are valid for ${RX_VALIDITY_DAYS} days (issued ${prescription.prescriptionDate.toISOString().slice(0, 10)}).`,
      });
    }

    // Enforce requiresPrescription/controlled: medicine must be listed on the prescription.
    const medicine = await prisma.medicine.findFirst({
      where: { id: data.medicineId },
      select: { medicineName: true, category: { select: { requiresPrescription: true, controlledDrug: true } } },
    });
    const isControlled = medicine?.category?.controlledDrug ?? false;
    if (medicine?.category?.requiresPrescription || isControlled) {
      const onRx = await prisma.prescriptionMedicine.findFirst({
        where: { prescriptionId: data.prescriptionId, medicineId: data.medicineId },
      });
      if (!onRx) {
        return res.status(400).json({
          error: `"${medicine!.medicineName}" requires a prescription. It must be listed on the prescription before dispensing.`,
        });
      }
    }
    if (isControlled && isRxExpired(prescription.prescriptionDate, true)) {
      return res.status(400).json({
        error: `"${medicine!.medicineName}" is a controlled drug — it may only be dispensed within ${RX_VALIDITY_DAYS_CONTROLLED} days of prescribing.`,
      });
    }

    // B-1: enforce prescribed quantity — cannot dispense more than remains on the Rx line.
    const prescribedMap = await prescribedByMedicine(data.prescriptionId);
    const prescribed = prescribedMap.get(data.medicineId);
    if (prescribed == null && isControlled) {
      return res.status(400).json({
        error: `"${medicine!.medicineName}" is a controlled drug — it cannot be dispensed against a prescription line without a prescribed quantity.`,
      });
    }
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
        // Authoritative, race-proof guard: lock the Rx row, re-check status + remaining qty.
        await lockAndValidatePrescription(tx, {
          prescriptionId: data.prescriptionId,
          patientId: data.patientId,
          facilityId,
          requestedByMed: new Map([[data.medicineId, data.quantity]]),
          medNameById: new Map([[data.medicineId, medicine?.medicineName ?? "medicine"]]),
          controlledMedIds: isControlled ? new Set([data.medicineId]) : undefined,
        });
        // Re-verify the batch under the transaction — it may have been
        // quarantined/expired between the pre-check and now.
        const freshBatch = await tx.stockBatch.findUnique({ where: { id: batch.id } });
        if (!freshBatch) throw new ValidationError("Batch no longer exists.");
        assertBatchAvailable(freshBatch, `${medicine?.medicineName ?? "medicine"} (batch ${freshBatch.batchNumber})`);

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
          include: { medicine: { include: { category: { select: { requiresPrescription: true, controlledDrug: true } } } } },
        },
      },
    });
    if (!prescription) return res.status(404).json({ error: "Prescription not found at this facility" });
    if (prescription.status !== "ACTIVE") {
      return res.status(400).json({
        error: `Prescription ${prescription.prescriptionId} is ${prescription.status.toLowerCase()} — only active prescriptions can be dispensed.`,
      });
    }
    // H3: prescription validity window.
    if (isRxExpired(prescription.prescriptionDate)) {
      return res.status(400).json({
        error: `Prescription ${prescription.prescriptionId} has expired — prescriptions are valid for ${RX_VALIDITY_DAYS} days (issued ${prescription.prescriptionDate.toISOString().slice(0, 10)}).`,
      });
    }

    // C2: allergy visibility — the patient record plus anything recorded on the
    // patient's prescriptions over time (allergies were Rx-level before the
    // Patient.allergies column existed).
    const allergyRows = await prisma.prescription.findMany({
      where: { patientId: prescription.patientId, allergies: { not: null } },
      select: { allergies: true },
    });
    const fromPrescriptions = [...new Set(
      allergyRows.map((r) => (r.allergies ?? "").trim()).filter((a) => a && !/^(nkda|none|nil|no known( drug)? allergies)$/i.test(a))
    )];

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Partial/repeat dispensing: the plan must offer what *remains*, not what was
    // originally prescribed. Aggregate duplicate medicine lines, subtract what has
    // already been dispensed against this prescription.
    const alreadyDispensed = await dispensedByMedicine(prescription.id);
    const byMedicine = new Map<string, (typeof prescription.medicines)[number] & { totalQuantity: number | null }>();
    for (const pm of prescription.medicines) {
      const existing = byMedicine.get(pm.medicineId);
      if (!existing) {
        byMedicine.set(pm.medicineId, { ...pm, totalQuantity: pm.quantity ?? null });
      } else if (pm.quantity != null) {
        existing.totalQuantity = (existing.totalQuantity ?? 0) + pm.quantity;
      }
    }

    const lines = await Promise.all(
      [...byMedicine.values()].map(async (pm) => {
        // FEFO: soonest non-expired, ACTIVE batch with stock first.
        const batches = await prisma.stockBatch.findMany({
          where: { facilityId, medicineId: pm.medicineId, quantity: { gt: 0 }, status: "ACTIVE", expiryDate: { gte: today } },
          orderBy: { expiryDate: "asc" },
          select: { id: true, batchNumber: true, expiryDate: true, quantity: true },
        });
        const onHand = batches.reduce((sum, b) => sum + b.quantity, 0);
        const prescribedQuantity = pm.totalQuantity;
        const dispensedQty = alreadyDispensed.get(pm.medicineId) ?? 0;
        const remainingQuantity =
          prescribedQuantity == null ? null : Math.max(0, prescribedQuantity - dispensedQty);
        const fulfilled = remainingQuantity === 0;
        return {
          medicineId: pm.medicineId,
          medicineName: pm.medicine.medicineName,
          dosage: pm.dosage ?? "",
          form: pm.form ?? pm.medicine.dosageForm ?? "",
          duration: pm.duration ?? "",
          requestedQuantity: remainingQuantity,
          prescribedQuantity,
          alreadyDispensed: dispensedQty,
          remainingQuantity,
          fulfilled,
          onHand,
          recommendedBatchId: fulfilled ? null : batches[0]?.id ?? null,
          batches,
          requiresPrescription: pm.medicine.category?.requiresPrescription ?? false,
          controlled: pm.medicine.category?.controlledDrug ?? false,
          // C4: legacy open-ended line — dispensing is uncapped; surface loudly.
          noQuantityWarning: prescribedQuantity == null,
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
        prescriptionDate: prescription.prescriptionDate,
        expiresAt: rxExpiresAt(prescription.prescriptionDate),
        allergies: prescription.allergies ?? null,
      },
      // C2: union of allergy sources for the banner.
      allergies: {
        patient: prescription.patient.allergies ?? null,
        fromPrescriptions,
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
    // H3: friendly pre-check (authoritative re-check happens under the row lock).
    if (isRxExpired(prescription.prescriptionDate)) {
      return res.status(400).json({
        error: `Prescription has expired — prescriptions are valid for ${RX_VALIDITY_DAYS} days (issued ${prescription.prescriptionDate.toISOString().slice(0, 10)}).`,
      });
    }

    // Enforce requiresPrescription/controlled: every such medicine must appear on the prescription.
    const medicinesForCheck = await prisma.medicine.findMany({
      where: { id: { in: data.lines.map((l) => l.medicineId) } },
      select: { id: true, medicineName: true, category: { select: { requiresPrescription: true, controlledDrug: true } } },
    });
    const controlledMedIds = new Set(medicinesForCheck.filter((m) => m.category?.controlledDrug).map((m) => m.id));
    if (controlledMedIds.size > 0 && isRxExpired(prescription.prescriptionDate, true)) {
      const names = medicinesForCheck.filter((m) => controlledMedIds.has(m.id)).map((m) => m.medicineName).join(", ");
      return res.status(400).json({
        error: `Controlled medicines (${names}) may only be dispensed within ${RX_VALIDITY_DAYS_CONTROLLED} days of prescribing.`,
      });
    }
    const rxRequiredMeds = medicinesForCheck.filter((m) => m.category?.requiresPrescription || m.category?.controlledDrug);
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
      if (prescribed == null && controlledMedIds.has(medId)) {
        return res.status(400).json({
          error: `"${medNameById.get(medId) ?? "This medicine"}" is a controlled drug — it cannot be dispensed against a prescription line without a prescribed quantity.`,
        });
      }
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
        // Authoritative, race-proof guard: lock the Rx row, re-check status + remaining qty.
        await lockAndValidatePrescription(tx, {
          prescriptionId: data.prescriptionId,
          patientId: data.patientId,
          facilityId,
          requestedByMed,
          medNameById,
          controlledMedIds,
        });

        const records = [];
        for (const line of data.lines) {
          const batch = batchById.get(line.batchId)!;
          // Re-verify batch availability under the transaction (quarantine/expiry races).
          const freshBatch = await tx.stockBatch.findUnique({ where: { id: batch.id } });
          if (!freshBatch) throw new ValidationError("Batch no longer exists.");
          assertBatchAvailable(freshBatch, `${medNameById.get(line.medicineId) ?? "medicine"} (batch ${freshBatch.batchNumber})`);

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

/**
 * Dispensing log (H1/H4). Filters:
 *   patientId       — internal cuid OR human-readable patient ID (PAT…)
 *   prescriptionId  — internal cuid
 *   medicineId, from, to (ISO dates), today=true
 *   take/skip       — pagination (take capped at 200, default 50)
 */
router.get("/", dispenseView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const { patientId, prescriptionId, medicineId, from, to } = req.query as Record<string, string | undefined>;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const dispensedAt: { gte?: Date; lte?: Date } = {};
    if (req.query.today === "true") dispensedAt.gte = today;
    if (from && !isNaN(Date.parse(from))) dispensedAt.gte = new Date(from);
    if (to && !isNaN(Date.parse(to))) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      dispensedAt.lte = end;
    }

    const take = Math.min(Math.max(parseInt((req.query.take as string) ?? "50", 10) || 50, 1), 200);
    const skip = Math.max(parseInt((req.query.skip as string) ?? "0", 10) || 0, 0);

    const records = await prisma.dispensingRecord.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        ...(patientId ? { OR: [{ patientId }, { patient: { patientId } }] } : {}),
        ...(prescriptionId ? { prescriptionId } : {}),
        ...(medicineId ? { medicineId } : {}),
        ...(dispensedAt.gte || dispensedAt.lte ? { dispensedAt } : {}),
      },
      include: {
        patient: true,
        healthcareWorker: true,
        medicine: { include: { category: { select: { controlledDrug: true } } } },
        prescription: { select: { prescriptionId: true } },
        dispensedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { dispensedAt: "desc" },
      take,
      skip,
    });
    res.json(records);
  } catch (e) {
    next(e);
  }
});

/**
 * Controlled Drug Register (C3): every dispensing of a controlled-category
 * medicine in the period, with patient / prescription / dispenser identity,
 * plus per-medicine totals and current on-hand for reconciliation.
 */
router.get("/controlled-register", dispenseView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string | undefined);
    if (!facilityId) return res.status(400).json({ error: "Select a facility to view the controlled drug register." });

    const { from, to } = req.query as Record<string, string | undefined>;
    const gte = from && !isNaN(Date.parse(from)) ? new Date(from) : new Date(Date.now() - 30 * 86400000);
    let lte: Date | undefined;
    if (to && !isNaN(Date.parse(to))) {
      lte = new Date(to);
      lte.setHours(23, 59, 59, 999);
    }

    const records = await prisma.dispensingRecord.findMany({
      where: {
        facilityId,
        medicine: { category: { controlledDrug: true } },
        dispensedAt: { gte, ...(lte ? { lte } : {}) },
      },
      include: {
        patient: { select: { patientId: true, firstName: true, lastName: true } },
        prescription: { select: { prescriptionId: true, doctorName: true } },
        medicine: { select: { id: true, medicineName: true } },
        dispensedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { dispensedAt: "asc" },
    });

    // Per-medicine totals + current usable on-hand for end-of-period reconciliation.
    const medIds = [...new Set(records.map((r) => r.medicineId))];
    const summary = await Promise.all(
      medIds.map(async (id) => {
        const onHand = await prisma.stockBatch.aggregate({
          where: { facilityId, medicineId: id, status: "ACTIVE", quantity: { gt: 0 } },
          _sum: { quantity: true },
        });
        const dispensedTotal = records.filter((r) => r.medicineId === id).reduce((s, r) => s + r.quantity, 0);
        return {
          medicineId: id,
          medicineName: records.find((r) => r.medicineId === id)!.medicine.medicineName,
          dispensedTotal,
          onHand: onHand._sum.quantity ?? 0,
        };
      })
    );

    res.json({ from: gte, to: lte ?? null, records, summary });
  } catch (e) {
    next(e);
  }
});

export default router;
