import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { generatePatientId } from "../utils/ids";
import { logAudit } from "../services/audit";

const router = Router();
router.use(authenticate, requireFacility);

const createSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  gender: z.string(),
  age: z.number().int().positive(),
  phoneNumber: z.string().optional(),
  address: z.string().optional(),
  facilityId: z.string().optional(),
});

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const q = (req.query.q as string) || "";
    const patients = await prisma.patient.findMany({
      where: {
        facilityId: facilityId!,
        OR: q
          ? [
              { patientId: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { phoneNumber: { contains: q } },
            ]
          : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(patients);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const facilityId = data.facilityId || getFacilityId(req)!;
    const count = await prisma.patient.count();
    const patient = await prisma.patient.create({
      data: {
        patientId: generatePatientId(count + 1),
        ...data,
        facilityId,
      },
    });
    await logAudit({
      facilityId,
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "Patient",
      entityId: patient.id,
    });
    res.status(201).json(patient);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const patient = await prisma.patient.findUnique({
      where: { id: req.params.id },
      include: {
        prescriptions: { orderBy: { prescriptionDate: "desc" }, take: 20 },
        dispensingRecords: {
          include: { medicine: true, dispensedBy: { select: { firstName: true, lastName: true } } },
          orderBy: { dispensedAt: "desc" },
        },
        medicineReturns: {
          include: { medicine: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!patient) return res.status(404).json({ error: "Patient not found" });
    res.json(patient);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/history", async (req, res, next) => {
  try {
    const [prescriptions, dispensing, returns] = await Promise.all([
      prisma.prescription.findMany({
        where: { patientId: req.params.id },
        include: { medicines: { include: { medicine: true } } },
        orderBy: { prescriptionDate: "desc" },
      }),
      prisma.dispensingRecord.findMany({
        where: { patientId: req.params.id },
        include: { medicine: true, batch: true },
        orderBy: { dispensedAt: "desc" },
      }),
      prisma.medicineReturn.findMany({
        where: { patientId: req.params.id },
        include: { medicine: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    res.json({ prescriptions, dispensing, returns });
  } catch (e) {
    next(e);
  }
});

export default router;
