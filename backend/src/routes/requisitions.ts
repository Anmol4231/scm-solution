import { Router } from "express";
import { z } from "zod";
import { RequisitionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { isCrossFacilityRole } from "../utils/roles";
import { logAudit } from "../services/audit";
import { generateRequisitionCode } from "../utils/ids";

const router = Router();
router.use(authenticate);

const positiveInt = z.number().int().positive();

const SUPPLY_TYPES = ["AMS_CENTRAL", "MEDICAL_STORE", "WAREHOUSE", "REGIONAL_STORE"];

function isCrossAdmin(req: Express.Request & { user?: { role: string } }): boolean {
  return isCrossFacilityRole(req.user!.role);
}

function resolveRequestingFacility(req: any, bodyFacilityId?: string): string | null {
  if (isCrossFacilityRole(req.user!.role) && bodyFacilityId) return bodyFacilityId;
  return req.user?.facilityId ?? null;
}

const lineSchema = z.object({ medicineId: z.string(), quantityRequested: positiveInt });

const createSchema = z.object({
  requestingFacilityId: z.string().optional(),
  issuingFacilityId: z.string(),
  priority: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).default("ROUTINE"),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

const includeDetail = {
  requestingFacility: { select: { id: true, name: true, code: true, facilityType: true } },
  issuingFacility: { select: { id: true, name: true, code: true, facilityType: true } },
  requestedBy: { select: { firstName: true, lastName: true } },
  approvedBy: { select: { firstName: true, lastName: true } },
  issuedBy: { select: { firstName: true, lastName: true } },
  receivedBy: { select: { firstName: true, lastName: true } },
  lines: { include: { medicine: { select: { id: true, medicineName: true, genericName: true, unitType: true } } } },
};

// GET / — list requisitions visible to the current user
router.get("/", async (req, res, next) => {
  try {
    const qFacilityId = req.query.facilityId as string | undefined;
    const status = req.query.status as string | undefined;
    const crossAdmin = isCrossAdmin(req as any);
    const userFacilityId = (req as any).user?.facilityId as string | undefined;

    const where: any = {};
    if (crossAdmin && qFacilityId) {
      where.OR = [{ requestingFacilityId: qFacilityId }, { issuingFacilityId: qFacilityId }];
    } else if (!crossAdmin && userFacilityId) {
      where.OR = [{ requestingFacilityId: userFacilityId }, { issuingFacilityId: userFacilityId }];
    }
    if (status) where.status = status;

    const items = await prisma.stockRequisition.findMany({
      where,
      include: {
        requestingFacility: { select: { id: true, name: true, code: true } },
        issuingFacility: { select: { id: true, name: true, code: true } },
        requestedBy: { select: { firstName: true, lastName: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

// GET /issuing-facilities — facilities of supply-store type (for the issuing-facility selector)
router.get("/issuing-facilities", async (_req, res, next) => {
  try {
    const facilities = await prisma.facility.findMany({
      where: { isActive: true, facilityType: { in: SUPPLY_TYPES as any } },
      select: { id: true, name: true, code: true, facilityType: true },
      orderBy: { name: "asc" },
    });
    res.json(facilities);
  } catch (e) {
    next(e);
  }
});

// GET /:id
router.get("/:id", async (req, res, next) => {
  try {
    const item = await prisma.stockRequisition.findUnique({
      where: { id: req.params.id },
      include: includeDetail,
    });
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (e) {
    next(e);
  }
});

// POST / — create as DRAFT
router.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const requestingFacilityId = resolveRequestingFacility(req as any, data.requestingFacilityId);
    if (!requestingFacilityId) return res.status(400).json({ error: "Requesting facility required" });

    const userId = (req as any).user!.userId as string;
    const count = await prisma.stockRequisition.count();
    const requisitionCode = generateRequisitionCode(count + 1);

    const created = await prisma.stockRequisition.create({
      data: {
        requisitionCode,
        requestingFacilityId,
        issuingFacilityId: data.issuingFacilityId,
        status: RequisitionStatus.DRAFT,
        priority: data.priority,
        notes: data.notes,
        requestedById: userId,
        lines: { create: data.lines },
      },
      include: includeDetail,
    });

    await logAudit({ facilityId: requestingFacilityId, userId, action: "REQUISITION_CREATE", entityType: "StockRequisition", entityId: created.id, details: { code: created.requisitionCode } });
    res.status(201).json(created);
  } catch (e) {
    next(e);
  }
});

// POST /:id/submit — DRAFT → SUBMITTED
router.post("/:id/submit", async (req, res, next) => {
  try {
    const item = await prisma.stockRequisition.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: "Not found" });
    if (item.status !== RequisitionStatus.DRAFT) return res.status(400).json({ error: "Only DRAFT requisitions can be submitted" });

    const userId = (req as any).user!.userId as string;
    const userFacilityId = (req as any).user?.facilityId as string | undefined;
    if (!isCrossAdmin(req as any) && userFacilityId !== item.requestingFacilityId) {
      return res.status(403).json({ error: "Only the requesting facility can submit" });
    }

    const updated = await prisma.stockRequisition.update({
      where: { id: item.id },
      data: { status: RequisitionStatus.SUBMITTED },
      include: includeDetail,
    });

    await logAudit({ facilityId: item.requestingFacilityId, userId, action: "REQUISITION_SUBMIT", entityType: "StockRequisition", entityId: item.id, details: { code: item.requisitionCode } });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /:id/review — SUBMITTED → UNDER_REVIEW (issuing facility)
router.post("/:id/review", async (req, res, next) => {
  try {
    const item = await prisma.stockRequisition.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: "Not found" });
    if (item.status !== RequisitionStatus.SUBMITTED) return res.status(400).json({ error: "Only SUBMITTED requisitions can be put under review" });

    const userId = (req as any).user!.userId as string;
    const userFacilityId = (req as any).user?.facilityId as string | undefined;
    if (!isCrossAdmin(req as any) && userFacilityId !== item.issuingFacilityId) {
      return res.status(403).json({ error: "Only the issuing facility can mark as under review" });
    }

    const updated = await prisma.stockRequisition.update({
      where: { id: item.id },
      data: { status: RequisitionStatus.UNDER_REVIEW },
      include: includeDetail,
    });

    await logAudit({ facilityId: item.issuingFacilityId, userId, action: "REQUISITION_REVIEW", entityType: "StockRequisition", entityId: item.id, details: { code: item.requisitionCode } });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /:id/approve — UNDER_REVIEW → APPROVED (issuing facility, per-line quantities)
const approveSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string(),
    quantityApproved: z.number().int().min(0),
    approvalNotes: z.string().optional(),
  })),
});

router.post("/:id/approve", async (req, res, next) => {
  try {
    const item = await prisma.stockRequisition.findUnique({
      where: { id: req.params.id },
      include: { lines: true },
    });
    if (!item) return res.status(404).json({ error: "Not found" });
    if (item.status !== RequisitionStatus.UNDER_REVIEW) return res.status(400).json({ error: "Only UNDER_REVIEW requisitions can be approved" });

    const userId = (req as any).user!.userId as string;
    const userFacilityId = (req as any).user?.facilityId as string | undefined;
    if (!isCrossAdmin(req as any) && userFacilityId !== item.issuingFacilityId) {
      return res.status(403).json({ error: "Only the issuing facility can approve" });
    }

    const data = approveSchema.parse(req.body);

    await prisma.$transaction(async (tx) => {
      for (const lineApproval of data.lines) {
        const line = item.lines.find((l) => l.id === lineApproval.lineId);
        if (!line) continue;
        await tx.requisitionLine.update({
          where: { id: lineApproval.lineId },
          data: {
            quantityApproved: lineApproval.quantityApproved,
            approvalNotes: lineApproval.approvalNotes,
            shortfallFlag: lineApproval.quantityApproved < line.quantityRequested,
          },
        });
      }
      await tx.stockRequisition.update({
        where: { id: item.id },
        data: {
          status: RequisitionStatus.APPROVED,
          approvedById: userId,
          approvedAt: new Date(),
        },
      });
    });

    const updated = await prisma.stockRequisition.findUnique({ where: { id: item.id }, include: includeDetail });
    await logAudit({ facilityId: item.issuingFacilityId, userId, action: "REQUISITION_APPROVE", entityType: "StockRequisition", entityId: item.id, details: { code: item.requisitionCode } });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /:id/cancel — DRAFT|SUBMITTED → CANCELLED
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const item = await prisma.stockRequisition.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ error: "Not found" });
    const cancellableStatuses: string[] = [RequisitionStatus.DRAFT, RequisitionStatus.SUBMITTED];
    if (!cancellableStatuses.includes(item.status)) {
      return res.status(400).json({ error: "Only DRAFT or SUBMITTED requisitions can be cancelled" });
    }

    const userId = (req as any).user!.userId as string;
    const userFacilityId = (req as any).user?.facilityId as string | undefined;
    if (!isCrossAdmin(req as any) && userFacilityId !== item.requestingFacilityId && userFacilityId !== item.issuingFacilityId) {
      return res.status(403).json({ error: "Insufficient permissions to cancel this requisition" });
    }

    const updated = await prisma.stockRequisition.update({
      where: { id: item.id },
      data: { status: RequisitionStatus.CANCELLED, cancellationReason: reason, cancelledAt: new Date() },
      include: includeDetail,
    });

    await logAudit({ facilityId: item.requestingFacilityId, userId, action: "REQUISITION_CANCEL", entityType: "StockRequisition", entityId: item.id, details: { code: item.requisitionCode, reason } });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
