import { Router } from "express";
import { z } from "zod";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { logAudit } from "../services/audit";
import { invalidateRoleCache } from "../services/permissions";
import { sanitizeMatrix } from "../utils/permissionMatrix";
import { masterCode, personName } from "../utils/validators";

const router = Router();
router.use(authenticate);

// Legacy enum guard (always on) + permission guard (on when RBAC_ENFORCE=true).
const roleAdmins = requireRoles(
  UserRole.NURSE_ADMIN,
  UserRole.PROVINCIAL_MANAGER,
  UserRole.SUPER_ADMIN
);

const roleSchema = z.object({
  name: personName,
  code: masterCode,
  description: z.string().trim().max(300).optional().or(z.literal("")),
  isActive: z.boolean().optional(),
  scopeAllFacilities: z.boolean().optional(),
  permissions: z.record(z.array(z.string())).optional(),
});

function serialize(role: Prisma.RoleGetPayload<{ include: { _count: { select: { users: true } } } }>) {
  return {
    id: role.id,
    name: role.name,
    code: role.code,
    description: role.description,
    isActive: role.isActive,
    isSystem: role.isSystem,
    scopeAllFacilities: role.scopeAllFacilities,
    permissions: sanitizeMatrix(role.permissions),
    userCount: role._count.users,
    createdAt: role.createdAt,
  };
}

router.get("/", roleAdmins, requirePermission("roles", "view"), async (_req, res, next) => {
  try {
    const roles = await prisma.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    });
    res.json(roles.map(serialize));
  } catch (e) {
    next(e);
  }
});

router.get("/:id", roleAdmins, requirePermission("roles", "view"), async (req, res, next) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) return res.status(404).json({ error: "Role not found" });
    res.json(serialize(role));
  } catch (e) {
    next(e);
  }
});

router.post("/", roleAdmins, requirePermission("roles", "create"), async (req, res, next) => {
  try {
    const parsed = roleSchema.parse(req.body);

    const clash = await prisma.role.findFirst({
      where: { OR: [{ name: { equals: parsed.name, mode: "insensitive" } }, { code: parsed.code }] },
    });
    if (clash) return res.status(409).json({ error: "A role with this name or code already exists" });

    const role = await prisma.role.create({
      data: {
        name: parsed.name,
        code: parsed.code,
        description: parsed.description || null,
        isActive: parsed.isActive ?? true,
        isSystem: false,
        scopeAllFacilities: parsed.scopeAllFacilities ?? false,
        permissions: sanitizeMatrix(parsed.permissions) as Prisma.InputJsonValue,
      },
      include: { _count: { select: { users: true } } },
    });

    await logAudit({
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "Role",
      entityId: role.id,
      details: { name: role.name, code: role.code },
    });

    res.status(201).json(serialize(role));
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", roleAdmins, requirePermission("roles", "edit"), async (req, res, next) => {
  try {
    const parsed = roleSchema.partial().parse(req.body);
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) return res.status(404).json({ error: "Role not found" });

    const data: Prisma.RoleUpdateInput = {};

    if (parsed.name !== undefined && parsed.name !== role.name) {
      const clash = await prisma.role.findFirst({
        where: { name: { equals: parsed.name, mode: "insensitive" }, id: { not: role.id } },
      });
      if (clash) return res.status(409).json({ error: "A role with this name already exists" });
      data.name = parsed.name;
    }

    // Code is immutable after creation.
    if (parsed.code !== undefined && parsed.code !== role.code) {
      return res.status(400).json({ error: "Role code cannot be changed after creation" });
    }

    if (parsed.description !== undefined) data.description = parsed.description || null;
    if (parsed.scopeAllFacilities !== undefined && !role.isSystem) {
      data.scopeAllFacilities = parsed.scopeAllFacilities;
    }
    if (parsed.permissions !== undefined) {
      data.permissions = sanitizeMatrix(parsed.permissions) as Prisma.InputJsonValue;
    }
    if (parsed.isActive !== undefined) {
      // Never let the built-in Administrator role be deactivated (lock-out guard).
      if (!parsed.isActive && role.isSystem && role.code === "ADMIN") {
        return res.status(400).json({ error: "The Administrator role cannot be deactivated" });
      }
      data.isActive = parsed.isActive;
    }

    const updated = await prisma.role.update({
      where: { id: role.id },
      data,
      include: { _count: { select: { users: true } } },
    });
    invalidateRoleCache(role.id);

    await logAudit({
      userId: req.user!.userId,
      action: "UPDATE",
      entityType: "Role",
      entityId: role.id,
      details: { name: updated.name, code: updated.code },
    });

    res.json(serialize(updated));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", roleAdmins, requirePermission("roles", "delete"), async (req, res, next) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) return res.status(404).json({ error: "Role not found" });
    if (role.isSystem) return res.status(400).json({ error: "System roles cannot be deleted" });
    if (role._count.users > 0) {
      return res.status(409).json({ error: "Reassign the users on this role before deleting it" });
    }

    await prisma.role.delete({ where: { id: role.id } });
    invalidateRoleCache(role.id);

    await logAudit({
      userId: req.user!.userId,
      action: "DELETE",
      entityType: "Role",
      entityId: role.id,
      details: { name: role.name, code: role.code },
    });

    res.json({ message: "Role deleted" });
  } catch (e) {
    next(e);
  }
});

export default router;
