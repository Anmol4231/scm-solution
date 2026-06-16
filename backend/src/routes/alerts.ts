import { Router } from "express";
import { AlertSeverity, AlertType, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { checkExpiryAlerts, checkLowStockAndStockout } from "../services/alerts";
import { logAudit } from "../services/audit";

const router = Router();
router.use(authenticate);

const alertView    = requirePermission("alerts", "view");
const alertApprove = requirePermission("alerts", "approve");

const LOW_STOCK_TYPES: AlertType[] = [AlertType.SHORTFALL, AlertType.LOW_STOCK, AlertType.STOCKOUT];
const EXPIRY_TYPES: AlertType[] = [AlertType.EXPIRY_WARNING, AlertType.EXPIRY_CRITICAL];

const alertInclude = {
  facility: { select: { id: true, name: true, code: true } },
  acknowledgedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AlertInclude;

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

router.get("/", alertView, async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const facilityScope = facilityId ? { facilityId } : {};

    const category = req.query.category as string | undefined; // "low_stock" | "expiry"
    const resolvedParam = req.query.resolved as string | undefined; // "true" | "false" | undefined
    const q = (req.query.q as string | undefined)?.trim();
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);

    const isResolved = resolvedParam === "true";
    const resolvedWhere =
      resolvedParam === undefined ? {} : isResolved ? { resolvedAt: { not: null } } : { resolvedAt: null };

    const typeFilter =
      category === "low_stock" ? LOW_STOCK_TYPES : category === "expiry" ? EXPIRY_TYPES : undefined;

    const range =
      from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
    // Active alerts filter on when they were raised; resolved alerts filter on when they were resolved.
    const dateWhere = range ? (isResolved ? { resolvedAt: range } : { createdAt: range }) : {};

    const searchWhere = q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { message: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {};

    const where: Prisma.AlertWhereInput = {
      ...facilityScope,
      ...(typeFilter ? { type: { in: typeFilter } } : {}),
      ...resolvedWhere,
      ...dateWhere,
      ...searchWhere,
    };

    const [alerts, lowStock, expiry, resolved] = await Promise.all([
      prisma.alert.findMany({
        where,
        include: alertInclude,
        orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        take: 200,
      }),
      prisma.alert.count({ where: { ...facilityScope, resolvedAt: null, type: { in: LOW_STOCK_TYPES } } }),
      prisma.alert.count({ where: { ...facilityScope, resolvedAt: null, type: { in: EXPIRY_TYPES } } }),
      prisma.alert.count({ where: { ...facilityScope, resolvedAt: { not: null } } }),
    ]);

    res.json({ alerts, counts: { lowStock, expiry, resolved } });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/read", alertView, async (req, res, next) => {
  try {
    const alert = await prisma.alert.update({
      where: { id: req.params.id },
      data: { isRead: true, acknowledgedById: req.user!.userId },
    });
    res.json(alert);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/resolve", alertApprove, async (req, res, next) => {
  try {
    const existing = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Alert not found" });

    const alert = await prisma.alert.update({
      where: { id: req.params.id },
      data: { isRead: true, resolvedAt: new Date(), acknowledgedById: req.user!.userId },
      include: alertInclude,
    });

    // Audit the resolution — alert records are never deleted, only resolved.
    await logAudit({
      facilityId: alert.facilityId,
      userId: req.user!.userId,
      action: "RESOLVE",
      entityType: "Alert",
      entityId: alert.id,
      details: {
        alertType: alert.type,
        severity: alert.severity,
        title: alert.title,
        resolvedAt: alert.resolvedAt,
      },
    });

    res.json(alert);
  } catch (e) {
    next(e);
  }
});

const alertCreateSchema = z.object({
  facilityId: z.string().optional(),
  type: z.nativeEnum(AlertType),
  severity: z.nativeEnum(AlertSeverity).default(AlertSeverity.WARNING),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  medicineId: z.string().optional(),
});

const alertEditSchema = z.object({
  severity: z.nativeEnum(AlertSeverity).optional(),
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(1000).optional(),
});

router.post("/", alertApprove, async (req, res, next) => {
  try {
    const parsed = alertCreateSchema.parse(req.body);
    const alert = await prisma.alert.create({
      data: {
        facilityId: parsed.facilityId ?? null,
        type: parsed.type,
        severity: parsed.severity,
        title: parsed.title,
        message: parsed.message,
        medicineId: parsed.medicineId ?? null,
      },
      include: alertInclude,
    });
    await logAudit({
      facilityId: alert.facilityId,
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "Alert",
      entityId: alert.id,
      details: { type: alert.type, severity: alert.severity, title: alert.title },
    });
    res.status(201).json(alert);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", alertApprove, async (req, res, next) => {
  try {
    const existing = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Alert not found" });
    const parsed = alertEditSchema.parse(req.body);
    const alert = await prisma.alert.update({
      where: { id: req.params.id },
      data: {
        ...(parsed.severity !== undefined ? { severity: parsed.severity } : {}),
        ...(parsed.title !== undefined ? { title: parsed.title } : {}),
        ...(parsed.message !== undefined ? { message: parsed.message } : {}),
      },
      include: alertInclude,
    });
    await logAudit({
      facilityId: alert.facilityId,
      userId: req.user!.userId,
      action: "UPDATE",
      entityType: "Alert",
      entityId: alert.id,
      details: { title: alert.title, severity: alert.severity },
    });
    res.json(alert);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/activate", alertApprove, async (req, res, next) => {
  try {
    const existing = await prisma.alert.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Alert not found" });
    const alert = await prisma.alert.update({
      where: { id: req.params.id },
      data: { resolvedAt: null, isRead: false, acknowledgedById: null },
      include: alertInclude,
    });
    await logAudit({
      facilityId: alert.facilityId,
      userId: req.user!.userId,
      action: "ACTIVATE",
      entityType: "Alert",
      entityId: alert.id,
      details: { title: alert.title },
    });
    res.json(alert);
  } catch (e) {
    next(e);
  }
});

router.post("/run-checks", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.body.facilityId);
    if (!facilityId) return res.status(400).json({ error: "Facility required" });
    await checkLowStockAndStockout(facilityId);
    await checkExpiryAlerts(facilityId);
    res.json({ message: "Alert checks completed" });
  } catch (e) {
    next(e);
  }
});

export default router;
