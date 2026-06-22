import { Router } from "express";
import { z } from "zod";
import { WorkerStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { logChangeHistory } from "../services/changeHistory";

const router = Router();
router.use(authenticate, requireFacility);

const workerSchema = z.object({
  workerId: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  department: z.string().min(1),
  role: z.string().min(1),
  phone: z.string().optional(),
  status: z.nativeEnum(WorkerStatus).optional(),
  facilityId: z.string().optional(),
});

router.get("/deleted", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req);
    const workers = await prisma.healthcareWorker.findMany({
      where: {
        deletedAt: { not: null },
        ...(facilityId ? { facilityId } : {}),
      },
      include: {
        facility: { select: { id: true, name: true } },
        deletedBy: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { deletedAt: "desc" },
    });
    res.json(workers.map((w) => ({
      ...w,
      deletedBy: w.deletedBy
        ? `${w.deletedBy.firstName} ${w.deletedBy.lastName}`.trim() || w.deletedBy.email
        : null,
    })));
  } catch (e) {
    next(e);
  }
});

router.post("/:id/restore", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req);
    const worker = await prisma.healthcareWorker.findFirst({
      where: { id: req.params.id, ...(facilityId ? { facilityId } : {}) },
    });
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    if (!worker.deletedAt) return res.status(400).json({ error: "Worker is not deleted" });

    const clash = await prisma.healthcareWorker.findFirst({
      where: { workerId: worker.workerId, id: { not: worker.id }, deletedAt: null },
    });
    if (clash) return res.status(409).json({ error: "Cannot restore: an active staff member with this ID already exists" });

    const restored = await prisma.healthcareWorker.update({
      where: { id: worker.id },
      data: { deletedAt: null, deletedById: null },
    });

    await logChangeHistory({
      facilityId: worker.facilityId,
      userId: req.user!.userId,
      action: "RESTORE",
      entityType: "HealthcareWorker",
      entityId: restored.id,
      entityName: `${restored.firstName} ${restored.lastName}`,
      previousValues: { deletedAt: worker.deletedAt },
      currentValues: { deletedAt: null },
      changeDetails: "Restored soft-deleted staff member",
    });

    res.json(restored);
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const q = (req.query.q as string) || "";
    const workers = await prisma.healthcareWorker.findMany({
      where: {
        deletedAt: null,
        ...(facilityId ? { facilityId } : {}),
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { workerId: { contains: q, mode: "insensitive" } },
                { department: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { facility: { select: { id: true, name: true } } },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 200,
    });
    res.json(workers);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req);
    const worker = await prisma.healthcareWorker.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(facilityId ? { facilityId } : {}) },
      include: {
        dispensingRecords: {
          include: { medicine: true },
          orderBy: { dispensedAt: "desc" },
          take: 20,
        },
      },
    });
    if (!worker) return res.status(404).json({ error: "Worker not found" });
    res.json(worker);
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const data = workerSchema.parse(req.body);
    const facilityId = data.facilityId ?? getFacilityId(req);
    if (!facilityId) return res.status(400).json({ error: "Facility is required" });
    const existing = await prisma.healthcareWorker.findUnique({ where: { workerId: data.workerId } });
    if (existing) return res.status(409).json({ error: "Worker ID already exists" });

    const { facilityId: _fid, ...rest } = data;
    const worker = await prisma.healthcareWorker.create({
      data: { ...rest, facilityId, status: data.status ?? WorkerStatus.ACTIVE },
    });
    await logAudit({
      facilityId,
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "HealthcareWorker",
      entityId: worker.id,
      details: { name: `${worker.firstName} ${worker.lastName}`, workerId: worker.workerId },
    });
    res.status(201).json(worker);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req);
    const worker = await prisma.healthcareWorker.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(facilityId ? { facilityId } : {}) },
    });
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    const data = workerSchema.partial().omit({ workerId: true }).parse(req.body);
    const updated = await prisma.healthcareWorker.update({
      where: { id: worker.id },
      data,
    });
    await logAudit({
      facilityId: worker.facilityId,
      userId: req.user!.userId,
      action: "UPDATE",
      entityType: "HealthcareWorker",
      entityId: worker.id,
      details: { name: `${updated.firstName} ${updated.lastName}` },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req);
    const worker = await prisma.healthcareWorker.findFirst({
      where: { id: req.params.id, deletedAt: null, ...(facilityId ? { facilityId } : {}) },
    });
    if (!worker) return res.status(404).json({ error: "Worker not found" });

    await prisma.healthcareWorker.update({
      where: { id: worker.id },
      data: { deletedAt: new Date(), deletedById: req.user!.userId },
    });

    await logChangeHistory({
      facilityId: worker.facilityId,
      userId: req.user!.userId,
      action: "SOFT_DELETE",
      entityType: "HealthcareWorker",
      entityId: worker.id,
      entityName: `${worker.firstName} ${worker.lastName}`,
      previousValues: { deletedAt: null },
      currentValues: { deletedAt: new Date() },
      changeDetails: "Soft-deleted staff member",
    });

    res.json({ message: "Staff member deleted" });
  } catch (e) {
    next(e);
  }
});

export default router;
