import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { generatePrescriptionId } from "../utils/ids";
import { logAudit } from "../services/audit";

/* ─── OCR text parser ─── */

interface ParsedMedicine { medicineName: string; dosage?: string; quantity?: number }
interface OcrParseResult {
  doctorName?: string;
  diagnosisNotes?: string;
  medicines: ParsedMedicine[];
  fieldsDetected: string[];
  warnings: string[];
}

function parsePrescriptionText(rawText: string): OcrParseResult {
  const result: OcrParseResult = { medicines: [], fieldsDetected: [], warnings: [] };

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Each regex: label (colon | dash | equals | space) value
  // \s*[-:=]?\s* handles: "Doctor- X", "Doctor: X", "Doctor X", "Doctor:X"
  const patterns = {
    doctor:    /^(?:doctor|dr\.?)\s*[-:=]?\s*(.+)/i,
    diagnosis: /^(?:diagnosis|diag\.?)\s*[-:=]?\s*(.+)/i,
    medicine:  /^medicines?\s*[-:=]?\s*(.+)/i,
    qty:       /^(?:qty|quantity)\s*[-:=]?\s*(\d+(?:\.\d+)?)/i,
    dosage:    /^(?:dosage|dose)\s*[-:=]?\s*(.+)/i,
  };

  const seen = new Set<string>();
  const flag = (f: string) => { if (!seen.has(f)) { seen.add(f); result.fieldsDetected.push(f); } };

  for (const line of lines) {
    let m: RegExpExecArray | null;

    m = patterns.doctor.exec(line);
    if (m) { result.doctorName = m[1].trim(); flag("doctor"); continue; }

    m = patterns.diagnosis.exec(line);
    if (m) { result.diagnosisNotes = m[1].trim(); flag("diagnosis"); continue; }

    m = patterns.medicine.exec(line);
    if (m && m[1].trim()) {
      result.medicines.push({ medicineName: m[1].trim() });
      flag("medicine");
      continue;
    }

    m = patterns.qty.exec(line);
    if (m) {
      const qty = parseFloat(m[1]);
      if (!isNaN(qty)) {
        if (result.medicines.length > 0) {
          result.medicines[result.medicines.length - 1].quantity = qty;
          flag("quantity");
        } else {
          result.warnings.push(`Quantity ${qty} found but no medicine to associate with it`);
        }
      }
      continue;
    }

    m = patterns.dosage.exec(line);
    if (m && result.medicines.length > 0) {
      result.medicines[result.medicines.length - 1].dosage = m[1].trim();
      flag("dosage");
      continue;
    }
  }

  return result;
}

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
        medicineId: z.string(),
        dosage: z.string().optional(),
        form: z.string().optional(),
        quantity: z.number().optional(),
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

  res.json({
    rawText,
    confidence: Math.round(confidence),
    doctorName: parsed.doctorName ?? null,
    diagnosisNotes: parsed.diagnosisNotes ?? null,
    medicines: parsed.medicines,
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
    const facilityId = getFacilityId(req)!;
    const count = await prisma.prescription.count();
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : undefined;

    const prescription = await prisma.prescription.create({
      data: {
        prescriptionId: generatePrescriptionId(count + 1),
        patientId: body.patientId,
        facilityId,
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
          ? { create: body.medicines }
          : undefined,
      },
      include: { medicines: { include: { medicine: true } }, patient: true },
    });

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
