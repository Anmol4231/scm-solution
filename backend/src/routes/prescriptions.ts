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
