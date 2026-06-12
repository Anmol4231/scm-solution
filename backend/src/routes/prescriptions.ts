import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { generatePrescriptionId } from "../utils/ids";
import { logAudit } from "../services/audit";
import { parsePrescriptionText } from "../utils/ocrPrescriptionParser";
import { matchMedicine } from "../utils/medicineMatcher";

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|pdf/;
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.test(ext) || allowed.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG, PNG, and PDF files are allowed"));
  },
});

const router = Router();
router.use(authenticate, requireFacility);

const rxView   = requirePermission("prescriptions", "view");
const rxCreate = requirePermission("prescriptions", "create");
const rxEdit   = requirePermission("prescriptions", "edit");

const createSchema = z.object({
  patientId: z.string(),
  doctorName: z.string().optional(),
  department: z.string().optional(),
  diagnosisNotes: z.string().optional(),
  symptoms: z.string().optional(),
  followUpDate: z.string().optional(),
  allergies: z.string().optional(),
  prescriptionNotes: z.string().optional(),
  priority: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).optional(),
  prescriptionDate: z.string().optional(),
  medicines: z
    .array(
      z.object({
        medicineId: z.string().min(1, "Please select a medicine from the Medicine Master."),
        dosage: z.string().optional(),
        form: z.string().optional(),
        // C4: required — an unquantified line would allow unlimited dispensing.
        quantity: z
          .number({ required_error: "Each medicine needs a prescribed quantity." })
          .int("Quantity must be a whole number")
          .positive("Quantity must be greater than zero"),
        duration: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .optional(),
});

router.get("/sample-template", rxView, (_req, res) => {
  res.json({
    template: {
      doctorName: "Dr. Sarah Ncube",
      department: "General Outpatient",
      diagnosis: "Upper respiratory tract infection",
      symptoms: "Cough, mild fever, sore throat",
      followUpDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      allergies: "Penicillin",
      notes: "Take with food. Complete full course.",
      priority: "ROUTINE",
      medicines: [
        { name: "Amoxicillin 250mg", dosage: "250mg", duration: "7 days" },
        { name: "Paracetamol 500mg", dosage: "500mg", duration: "5 days" },
      ],
    },
    downloadHint: "Upload JPG, PNG, or PDF prescription scans via the upload form.",
  });
});

router.get("/", rxView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const patientId = req.query.patientId as string | undefined;
    const prescriptions = await prisma.prescription.findMany({
      where: { ...(facilityId ? { facilityId } : {}), ...(patientId ? { patientId } : {}) },
      include: {
        patient: true,
        medicines: { include: { medicine: true } },
      },
      orderBy: { prescriptionDate: "desc" },
      take: 50,
    });
    res.json(prescriptions);
  } catch (e) {
    next(e);
  }
});

/* POST /ocr — extract prescription fields from an uploaded image */
router.post("/ocr", rxCreate, upload.single("file"), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      error: "No file uploaded. Attach a JPG or PNG image as the 'file' field.",
      rawText: "", confidence: 0, doctorName: null, diagnosisNotes: null,
      medicines: [], fieldsDetected: [], warnings: [],
    });
  }

  const filePath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  if (ext === ".pdf") {
    fs.unlinkSync(filePath);
    return res.status(400).json({
      error: "PDF OCR is not supported yet. Please upload a JPG or PNG image.",
      rawText: "", confidence: 0, doctorName: null, diagnosisNotes: null,
      medicines: [], fieldsDetected: [], warnings: [],
    });
  }

  let rawText = "";
  let confidence = 0;
  let ocrEngineError: string | null = null;

  try {
    // dynamic import keeps CJS compat while tesseract.js ships as ESM
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, { logger: () => {} });
    const { data } = await worker.recognize(filePath);
    rawText = data.text ?? "";
    confidence = data.confidence ?? 0;
    await worker.terminate();
  } catch (err) {
    ocrEngineError = err instanceof Error ? err.message : String(err);
  } finally {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }

  if (ocrEngineError) {
    return res.status(500).json({
      error: "OCR engine failed to process the image",
      details: ocrEngineError,
      rawText: "", confidence: 0, doctorName: null, diagnosisNotes: null,
      medicines: [], fieldsDetected: [],
      warnings: ["OCR engine could not process the image. Ensure it is a clear JPG or PNG."],
    });
  }

  const parsed = parsePrescriptionText(rawText);

  // Resolve each extracted medicine against the Medicine Master (fuzzy matching,
  // abbreviations like "PCM", strength disambiguation "500mg vs 650mg").
  const master = await prisma.medicine.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      id: true,
      medicineName: true,
      genericName: true,
      strengths: { where: { isActive: true }, select: { strength: true } },
    },
  });

  const medicines = parsed.medicines.map((pm) => {
    const match = matchMedicine(pm.medicineName, pm.strength, master);
    return {
      medicineName: pm.medicineName,
      strength: pm.strength ?? null,
      dosage: pm.dosage ?? pm.strength ?? null,
      quantity: pm.quantity ?? null,
      medicineId: match.medicineId,
      matchedName: match.matchedName,
      matchConfidence: match.confidence,
      candidates: match.candidates.map((c) => ({ id: c.id, medicineName: c.medicineName })),
    };
  });

  // Drop pure noise: lines that matched nothing in the master AND carried no
  // qty/strength evidence are almost certainly letterhead/footer junk.
  const filtered = medicines.filter(
    (m) => m.medicineId || m.candidates.length > 0 || m.quantity != null || m.strength
  );
  for (const dropped of medicines.filter((m) => !filtered.includes(m))) {
    parsed.warnings.push(`Ignored unrecognized text: "${dropped.medicineName}"`);
  }
  for (const m of filtered) {
    if (!m.medicineId && m.candidates.length === 0) {
      parsed.warnings.push(`"${m.medicineName}" not found in medicine master — select manually.`);
    }
  }

  res.json({
    rawText,
    confidence: Math.round(confidence),
    doctorName: parsed.doctorName ?? null,
    diagnosisNotes: parsed.diagnosisNotes ?? null,
    department: parsed.department ?? null,
    symptoms: parsed.symptoms ?? null,
    allergies: parsed.allergies ?? null,
    followUpDate: parsed.followUpDate ?? null,
    medicines: filtered,
    fieldsDetected: parsed.fieldsDetected,
    warnings: parsed.warnings,
  });
});

