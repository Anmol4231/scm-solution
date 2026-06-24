import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { config } from "../utils/config";
import { authenticate } from "../middleware/auth";
import { isCrossFacilityRole } from "../utils/roles";
import { logAudit } from "../services/audit";
import { getEffectiveMatrix } from "../services/permissions";
import { sendEmail, buildForgotPasswordEmail } from "../utils/email";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

/** True when a configured expiry window has elapsed since the last password change. */
function isPasswordExpired(user: { passwordExpiryDays: number | null; passwordChangedAt: Date | null }): boolean {
  if (!user.passwordExpiryDays || user.passwordExpiryDays <= 0) return false; // Never
  const base = user.passwordChangedAt ?? null;
  if (!base) return true; // expiry configured but never recorded → treat as expired
  const ageMs = Date.now() - base.getTime();
  return ageMs >= user.passwordExpiryDays * 24 * 60 * 60 * 1000;
}

// After LOCKOUT_THRESHOLD consecutive failures the account locks for LOCKOUT_MINUTES.
// Users see a countdown warning on each failed attempt before that threshold.
const LOCKOUT_THRESHOLD = 3;   // lock after this many failures
const LOCKOUT_MINUTES = 5;

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email },
      include: { facility: true },
    });
    if (!user) {
      return res.status(401).json({ error: "No account found with this email address." });
    }
    if (!user.isActive) {
      return res.status(401).json({ error: "Your account has been deactivated. Contact your administrator." });
    }

    // Check active lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return res.status(429).json({
        error: `Account is locked. Try again in ${remaining} minute${remaining !== 1 ? "s" : ""}.`,
        lockedUntil: user.lockedUntil,
        locked: true,
      });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      const newAttempts = (user.loginAttempts ?? 0) + 1;
      const shouldLock = newAttempts >= LOCKOUT_THRESHOLD;
      const lockedUntil = shouldLock ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { loginAttempts: newAttempts, ...(shouldLock ? { lockedUntil } : {}) },
      });
      if (shouldLock) {
        await logAudit({
          facilityId: user.facilityId,
          userId: user.id,
          action: "ACCOUNT_LOCKED",
          entityType: "User",
          entityId: user.id,
          details: { email: user.email, reason: "Too many failed login attempts", lockedUntil },
        });
        return res.status(429).json({
          error: `Too many failed attempts. Your account has been locked for ${LOCKOUT_MINUTES} minutes.`,
          lockedUntil,
          locked: true,
        });
      }
      await logAudit({
        facilityId: user.facilityId,
        userId: user.id,
        action: "LOGIN_FAIL",
        entityType: "User",
        entityId: user.id,
        details: { email: user.email, attempt: newAttempts },
      });
      // Still have attempts left — show countdown warning
      const attemptsLeft = LOCKOUT_THRESHOLD - newAttempts;
      return res.status(401).json({
        error: `Incorrect password. ${attemptsLeft} attempt${attemptsLeft !== 1 ? "s" : ""} left before your account is locked.`,
        attemptsLeft,
        warning: true,
      });
    }

    // Successful login — reset lockout state
    if (user.loginAttempts > 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 0, lockedUntil: null } });
    }

    // Server-side password expiry: if the window has elapsed, force a change.
    let mustChangePassword = user.mustChangePassword;
    if (!mustChangePassword && isPasswordExpired(user)) {
      mustChangePassword = true;
      await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } });
    }

    const signOptions: SignOptions = { algorithm: "HS256", expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"] };
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        roleId: user.roleId,
        facilityId: user.facilityId,
      },
      config.jwtSecret,
      signOptions
    );

    const permissions = await getEffectiveMatrix(user);

    await logAudit({
      facilityId: user.facilityId,
      userId: user.id,
      action: "LOGIN_SUCCESS",
      entityType: "User",
      entityId: user.id,
      details: { email: user.email },
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        roleId: user.roleId,
        facilityId: user.facilityId,
        facility: user.facility,
        mustChangePassword,
        permissions,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      include: { facility: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });
    const permissions = await getEffectiveMatrix(user);
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      roleId: user.roleId,
      facilityId: user.facilityId,
      facility: user.facility,
      mustChangePassword: user.mustChangePassword,
      permissions,
    });
  } catch (e) {
    next(e);
  }
});

