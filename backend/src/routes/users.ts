import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { z } from "zod";
import { Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles, invalidateUserIdentity } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { logAudit } from "../services/audit";
import { personName, email as emailField, optionalPhone } from "../utils/validators";
import { sendEmail, buildWelcomeEmail, buildPasswordResetEmail, type EmailResult } from "../utils/email";

const router = Router();
router.use(authenticate);

// User administration is limited to master-data admins (enum guard, always on).
const userAdminRoles = requireRoles(
  UserRole.NURSE_ADMIN,
  UserRole.PROVINCIAL_MANAGER,
  UserRole.SUPER_ADMIN
);
router.use(userAdminRoles);

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  roleId: true,
  facilityId: true,
  phone: true,
  isActive: true,
  mustChangePassword: true,
  passwordExpiryDays: true,
  passwordChangedAt: true,
  createdAt: true,
  facility: { select: { id: true, name: true, code: true } },
  roleMaster: { select: { id: true, name: true, code: true, scopeAllFacilities: true } },
} satisfies Prisma.UserSelect;

// Password expiry presets (days). 0/null = Never. "Custom" is just any other integer.
const expiryDays = z
  .union([z.number().int().min(0).max(3650), z.null()])
  .optional();

const createSchema = z.object({
  firstName: personName,
  lastName: personName,
  email: emailField,
  roleId: z.string().trim().min(1, "A role is required"),
  /** Explicit facility access: true = all facilities, false = single facility (requires facilityId). */
  accessAllFacilities: z.boolean().optional(),
  facilityId: z.string().trim().optional().or(z.literal("")),
  phone: optionalPhone,
  mustChangePassword: z.boolean().optional(),
  passwordExpiryDays: expiryDays,
});

const updateSchema = createSchema.partial();

/** Readable one-time password, e.g. "Temp-Kp7mQ2xv" — excludes ambiguous chars. */
function generateTempPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += chars[bytes[i] % chars.length];
  return `Temp-${out}`;
}

/**
 * Derives the legacy `UserRole` enum, which reflects **data scope only**:
 * cross-facility access → PROVINCIAL_MANAGER; single-facility → PHARMACIST.
 * Module-level privileges are governed by the Role Master permission matrix via
 * `requirePermission`, NOT by this enum.
 */
function deriveEnumTier(accessAllFacilities: boolean): UserRole {
  return accessAllFacilities ? UserRole.PROVINCIAL_MANAGER : UserRole.PHARMACIST;
}

/** Users with all-facility access need no specific facilityId; single-facility users require one. */
function resolveFacilityId(
  accessAllFacilities: boolean,
  facilityId?: string
): { facilityId: string | null } | { error: string } {
  if (accessAllFacilities) return { facilityId: null };
  if (!facilityId) return { error: "Please assign a facility or select All Facilities" };
  return { facilityId };
}

