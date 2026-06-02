import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles } from "../middleware/auth";
import { UserRole } from "@prisma/client";
import { logChangeHistory } from "../services/changeHistory";

const router = Router();
router.use(authenticate);

const categoryManagerRoles = requireRoles(
  UserRole.NURSE_ADMIN,
  UserRole.PROVINCIAL_MANAGER,
  UserRole.SUPER_ADMIN
);

const categorySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().optional().or(z.literal("")),
  sortOrder: z.preprocess(
    (value) => (value === undefined || value === null || value === "" ? undefined : Number(value)),
    z.number().int().optional()
  ),
});

router.get("/deleted", categoryManagerRoles, async (_req, res, next) => {
  try {
    const categories = await prisma.medicineCategory.findMany({
      where: { OR: [{ isActive: false }, { deletedAt: { not: null } }] },
      include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json(categories);
  } catch (e) {
    next(e);
  }
});

router.get("/", async (_req, res, next) => {
  try {
    const categories = await prisma.medicineCategory.findMany({
      where: { isActive: true, deletedAt: null },
      include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json(categories);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const category = await prisma.medicineCategory.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
    });
    if (!category) return res.status(404).json({ error: "Category not found" });
    res.json(category);
  } catch (e) {
    next(e);
  }
});

router.post("/", categoryManagerRoles, async (req, res, next) => {
  try {
    const parsed = categorySchema.parse(req.body);
    const data = {
      name: parsed.name,
      description: parsed.description || undefined,
      sortOrder: parsed.sortOrder ?? 0,
    };

    const existing = await prisma.medicineCategory.findFirst({
      where: { name: { equals: data.name, mode: "insensitive" }, deletedAt: null },
    });
    if (existing) {
      return res.status(409).json({ error: "Category name already exists" });
    }

    const category = await prisma.medicineCategory.create({ data });

    await logChangeHistory({
      facilityId: req.user!.facilityId,
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "MedicineCategory",
      entityId: category.id,
      entityName: category.name,
      currentValues: {
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
      },
      changeDetails: "Created new category",
    });

    res.status(201).json(category);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", categoryManagerRoles, async (req, res, next) => {
  try {
    const parsed = categorySchema.partial().parse(req.body);
    const category = await prisma.medicineCategory.findFirst({
    const category = await prisma.medicineCategory.findFirst({
      where: { id: req.params.id, deletedAt: null },
    });
    if (!category) return res.status(404).json({ error: "Category not found" });

    if (parsed.name) {
      const existing = await prisma.medicineCategory.findFirst({
        where: {
          name: { equals: parsed.name, mode: "insensitive" },
          deletedAt: null,
          id: { not: category.id },
        },
      });
      if (existing) return res.status(409).json({ error: "Category name already exists" });
    }

    // Capture previous values
    const previousValues = {
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
    };

    const updated = await prisma.medicineCategory.update({
      where: { id: category.id },
      data: {
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.description !== undefined ? { description: parsed.description || null } : {}),
        ...(parsed.sortOrder !== undefined ? { sortOrder: parsed.sortOrder } : {}),
      },
      include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
    });

    const currentValues = {
      name: updated.name,
      description: updated.description,
      sortOrder: updated.sortOrder,
    };

    const changedFields = Object.keys(currentValues).filter(
      (key) => previousValues[key as keyof typeof previousValues] !== currentValues[key as keyof typeof currentValues]
    );

    await logChangeHistory({
      facilityId: req.user!.facilityId,
      userId: req.user!.userId,
      action: "UPDATE",
      entityType: "MedicineCategory",
      entityId: updated.id,
      entityName: updated.name,
      previousValues,
      currentValues,
      changeDetails: changedFields.length > 0 ? `Modified: ${changedFields.join(", ")}` : undefined,
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", categoryManagerRoles, async (req, res, next) => {
  try {
    const category = await prisma.medicineCategory.findFirst({
      where: { id: req.params.id, deletedAt: null },
      include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
    });
    if (!category) return res.status(404).json({ error: "Category not found" });
    if (category._count.medicines > 0) {
      return res.status(409).json({ error: "Cannot delete a category linked to active medicines" });
    }

    const deleted = await prisma.medicineCategory.update({
      where: { id: category.id },
      data: { isActive: false, deletedAt: new Date(), deletedById: req.user!.userId },
      include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
    });

    await logChangeHistory({
      facilityId: req.user!.facilityId,
      userId: req.user!.userId,
      action: "SOFT_DELETE",
      entityType: "MedicineCategory",
      entityId: deleted.id,
      entityName: deleted.name,
      previousValues: { isActive: true, deletedAt: null },
      currentValues: { isActive: false, deletedAt: new Date() },
      changeDetails: "Soft-deleted category",
    });

    res.json(deleted);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/restore", categoryManagerRoles, async (req, res, next) => {
  try {
    const category = await prisma.medicineCategory.findUnique({ where: { id: req.params.id } });
    if (!category) return res.status(404).json({ error: "Category not found" });

    const existing = await prisma.medicineCategory.findFirst({
      where: {
        name: { equals: category.name, mode: "insensitive" },
        deletedAt: null,
        id: { not: category.id },
      },
    });
    if (existing) return res.status(409).json({ error: "Cannot restore because an active category with this name already exists" });

    const restored = await prisma.medicineCategory.update({
      where: { id: category.id },
      data: { isActive: true, deletedAt: null, deletedById: null },
      include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
    });

    await logChangeHistory({
      facilityId: req.user!.facilityId,
      userId: req.user!.userId,
      action: "RESTORE",
      entityType: "MedicineCategory",
      entityId: restored.id,
      entityName: restored.name,
      previousValues: { isActive: false, deletedAt: category.deletedAt },
      currentValues: { isActive: true, deletedAt: null },
      changeDetails: "Restored soft-deleted category",
    });

    res.json(restored);
  } catch (e) {
    next(e);
  }
});

// Change History & Recovery Endpoints
router.get("/:id/change-history", categoryManagerRoles, async (req, res, next) => {
  try {
    const categoryId = req.params.id;
    const changes = await prisma.auditLog.findMany({
      where: {
        entityId: categoryId,
        entityType: "MedicineCategory",
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const formatted = changes.map((log) => {
      const details = log.details as {
        name?: string;
        previousValues?: Record<string, unknown>;
        currentValues?: Record<string, unknown>;
        changeDetails?: string;
      } | null;

      return {
        id: log.id,
        timestamp: log.createdAt,
        action: log.action,
        actionLabel:
          log.action === "CREATE"
            ? "Created"
            : log.action === "UPDATE"
              ? "Updated"
              : log.action === "SOFT_DELETE"
                ? "Deleted"
                : log.action === "RESTORE"
                  ? "Restored"
                  : log.action,
        changedBy: log.user
          ? `${log.user.firstName} ${log.user.lastName}`.trim() || log.user.email
          : "System",
        changedByEmail: log.user?.email,
        previousValues: details?.previousValues,
        currentValues: details?.currentValues,
        changeDetails: details?.changeDetails,
      };
    });

    res.json(formatted);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/previous-version/:changeId", categoryManagerRoles, async (req, res, next) => {
  try {
    const { id: categoryId, changeId } = req.params;

    const change = await prisma.auditLog.findUnique({
      where: { id: changeId },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    if (!change || change.entityId !== categoryId || change.entityType !== "MedicineCategory") {
      return res.status(404).json({ error: "Change not found" });
    }

    const details = change.details as {
      previousValues?: Record<string, unknown>;
      currentValues?: Record<string, unknown>;
    } | null;

    res.json({
      change: {
        id: change.id,
        timestamp: change.createdAt,
        action: change.action,
        changedBy: change.user
          ? `${change.user.firstName} ${change.user.lastName}`.trim() || change.user.email
          : "System",
      },
      previousVersion: details?.previousValues,
      currentVersion: details?.currentValues,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
