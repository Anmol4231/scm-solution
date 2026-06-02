import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { processChatMessage, getWelcomeMessages, ASSISTANT_PROFILE } from "../services/chatAssistant";

const router = Router();
router.use(authenticate);

const messageSchema = z.object({
  message: z.string().min(1).max(2000),
  facilityId: z.string().optional(),
});

router.get("/profile", authenticate, (_req, res) => {
  res.json({
    assistant: ASSISTANT_PROFILE,
    welcome: getWelcomeMessages(),
  });
});

router.post("/", async (req, res, next) => {
  try {
    const { message, facilityId: bodyFacilityId } = messageSchema.parse(req.body);
    const facilityId =
      getFacilityId(req, bodyFacilityId) ?? req.user?.facilityId ?? null;
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { firstName: true, lastName: true },
    });
    const displayName = user ? `${user.firstName} ${user.lastName}`.trim() : "You";
    const response = await processChatMessage(message, facilityId, displayName, req.user!.role);
    res.json(response);
  } catch (e) {
    next(e);
  }
});

export default router;