router.post("/", rxCreate, upload.single("prescription"), async (req, res, next) => {
  try {
    const body = createSchema.parse({
      ...req.body,
      medicines: req.body.medicines ? JSON.parse(req.body.medicines) : undefined,
    });

    if (!body.patientId) {
      return res.status(400).json({ error: "A patient must be selected before creating a prescription." });
    }

    const emptyMedicine = body.medicines?.find((m) => !m.medicineId);
    if (emptyMedicine) {
      return res.status(400).json({ error: "Please select a medicine from the Medicine Master." });
    }

    // Cross-facility roles (SUPER_ADMIN, PROVINCIAL_MANAGER) have no fixed facilityId.
    // Prefer the facility explicitly sent in the request body (set by the dispense UI picker
    // and the standalone prescriptions form). Fall back to the patient's stored facility for
    // backwards-compatibility with callers that don't send one.
    let facilityId = getFacilityId(req, req.body.facilityId as string | undefined);
    if (!facilityId) {
      const pat = await prisma.patient.findUnique({
        where: { id: body.patientId },
        select: { facilityId: true },
      });
      facilityId = pat?.facilityId ?? null;
    }
    if (!facilityId) {
      return res.status(400).json({ error: "Unable to determine facility context for this prescription." });
    }

    const fileUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    // count()+1 is not unique under concurrency — retry on collision with a bumped sequence.
    const createWithUniqueId = async (): Promise<Awaited<ReturnType<typeof createPrescription>>> => {
      for (let attempt = 0; ; attempt++) {
        const count = await prisma.prescription.count();
        try {
          return await createPrescription(generatePrescriptionId(count + 1 + attempt));
        } catch (err) {
          const isUniqueCollision =
            err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
          if (!isUniqueCollision || attempt >= 4) throw err;
        }
      }
    };

    const createPrescription = (rxId: string) => prisma.prescription.create({
      data: {
        prescriptionId: rxId,
        patient: { connect: { id: body.patientId } },
        facility: { connect: { id: facilityId } },
        doctorName: body.doctorName,
        department: body.department,
        diagnosisNotes: body.diagnosisNotes,
        symptoms: body.symptoms,
        followUpDate: body.followUpDate ? new Date(body.followUpDate) : undefined,
        allergies: body.allergies,
        prescriptionNotes: body.prescriptionNotes,
        priority: body.priority,
        prescriptionDate: body.prescriptionDate ? new Date(body.prescriptionDate) : new Date(),
        uploadedPrescriptionUrl: fileUrl,
        medicines: body.medicines
          ? {
              create: body.medicines.map((m) => ({
                medicine: { connect: { id: m.medicineId } },
                dosage: m.dosage,
                form: m.form,
                quantity: m.quantity,
                duration: m.duration,
                notes: m.notes,
              })),
            }
          : undefined,
      },
      include: { medicines: { include: { medicine: true } }, patient: true },
    });

    const prescription = await createWithUniqueId();

    await logAudit({
      facilityId,
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "Prescription",
      entityId: prescription.id,
    });
    res.status(201).json(prescription);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", rxView, async (req, res, next) => {
  try {
    const prescription = await prisma.prescription.findUnique({
      where: { id: req.params.id },
      include: {
        patient: true,
        medicines: { include: { medicine: true } },
        dispensingRecords: { include: { medicine: true } },
      },
    });
    if (!prescription) return res.status(404).json({ error: "Not found" });
    res.json(prescription);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/status", rxEdit, async (req, res, next) => {
  try {
    const { status } = z.object({ status: z.enum(["ACTIVE", "COMPLETED", "CANCELLED"]) }).parse(req.body);
    const updated = await prisma.prescription.update({
      where: { id: req.params.id },
      data: { status },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
