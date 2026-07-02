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
 * Direct (walk-in) dispensing plan — no prescription required.
 * Returns FEFO batch suggestions per medicine exactly like the Rx plan endpoint
 * but without creating any DB record. The resulting dispense will have no
 * prescriptionId and will appear only in the Dispense Report, not the Prescription Log.
 *
 *   POST /dispensing/direct-plan
 *   Body: { patientId, facilityId?, lines: [{ medicineId, quantity, dosage? }] }
 */
const directPlanSchema = z.object({
  patientId: z.string().min(1),
  facilityId: z.string().optional(),
  lines: z.array(z.object({
    medicineId: z.string().min(1),
    quantity: z.number().positive(),
    dosage: z.string().optional(),
  })).min(1),
});

router.post("/direct-plan", dispenseView, async (req, res, next) => {
  try {
    const data = directPlanSchema.parse(req.body);
    const facilityId = resolveDispenseFacility(req, data.facilityId);
    if (!facilityId) return res.status(400).json({ error: "Select a facility to dispense from." });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [patient, allergyRows] = await Promise.all([
      prisma.patient.findUnique({ where: { id: data.patientId }, select: { allergies: true } }),
      prisma.prescription.findMany({
        where: { patientId: data.patientId, allergies: { not: null } },
        select: { allergies: true },
      }),
    ]);

    const fromPrescriptions = [...new Set(
      allergyRows.map((r) => (r.allergies ?? "").trim()).filter((a) => a && !/^(nkda|none|nil|no known( drug)? allergies)$/i.test(a))
    )];

    const medicineIds = data.lines.map((l) => l.medicineId);
    const medicines = await prisma.medicine.findMany({
      where: { id: { in: medicineIds } },
      select: {
        id: true, medicineName: true, dosageForm: true, strength: true,
        category: { select: { requiresPrescription: true, controlledDrug: true, name: true } },
      },
    });
    const medById = new Map(medicines.map((m) => [m.id, m]));

    const lines = await Promise.all(
      data.lines.map(async (input) => {
        const med = medById.get(input.medicineId);
        const batches = await prisma.stockBatch.findMany({
          where: { facilityId, medicineId: input.medicineId, quantity: { gt: 0 }, status: "ACTIVE", expiryDate: { gte: today } },
          orderBy: { expiryDate: "asc" },
          select: { id: true, batchNumber: true, expiryDate: true, quantity: true },
        });
        const onHand = batches.reduce((sum, b) => sum + b.quantity, 0);
        return {
          medicineId: input.medicineId,
          medicineName: med?.medicineName ?? "Unknown",
          dosage: input.dosage ?? "",
          form: med?.dosageForm ?? "",
          duration: "",
          requestedQuantity: input.quantity,
          prescribedQuantity: input.quantity,
          alreadyDispensed: 0,
          remainingQuantity: input.quantity,
          fulfilled: false,
          onHand,
          recommendedBatchId: batches[0]?.id ?? null,
          batches,
          requiresPrescription: med?.category?.requiresPrescription ?? false,
          controlled: med?.category?.controlledDrug ?? false,
          categoryName: med?.category?.name ?? "",
          strength: med?.strength ?? "",
          noQuantityWarning: false,
        };
      })
    );

    res.json({
      prescription: null,
      allergies: { patient: patient?.allergies ?? null, fromPrescriptions },
      lines,
    });
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
          include: { medicine: { include: { category: { select: { requiresPrescription: true, controlledDrug: true, name: true } } } } },
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
          categoryName: pm.medicine.category?.name ?? "",
          strength: pm.medicine.strength ?? "",
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
        uploadedPrescriptionUrl: prescription.uploadedPrescriptionUrl ?? null,
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

/**
 * Bulk medicine availability for the dispensing entry screen. Returns, per
 * requested medicine, the dispensable on-hand quantity at the selected facility
 * plus a status the UI can render immediately — BEFORE a dispensing plan exists.
 *
 * "Dispensable" uses the exact same predicate as the plan/dispense engine
 * (ACTIVE status, non-expired, quantity > 0) so the indicator can never disagree
 * with what the plan will actually offer. One pair of bulk queries regardless of
 * how many medicines are passed (no per-row request).
 *
 *   GET /dispensing/availability?facilityId=…&medicineIds=a,b,c
 *
 * Statuses:
 *   AVAILABLE     — dispensable qty > 0 and above the medicine's reorder threshold
 *   LOW_STOCK     — dispensable qty > 0 but at/below the threshold
 *   OUT_OF_STOCK  — no stock at all
 *   EXPIRED_ONLY  — stock exists but all of it is expired / non-ACTIVE
 */
router.get("/availability", dispenseView, async (req, res, next) => {
  try {
    const facilityId = resolveDispenseFacility(req, req.query.facilityId as string | undefined);
    if (!facilityId) return res.status(400).json({ error: "Select a facility to check availability." });

    const ids = [
      ...new Set(
        ((req.query.medicineIds as string | undefined) ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      ),
    ].slice(0, 200); // cap to keep the query bounded
    if (ids.length === 0) return res.json({ items: [] });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [batches, meds] = await Promise.all([
      prisma.stockBatch.findMany({
        where: { facilityId, medicineId: { in: ids }, quantity: { gt: 0 } },
        select: { medicineId: true, quantity: true, status: true, expiryDate: true },
      }),
      prisma.medicine.findMany({
        where: { id: { in: ids } },
        select: { id: true, reorderThreshold: true },
      }),
    ]);

    const thresholdById = new Map(meds.map((m) => [m.id, m.reorderThreshold ?? 0]));
    const agg = new Map<string, { available: number; expired: number }>();
    for (const id of ids) agg.set(id, { available: 0, expired: 0 });
    for (const b of batches) {
      const bucket = agg.get(b.medicineId);
      if (!bucket) continue;
      // Identical predicate to the dispensing plan (status ACTIVE, expiry >= today).
      const dispensable = b.status === "ACTIVE" && b.expiryDate.getTime() >= today.getTime();
      if (dispensable) bucket.available += b.quantity;
      else bucket.expired += b.quantity;
    }

    const items = ids.map((medicineId) => {
      const { available, expired } = agg.get(medicineId)!;
      const threshold = thresholdById.get(medicineId) ?? 0;
      let status: "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK" | "EXPIRED_ONLY";
      if (available > 0) status = threshold > 0 && available <= threshold ? "LOW_STOCK" : "AVAILABLE";
      else if (expired > 0) status = "EXPIRED_ONLY";
      else status = "OUT_OF_STOCK";
      return { medicineId, availableQty: available, expiredQty: expired, threshold, status };
    });

    res.json({ items });
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
  // Optional: medicines may be dispensed without a prescription. Prescription-only
  // and controlled medicines are still rejected below unless an Rx is supplied.
  prescriptionId: z.string().min(1).optional(),
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

    // Category info for every line — needed for both prescription and walk-in dispensing.
    const medicinesForCheck = await prisma.medicine.findMany({
      where: { id: { in: data.lines.map((l) => l.medicineId) } },
      select: { id: true, medicineName: true, category: { select: { requiresPrescription: true, controlledDrug: true } } },
    });
    const controlledMedIds = new Set(medicinesForCheck.filter((m) => m.category?.controlledDrug).map((m) => m.id));
    const medNameById = new Map(medicinesForCheck.map((m) => [m.id, m.medicineName]));

    if (data.prescriptionId) {
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
      if (controlledMedIds.size > 0 && isRxExpired(prescription.prescriptionDate, true)) {
        const names = medicinesForCheck.filter((m) => controlledMedIds.has(m.id)).map((m) => m.medicineName).join(", ");
        return res.status(400).json({
          error: `Controlled medicines (${names}) may only be dispensed within ${RX_VALIDITY_DAYS_CONTROLLED} days of prescribing.`,
        });
      }
      // Enforce requiresPrescription/controlled: every such medicine must appear on the prescription.
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
    } else {
      // No prescription supplied — only general-sale medicines may be dispensed.
      // Prescription-only and controlled medicines always require an Rx.
      const rxRequired = medicinesForCheck.filter((m) => m.category?.requiresPrescription || m.category?.controlledDrug);
      if (rxRequired.length > 0) {
        const names = rxRequired.map((m) => m.medicineName).join(", ");
        return res.status(400).json({
          error: `${names} require a prescription and cannot be dispensed without one — create a prescription for these medicines.`,
        });
      }
    }

    // B-1: aggregate requested-per-medicine (used by the Rx row-lock validation).
    const requestedByMed = new Map<string, number>();
    for (const line of data.lines) {
      requestedByMed.set(line.medicineId, (requestedByMed.get(line.medicineId) ?? 0) + line.quantity);
    }
    // Enforce prescribed quantities only when dispensing against a prescription.
    if (data.prescriptionId) {
      const prescribedMap = await prescribedByMedicine(data.prescriptionId);
      const alreadyMap = await dispensedByMedicine(data.prescriptionId);
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
        if (data.prescriptionId) {
          await lockAndValidatePrescription(tx, {
            prescriptionId: data.prescriptionId,
            patientId: data.patientId,
            facilityId,
            requestedByMed,
            medNameById,
            controlledMedIds,
          });
        }

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
            prescriptionId: data.prescriptionId ?? null,
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
            prescriptionId: data.prescriptionId ?? null,
            performedById: userId,
            reason: "Dispensed to patient",
            notes: line.notes,
          },
        });
        records.push(record);
      }
      if (data.prescriptionId) await maybeCompletePrescription(tx, data.prescriptionId);
      return records;
    });

    await logAudit({
      facilityId,
      userId,
      action: "DISPENSE",
      entityType: data.prescriptionId ? "Prescription" : "DispensingRecord",
      entityId: data.prescriptionId ?? data.patientId,
      details: {
        prescriptionId: data.prescriptionId ?? null,
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
 *   patientName     — partial match on firstName or lastName
 *   prescriptionId  — internal cuid
 *   prescriptionNumber — human-readable prescriptionId (RX…)
 *   medicineId, batchNumber, dispensedById
 *   from, to (ISO dates), today=true, controlledOnly=true
 *   sortBy, sortDir — sorting (dispensedAt, quantity; asc/desc)
 *   take/skip       — pagination (take capped at 200, default 50)
 */
router.get("/", dispenseView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const { patientId, patientName, prescriptionId, prescriptionNumber, medicineId, medicineName, batchNumber, dispensedById, pharmacist } =
      req.query as Record<string, string | undefined>;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const controlledOnly = req.query.controlledOnly === "true";
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

    const sortBy = (req.query.sortBy as string) ?? "dispensedAt";
    const sortDir: "asc" | "desc" = req.query.sortDir === "asc" ? "asc" : "desc";
    const validSortFields = ["dispensedAt", "quantity"] as const;
    const orderByField = validSortFields.includes(sortBy as any) ? sortBy : "dispensedAt";

    const where: Prisma.DispensingRecordWhereInput = {
      ...(facilityId ? { facilityId } : {}),
      ...(patientId ? { OR: [{ patientId }, { patient: { patientId } }] } : {}),
      ...(patientName
        ? {
            patient: {
              OR: [
                { firstName: { contains: patientName, mode: "insensitive" } },
                { lastName: { contains: patientName, mode: "insensitive" } },
              ],
            },
          }
        : {}),
      ...(prescriptionId ? { prescriptionId } : {}),
      ...(prescriptionNumber ? { prescription: { prescriptionId: { contains: prescriptionNumber, mode: "insensitive" } } } : {}),
      ...(medicineId ? { medicineId } : {}),
      ...(batchNumber ? { batchNumber: { contains: batchNumber, mode: "insensitive" } } : {}),
      ...(dispensedById ? { dispensedById } : {}),
      ...(pharmacist
        ? {
            dispensedBy: {
              OR: [
                { firstName: { contains: pharmacist, mode: "insensitive" } },
                { lastName: { contains: pharmacist, mode: "insensitive" } },
              ],
            },
          }
        : {}),
      ...((medicineName || controlledOnly)
        ? {
            medicine: {
              ...(medicineName ? { medicineName: { contains: medicineName, mode: "insensitive" } } : {}),
              ...(controlledOnly ? { category: { controlledDrug: true } } : {}),
            },
          }
        : {}),
      ...(dispensedAt.gte || dispensedAt.lte ? { dispensedAt } : {}),
    };

    const [records, total] = await Promise.all([
      prisma.dispensingRecord.findMany({
        where,
        include: {
          patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
          healthcareWorker: true,
          medicine: { include: { category: { select: { controlledDrug: true } } } },
          prescription: { select: { prescriptionId: true } },
          dispensedBy: { select: { firstName: true, lastName: true } },
          facility: { select: { name: true, code: true } },
        },
        orderBy: { [orderByField]: sortDir },
        take,
        skip,
      }),
      prisma.dispensingRecord.count({ where }),
    ]);
    res.json({ data: records, total, page, pageSize, skip, take, records });
  } catch (e) {
    next(e);
  }
});

/**
 * Summary stats for the Dispensing Report screen. The KPI cards mirror the table,
 * so the counts honour the same filters (date range, patient, medicine, batch,
 * pharmacist, facility) rather than being fixed to "today".
 */
router.get("/summary", dispenseView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const { patientId, patientName, medicineName, batchNumber, pharmacist } =
      req.query as Record<string, string | undefined>;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const dispensedAt: { gte?: Date; lte?: Date } = {};
    if (from && !isNaN(Date.parse(from))) dispensedAt.gte = new Date(from);
    if (to && !isNaN(Date.parse(to))) {
      const end = new Date(to); end.setHours(23, 59, 59, 999); dispensedAt.lte = end;
    }
    const hasRange = dispensedAt.gte || dispensedAt.lte;

    const recordWhere: Prisma.DispensingRecordWhereInput = {
      ...(facilityId ? { facilityId } : {}),
      ...(hasRange ? { dispensedAt } : {}),
      ...(patientId ? { OR: [{ patientId }, { patient: { patientId } }] } : {}),
      ...(patientName
        ? { patient: { OR: [{ firstName: { contains: patientName, mode: "insensitive" } }, { lastName: { contains: patientName, mode: "insensitive" } }] } }
        : {}),
      ...(batchNumber ? { batchNumber: { contains: batchNumber, mode: "insensitive" } } : {}),
      ...(medicineName ? { medicine: { medicineName: { contains: medicineName, mode: "insensitive" } } } : {}),
      ...(pharmacist
        ? { dispensedBy: { OR: [{ firstName: { contains: pharmacist, mode: "insensitive" } }, { lastName: { contains: pharmacist, mode: "insensitive" } }] } }
        : {}),
    };

    // Controlled-drug variant keeps the medicineName filter (if any) alongside the category constraint.
    const controlledWhere: Prisma.DispensingRecordWhereInput = {
      ...recordWhere,
      medicine: { ...(medicineName ? { medicineName: { contains: medicineName, mode: "insensitive" } } : {}), category: { controlledDrug: true } },
    };

    const returnsWhere = {
      ...(facilityId ? { facilityId } : {}),
      ...(hasRange ? { createdAt: dispensedAt } : {}),
    };

    const [totalCount, controlledCount, unitsAgg, uniquePatientGroups, returnsCount] = await Promise.all([
      prisma.dispensingRecord.count({ where: recordWhere }),
      prisma.dispensingRecord.count({ where: controlledWhere }),
      prisma.dispensingRecord.aggregate({ where: recordWhere, _sum: { quantity: true } }),
      prisma.dispensingRecord.groupBy({ by: ["patientId"], where: recordWhere }),
      prisma.medicineReturn.count({ where: returnsWhere }).catch(() => 0),
    ]);

    res.json({
      totalDispensings: totalCount,
      patientsCount: uniquePatientGroups.length,
      controlledDispensings: controlledCount,
      unitsDispensed: unitsAgg._sum.quantity ?? 0,
      returns: returnsCount,
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Prescription-grouped dispensing report. One record per prescription that had
 * dispensing events matching the filters. Each record carries all dispensing
 * lines (medicine, qty, batch, expiry, dispenser) for the modal detail view.
 *
 * Filters: from, to, patientId, patientName, prescriptionNumber, medicineName,
 *          batchNumber, pharmacist, facilityId
 * Pagination: take (max 100), skip
 */
router.get("/by-prescription", dispenseView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const { patientId, patientName, prescriptionNumber, medicineName, batchNumber, pharmacist } =
      req.query as Record<string, string | undefined>;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const dispensedAt: { gte?: Date; lte?: Date } = {};
    if (from && !isNaN(Date.parse(from))) dispensedAt.gte = new Date(from);
    if (to && !isNaN(Date.parse(to))) {
      const end = new Date(to); end.setHours(23, 59, 59, 999); dispensedAt.lte = end;
    }

    const pageParam = req.query.page as string | undefined;
    const pageSizeParam = req.query.pageSize as string | undefined;
    const pageSize = Math.min(Math.max(parseInt(pageSizeParam ?? (req.query.take as string) ?? "50", 10) || 50, 1), 100);
    const page = Math.max(
      1,
      parseInt(pageParam ?? "", 10) || Math.floor((parseInt((req.query.skip as string) ?? "0", 10) || 0) / pageSize) + 1
    );
    const skip = pageParam !== undefined || pageSizeParam !== undefined
      ? (page - 1) * pageSize
      : Math.max(parseInt((req.query.skip as string) ?? "0", 10) || 0, 0);
    const take = pageSize;
    const sortDir: "asc" | "desc" = req.query.sortDir === "asc" ? "asc" : "desc";

    const recordWhere: Prisma.DispensingRecordWhereInput = {
      ...(facilityId ? { facilityId } : {}),
      ...(dispensedAt.gte || dispensedAt.lte ? { dispensedAt } : {}),
      ...(patientId ? { OR: [{ patientId }, { patient: { patientId } }] } : {}),
      ...(patientName
        ? { patient: { OR: [{ firstName: { contains: patientName, mode: "insensitive" } }, { lastName: { contains: patientName, mode: "insensitive" } }] } }
        : {}),
      ...(batchNumber ? { batchNumber: { contains: batchNumber, mode: "insensitive" } } : {}),
      ...(medicineName ? { medicine: { medicineName: { contains: medicineName, mode: "insensitive" } } } : {}),
      ...(pharmacist
        ? { dispensedBy: { OR: [{ firstName: { contains: pharmacist, mode: "insensitive" } }, { lastName: { contains: pharmacist, mode: "insensitive" } }] } }
        : {}),
    };

    const prescriptionWhere: Prisma.PrescriptionWhereInput = {
      dispensingRecords: { some: recordWhere },
      ...(prescriptionNumber ? { prescriptionId: { contains: prescriptionNumber, mode: "insensitive" } } : {}),
    };

    const [prescriptions, total] = await Promise.all([
      prisma.prescription.findMany({
        where: prescriptionWhere,
        include: {
          patient: { select: { id: true, patientId: true, firstName: true, lastName: true } },
          facility: { select: { name: true, code: true } },
          dispensingRecords: {
            where: recordWhere,
            include: {
              medicine: { select: { medicineName: true } },
              dispensedBy: { select: { firstName: true, lastName: true } },
            },
            orderBy: { dispensedAt: "asc" },
          },
        },
        orderBy: { prescriptionDate: sortDir },
        take,
        skip,
      }),
      prisma.prescription.count({ where: prescriptionWhere }),
    ]);

    const records = prescriptions.map((rx) => {
      const lines = rx.dispensingRecords;
      const latestAt = lines.reduce<Date | null>((max, r) => (!max || r.dispensedAt > max ? r.dispensedAt : max), null);
      const totalQuantity = lines.reduce((s, r) => s + r.quantity, 0);
      const dispenserNames = [...new Set(lines.map((r) => r.dispensedBy ? `${r.dispensedBy.firstName} ${r.dispensedBy.lastName}` : "").filter(Boolean))];
      return {
        prescriptionDbId: rx.id,
        prescriptionId: rx.prescriptionId,
        dispensedAt: latestAt ?? rx.prescriptionDate,
        patient: rx.patient,
        doctorName: rx.doctorName ?? null,
        facility: rx.facility,
        dispensedBy: dispenserNames.length === 1 ? dispenserNames[0] : dispenserNames.length > 1 ? "Multiple" : null,
        totalQuantity,
        lines: lines.map((r) => ({
          medicineName: r.medicine.medicineName,
          quantity: r.quantity,
          batchNumber: r.batchNumber,
          expiryDate: r.expiryDate.toISOString(),
          dispensedAt: r.dispensedAt.toISOString(),
          dispensedBy: r.dispensedBy ? `${r.dispensedBy.firstName} ${r.dispensedBy.lastName}` : "—",
        })),
      };
    });

    res.json({ data: records, total, page, pageSize, skip, take, records });
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