router.get("/", requirePermission("users", "view"), async (req, res, next) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    const status = req.query.status as string | undefined;
    const where: Prisma.UserWhereInput = {
      ...(status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const users = await prisma.user.findMany({
      where,
      select: userSelect,
      orderBy: { createdAt: "desc" },
    });
    res.json(users);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", requirePermission("users", "view"), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: userSelect });
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (e) {
    next(e);
  }
});

router.post("/", requirePermission("users", "create"), async (req, res, next) => {
  try {
    const parsed = createSchema.parse(req.body);
    const email = parsed.email; // already lowercased by validator

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "A user with this username/email already exists" });

    const role = await prisma.role.findUnique({ where: { id: parsed.roleId } });
    if (!role || !role.isActive) return res.status(400).json({ error: "Selected role is invalid or inactive" });

    // User-supplied access level overrides any role default.
    const accessAllFacilities = parsed.accessAllFacilities ?? role.scopeAllFacilities;
    const loc = resolveFacilityId(accessAllFacilities, parsed.facilityId || undefined);
    if ("error" in loc) return res.status(400).json({ error: loc.error });

    const temporaryPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const user = await prisma.user.create({
      data: {
        firstName: parsed.firstName,
        lastName: parsed.lastName,
        email,
        roleId: role.id,
        role: deriveEnumTier(accessAllFacilities),
        facilityId: loc.facilityId,
        phone: parsed.phone || null,
        passwordHash,
        mustChangePassword: parsed.mustChangePassword ?? true,
        passwordExpiryDays: parsed.passwordExpiryDays ?? null,
        passwordChangedAt: new Date(),
      },
      select: userSelect,
    });

    await logAudit({
      facilityId: user.facilityId,
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      details: { name: `${user.firstName} ${user.lastName}`, email: user.email, role: role.name },
    });

    const emailResult: EmailResult = await sendEmail(
      buildWelcomeEmail(user.firstName, user.email, temporaryPassword)
    );

    res.status(201).json({
      user,
      temporaryPassword,
      emailSent: emailResult.sent,
      ...(emailResult.error
        ? { emailWarning: "Account created but the welcome email could not be delivered. Share this password manually." }
        : {}),
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", requirePermission("users", "edit"), async (req, res, next) => {
  try {
    const parsed = updateSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const data: Prisma.UserUpdateInput = {};
    if (parsed.firstName !== undefined) data.firstName = parsed.firstName;
    if (parsed.lastName !== undefined) data.lastName = parsed.lastName;
    if (parsed.phone !== undefined) data.phone = parsed.phone || null;
    if (parsed.mustChangePassword !== undefined) data.mustChangePassword = parsed.mustChangePassword;
    if (parsed.passwordExpiryDays !== undefined) data.passwordExpiryDays = parsed.passwordExpiryDays;

    if (parsed.email !== undefined) {
      const email = parsed.email;
      if (email !== user.email) {
        const clash = await prisma.user.findUnique({ where: { email } });
        if (clash) return res.status(409).json({ error: "A user with this username/email already exists" });
        data.email = email;
      }
    }

    // Role/facility/access change → re-derive enum tier + revalidate facility assignment.
    if (parsed.roleId !== undefined || parsed.facilityId !== undefined || parsed.accessAllFacilities !== undefined) {
      const roleId = parsed.roleId ?? user.roleId;
      if (!roleId) return res.status(400).json({ error: "A role is required" });
      const role = await prisma.role.findUnique({ where: { id: roleId } });
      if (!role || !role.isActive) return res.status(400).json({ error: "Selected role is invalid or inactive" });

      // Explicit flag from the request wins; fall back to inferring from current facilityId.
      const accessAllFacilities =
        parsed.accessAllFacilities !== undefined
          ? parsed.accessAllFacilities
          : user.facilityId === null;

      const loc = resolveFacilityId(
        accessAllFacilities,
        parsed.facilityId !== undefined ? parsed.facilityId || undefined : user.facilityId || undefined
      );
      if ("error" in loc) return res.status(400).json({ error: loc.error });

      data.roleMaster = { connect: { id: role.id } };
      data.role = deriveEnumTier(accessAllFacilities);
      data.facility = loc.facilityId ? { connect: { id: loc.facilityId } } : { disconnect: true };
    }

    const updated = await prisma.user.update({ where: { id: user.id }, data, select: userSelect });

    // Role / facility / email / access changed — drop the cached identity so the
    // edited user's next request reflects it immediately (no re-login needed).
    invalidateUserIdentity(updated.id);

    await logAudit({
      facilityId: updated.facilityId,
      userId: req.user!.userId,
      action: "UPDATE",
      entityType: "User",
      entityId: updated.id,
      details: { name: `${updated.firstName} ${updated.lastName}`, email: updated.email },
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/status", requirePermission("users", "edit"), async (req, res, next) => {
  try {
    const isActive = z.object({ isActive: z.boolean() }).parse(req.body).isActive;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });
    if (user.id === req.user!.userId && !isActive) {
      return res.status(400).json({ error: "You cannot deactivate your own account" });
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { isActive },
      select: userSelect,
    });

    // Deactivation must take effect immediately — drop the cached identity so the
    // next request from this user is rejected (or re-enabled on activation).
    invalidateUserIdentity(updated.id);

    await logAudit({
      facilityId: updated.facilityId,
      userId: req.user!.userId,
      action: isActive ? "ACTIVATE" : "DEACTIVATE",
      entityType: "User",
      entityId: updated.id,
      details: { name: `${updated.firstName} ${updated.lastName}`, email: updated.email },
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/reset-password", requirePermission("users", "edit"), async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const temporaryPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: new Date() },
    });

    await logAudit({
      facilityId: user.facilityId,
      userId: req.user!.userId,
      action: "PASSWORD_RESET",
      entityType: "User",
      entityId: user.id,
      details: { name: `${user.firstName} ${user.lastName}`, email: user.email, forcedChange: true },
    });

    const emailResult: EmailResult = await sendEmail(
      buildPasswordResetEmail(user.firstName, user.email, temporaryPassword)
    );

    res.json({
      temporaryPassword,
      emailSent: emailResult.sent,
      ...(emailResult.error
        ? { emailWarning: "Password reset but the notification email could not be delivered. Share this password manually." }
        : {}),
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/force-password-change", requirePermission("users", "edit"), async (req, res, next) => {
  try {
    const mustChange = z.object({ mustChangePassword: z.boolean() }).parse(req.body).mustChangePassword;
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { mustChangePassword: mustChange },
      select: userSelect,
    });

    await logAudit({
      facilityId: updated.facilityId,
      userId: req.user!.userId,
      action: "FORCE_PASSWORD_CHANGE",
      entityType: "User",
      entityId: updated.id,
      details: { name: `${updated.firstName} ${updated.lastName}`, email: updated.email, mustChangePassword: mustChange },
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