const profileSchema = z.object({
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  phone: z.string().trim().optional().or(z.literal("")),
});

router.patch("/profile", authenticate, async (req, res, next) => {
  try {
    const parsed = profileSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.user!.userId },
      data: { firstName: parsed.firstName, lastName: parsed.lastName, phone: parsed.phone || null },
      include: { facility: true },
    });
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      facilityId: user.facilityId,
      facility: user.facility,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (e) {
    next(e);
  }
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(6),
});

router.post("/change-password", authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } });
    if (!user) return res.status(404).json({ error: "User not found" });

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(400).json({ error: "Current password is incorrect" });

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
    });

    await logAudit({
      facilityId: user.facilityId,
      userId: user.id,
      action: "PASSWORD_CHANGE",
      entityType: "User",
      entityId: user.id,
      details: { name: `${user.firstName} ${user.lastName}`, email: user.email, self: true },
    });

    res.json({ message: "Password changed successfully" });
  } catch (e) {
    next(e);
  }
});

const facilitySwitchSchema = z.object({ facilityId: z.string() });

router.post("/switch-facility", authenticate, async (req, res, next) => {
  try {
    if (!isCrossFacilityRole(req.user!.role)) {
      return res.status(403).json({ error: "Only admin roles can switch facilities" });
    }
    const { facilityId } = facilitySwitchSchema.parse(req.body);
    const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
    if (!facility) return res.status(404).json({ error: "Facility not found" });

    // Re-issue a fresh token. req.user is the decoded JWT and still carries iat/exp,
    // so we rebuild a clean payload — passing exp alongside expiresIn throws.
    const { userId, email, role, roleId } = req.user!;
    const signOptions: SignOptions = { algorithm: "HS256", expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"] };
    const token = jwt.sign({ userId, email, role, roleId, facilityId }, config.jwtSecret, signOptions);
    res.json({ token, facility });
  } catch (e) {
    next(e);
  }
});

const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(6),
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const { email } = forgotSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email, isActive: true } });

    if (user) {
      // Invalidate any prior unused tokens for this user before issuing a new one.
      await prisma.passwordResetToken.deleteMany({
        where: { userId: user.id, usedAt: null },
      });
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });
      // SECURITY: the reset link must NOT be returned in the API response.
      // It is delivered out-of-band via email.
      const resetUrl = `${config.appBaseUrl}/reset-password?token=${token}`;
      const emailResult = await sendEmail(
        buildForgotPasswordEmail(email, resetUrl, expiresAt)
      );
      // When email is not configured (or delivery failed), preserve dev/ops
      // testability by logging the link to the server console.
      if (!emailResult.sent) {
        // eslint-disable-next-line no-console
        console.info(`[password-reset] ${email} → ${resetUrl} (expires ${expiresAt.toISOString()})`);
      }
      await logAudit({
        facilityId: user.facilityId,
        userId: user.id,
        action: "FORGOT_PASSWORD",
        entityType: "User",
        entityId: user.id,
        details: { email: user.email, emailSent: emailResult.sent },
      });
    }

    res.json({ found: !!user, message: user ? "Password reset link has been sent." : "No account found." });
  } catch (e) {
    next(e);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const { token, password } = resetSchema.parse(req.body);
    const resetRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetRecord || resetRecord.usedAt || resetRecord.expiresAt < new Date()) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetRecord.userId },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      }),
      // Mark this token used and void all remaining unused tokens for the account.
      prisma.passwordResetToken.updateMany({
        where: { userId: resetRecord.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    await logAudit({
      facilityId: resetRecord.user.facilityId,
      userId: resetRecord.userId,
      action: "PASSWORD_RESET_COMPLETE",
      entityType: "User",
      entityId: resetRecord.userId,
      details: { email: resetRecord.user.email },
    });

    res.json({ message: "Password reset successfully. You can now sign in." });
  } catch (e) {
    next(e);
  }
});

router.get("/facilities", authenticate, async (_req, res, next) => {
  try {
    const facilities = await prisma.facility.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    res.json(facilities);
  } catch (e) {
    next(e);
  }
});

export default router;
