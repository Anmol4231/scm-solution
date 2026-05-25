import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt, { SignOptions } from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { config } from "../utils/config";
import { authenticate } from "../middleware/auth";

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({
      where: { email },
      include: { facility: true },
    });
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const signOptions: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"] };
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        facilityId: user.facilityId,
      },
      config.jwtSecret,
      signOptions
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        facilityId: user.facilityId,
        facility: user.facility,
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
    res.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      facilityId: user.facilityId,
      facility: user.facility,
    });
  } catch (e) {
    next(e);
  }
});

const facilitySwitchSchema = z.object({ facilityId: z.string() });

router.post("/switch-facility", authenticate, async (req, res, next) => {
  try {
    if (req.user!.role !== "PROVINCIAL_MANAGER") {
      return res.status(403).json({ error: "Only provincial managers can switch facilities" });
    }
    const { facilityId } = facilitySwitchSchema.parse(req.body);
    const facility = await prisma.facility.findUnique({ where: { id: facilityId } });
    if (!facility) return res.status(404).json({ error: "Facility not found" });

    const signOptions: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"] };
    const token = jwt.sign({ ...req.user, facilityId }, config.jwtSecret, signOptions);
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
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await prisma.passwordResetToken.create({
        data: { userId: user.id, token, expiresAt },
      });
      res.json({
        message: "If an account exists, a reset link has been generated.",
        resetToken: token,
        resetUrl: `/reset-password?token=${token}`,
        expiresAt,
        simulatedEmail: {
          to: email,
          subject: "SCM Solution — Password Reset",
          body: `Use this link to reset your password: /reset-password?token=${token} (expires in 1 hour)`,
        },
      });
      return;
    }

    res.json({ message: "If an account exists, a reset link has been generated." });
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
      prisma.user.update({ where: { id: resetRecord.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({
        where: { id: resetRecord.id },
        data: { usedAt: new Date() },
      }),
    ]);

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
