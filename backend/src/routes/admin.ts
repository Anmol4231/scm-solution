import { Router, Request, Response, NextFunction } from "express";
import { AlertSeverity } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { isAdminDashboardRole } from "../utils/roles";
import { buildAdminDashboard } from "../services/adminDashboard";
import { getFacilityHealthStatus } from "../services/facilityHealth";
import { buildTransferRecommendations } from "../services/transferRecommendations";

const router = Router();
router.use(authenticate);

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || !isAdminDashboardRole(req.user.role)) {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

router.use(requireAdmin);

router.get("/dashboard", async (req, res, next) => {
  try {
    const facilityId = (req.query.facilityId as string) || undefined;
    const data = await buildAdminDashboard(facilityId);
    res.json(data);
  } catch (e) {
    next(e);
  }
});

router.get("/alerts", async (req, res, next) => {
  try {
    const facilityId = req.query.facilityId as string | undefined;
    const severity = req.query.severity as AlertSeverity | undefined;
    const unresolved = req.query.unresolved !== "false";
    const type = req.query.type as string | undefined;

    const alerts = await prisma.alert.findMany({
      where: {
        ...(facilityId ? { facilityId } : {}),
        ...(severity ? { severity } : {}),
        ...(unresolved ? { resolvedAt: null } : {}),
        ...(type ? { type: type as never } : {}),
      },
      include: {
        facility: { select: { id: true, name: true, code: true, facilityType: true } },
        acknowledgedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    const counts = await prisma.alert.groupBy({
      by: ["severity"],
      where: { resolvedAt: null, ...(facilityId ? { facilityId } : {}) },
      _count: true,
    });

    res.json({ alerts, severityCounts: counts });
  } catch (e) {
    next(e);
  }
});

router.get("/map", async (req, res, next) => {
  try {
    const facilities = await prisma.facility.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    const mapFacilities = await Promise.all(
      facilities.map(async (f) => {
        const health = await getFacilityHealthStatus(f.id);
        return {
          id: f.id,
          name: f.name,
          code: f.code,
          facilityType: f.facilityType,
          province: f.province,
          district: f.district,
          latitude: f.latitude,
          longitude: f.longitude,
          healthStatus: health.status,
          ...health,
        };
      })
    );
    res.json({ facilities: mapFacilities });
  } catch (e) {
    next(e);
  }
});

router.get("/facilities/:id", async (req, res, next) => {
  try {
    const facility = await prisma.facility.findUnique({ where: { id: req.params.id } });
    if (!facility) return res.status(404).json({ error: "Facility not found" });
    const health = await getFacilityHealthStatus(facility.id);
    const [patients, workers, alerts, pendingTransfers] = await Promise.all([
      prisma.patient.count({ where: { facilityId: facility.id } }),
      prisma.healthcareWorker.count({ where: { facilityId: facility.id, status: "ACTIVE" } }),
      prisma.alert.findMany({
        where: { facilityId: facility.id, resolvedAt: null },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      prisma.transfer.count({
        where: {
          OR: [{ fromFacilityId: facility.id }, { toFacilityId: facility.id }],
          status: { in: ["PENDING", "IN_TRANSIT"] },
        },
      }),
    ]);
    res.json({ facility, health, patients, workers, alerts, pendingTransfers });
  } catch (e) {
    next(e);
  }
});

router.get("/transfer-recommendations", async (req, res, next) => {
  try {
    const facilityId = (req.query.facilityId as string) || undefined;
    const recommendations = await buildTransferRecommendations(facilityId);
    res.json({ recommendations });
  } catch (e) {
    next(e);
  }
});

router.patch("/alerts/:id/resolve", async (req, res, next) => {
  try {
    const alert = await prisma.alert.update({
      where: { id: req.params.id },
      data: {
        isRead: true,
        resolvedAt: new Date(),
        acknowledgedById: req.user!.userId,
      },
      include: { facility: { select: { name: true, code: true } } },
    });
    res.json(alert);
  } catch (e) {
    next(e);
  }
});


export default router;
