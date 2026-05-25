import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { checkExpiryAlerts, checkLowStockAndStockout } from "../services/alerts";

const router = Router();
router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const alerts = await prisma.alert.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        ...(req.query.unread === "true" ? { isRead: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(alerts);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/read", async (req, res, next) => {
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
