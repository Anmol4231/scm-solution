import { Router } from "express";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles } from "../middleware/auth";

const router = Router();
router.use(authenticate);
router.use(requireRoles(UserRole.NURSE_ADMIN, UserRole.PROVINCIAL_MANAGER, UserRole.SUPER_ADMIN));

// Friendly grouping of entity types for the Audit Trail filters.
const CATEGORY_ENTITIES: Record<string, string[]> = {
  users: ["User"],
  medicines: ["Medicine", "MedicineCategory"],
  stock: ["StockBatch", "StockOrder", "DispensingRecord", "MedicineReturn", "Transfer"],
  alerts: ["Alert"],
  staff: ["HealthcareWorker"],
  facilities: ["Facility"],
  roles: ["Role"],
};

const ACTION_LABELS: Record<string, string> = {
  CREATE: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
  SOFT_DELETE: "Deleted",
  RESTORE: "Restored",
  RESOLVE: "Resolved",
  ACTIVATE: "Activated",
  DEACTIVATE: "Deactivated",
  PASSWORD_RESET: "Password reset",
  FORCE_PASSWORD_CHANGE: "Forced password change",
  PASSWORD_CHANGE: "Password changed",
};

/** Fallback for actions without an explicit label: VENDOR_ORDER -> "Vendor Order". */
function humanizeAction(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

router.get("/", async (req, res, next) => {
  try {
    const category = req.query.category as string | undefined; // users | medicines | alerts
    const entityType = req.query.entityType as string | undefined; // exact override
    const action = req.query.action as string | undefined;
    const q = (req.query.q as string | undefined)?.trim();
    const from = parseDate(req.query.from);
    const to = parseDate(req.query.to);
    const limit = Math.min(Number(req.query.limit) || 200, 500);

    const entityTypes = entityType
      ? [entityType]
      : category && CATEGORY_ENTITIES[category]
        ? CATEGORY_ENTITIES[category]
        : undefined;

    const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

    const where: Prisma.AuditLogWhereInput = {
      ...(entityTypes ? { entityType: { in: entityTypes } } : {}),
      ...(action ? { action } : {}),
      ...(range ? { createdAt: range } : {}),
      ...(q
        ? {
            OR: [
              { entityType: { contains: q, mode: "insensitive" } },
              { action: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const logs = await prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        facility: { select: { name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    // Location is meaningless for global master data — hide it for these entities.
    const LOCATION_HIDDEN_ENTITIES = new Set(["Medicine", "MedicineCategory", "Role", "Facility"]);

    const formatted = logs.map((log) => {
      const details = log.details as Record<string, unknown> | null;
      const hideLocation = LOCATION_HIDDEN_ENTITIES.has(log.entityType);

      const previousValues = (details?.previousValues as Record<string, unknown>) ?? null;
      const currentValues  = (details?.currentValues  as Record<string, unknown>) ?? null;
      const changeDetails  = (details?.changeDetails  as string) ?? null;

      // For CREATE entries logged with only flat fields (e.g. { name, code }),
      // surface the extra fields as currentValues so the View panel shows something.
      // We only do this for CREATE because for UPDATE the flat fields don't tell us
      // what actually changed; those get "No additional details" until re-logged.
      const STANDARD_KEYS = new Set(["name", "email", "title", "action", "previousValues", "currentValues", "changeDetails"]);
      const inferredCurrent: Record<string, unknown> | null = (() => {
        if (currentValues || log.action !== "CREATE" || !details) return null;
        const extra = Object.fromEntries(
          Object.entries(details).filter(([k]) => !STANDARD_KEYS.has(k))
        );
        return Object.keys(extra).length ? extra : null;
      })();

      return {
        id: log.id,
        timestamp: log.createdAt,
        action: log.action,
        actionLabel: ACTION_LABELS[log.action] ?? humanizeAction(log.action),
        entityType: log.entityType,
        entityId: log.entityId,
        recordName: (details?.name ?? details?.title ?? details?.email ?? "—") as string,
        changedBy: log.user
          ? `${log.user.firstName} ${log.user.lastName}`.trim() || log.user.email
          : "System",
        facility: hideLocation ? null : log.facility?.name ?? null,
        previousValues,
        currentValues: currentValues ?? inferredCurrent,
        changeDetails,
      };
    });

    res.json({ logs: formatted, total: formatted.length });
  } catch (e) {
    next(e);
  }
});

export default router;
