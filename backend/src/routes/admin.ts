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

// Recovery & Change History Endpoints
router.get("/recent-changes", async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    const entityTypes = req.query.entityTypes
      ? (req.query.entityTypes as string).split(",")
      : ["Medicine", "MedicineCategory"];

    const changes = await prisma.auditLog.findMany({
      where: {
        entityType: { in: entityTypes },
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        facility: { select: { id: true, name: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
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
        entityType: log.entityType,
        entityId: log.entityId,
        recordName: details?.name ?? "Record",
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
        facility: log.facility?.name || "N/A",
        previousValues: details?.previousValues,
        currentValues: details?.currentValues,
        changeDetails: details?.changeDetails,
        canRestore: log.action === "SOFT_DELETE" && !!log.entityId,
      };
    });

    res.json({
      changes: formatted,
      total: formatted.length,
    });
  } catch (e) {
    next(e);
  }
});

router.get("/deleted-medicines", async (req, res, next) => {
  try {
    const medicines = await prisma.medicine.findMany({
      where: {
        deletedAt: { not: null },
      },
      include: {
        category: true,
        deletedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { deletedAt: "desc" },
    });

    const formatted = medicines.map((m) => ({
      id: m.id,
      medicineName: m.medicineName,
      genericName: m.genericName,
      dosageForm: m.dosageForm,
      category: m.category?.name,
      deletedAt: m.deletedAt,
      deletedBy: m.deletedBy
        ? `${m.deletedBy.firstName} ${m.deletedBy.lastName}`.trim() || m.deletedBy.email
        : "Unknown",
      deletedByEmail: m.deletedBy?.email,
    }));

    res.json(formatted);
  } catch (e) {
    next(e);
  }
});

router.get("/deleted-categories", async (req, res, next) => {
  try {
    const categories = await prisma.medicineCategory.findMany({
      where: {
        deletedAt: { not: null },
      },
      include: {
        _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } },
        deletedBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
      orderBy: { deletedAt: "desc" },
    });

    const formatted = categories.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      deletedAt: c.deletedAt,
      deletedBy: c.deletedBy
        ? `${c.deletedBy.firstName} ${c.deletedBy.lastName}`.trim() || c.deletedBy.email
        : "Unknown",
      deletedByEmail: c.deletedBy?.email,
      linkedMedicines: c._count.medicines,
    }));

    res.json(formatted);
  } catch (e) {
    next(e);
  }
});

router.post("/restore-medicine/:id", async (req, res, next) => {
  try {
    const medicine = await prisma.medicine.findUnique({ where: { id: req.params.id } });
    if (!medicine) {
      return res.status(404).json({ error: "Medicine not found" });
    }

    if (!medicine.deletedAt) {
      return res.status(400).json({ error: "Medicine is not deleted" });
    }

    const existing = await prisma.medicine.findFirst({
      where: {
        medicineName: { equals: medicine.medicineName, mode: "insensitive" },
        isActive: true,
        deletedAt: null,
        id: { not: medicine.id },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: "Cannot restore because an active medicine with this name already exists",
      });
    }

    const restored = await prisma.medicine.update({
      where: { id: medicine.id },
      data: {
        isActive: true,
        deletedAt: null,
        deletedById: null,
      },
      include: {
        category: true,
        strengths: { where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { strength: "asc" }] },
      },
    });

    res.json({
      message: "Medicine restored successfully",
      medicine: restored,
    });
  } catch (e) {
    next(e);
  }
});

router.post("/restore-category/:id", async (req, res, next) => {
  try {
    const category = await prisma.medicineCategory.findUnique({ where: { id: req.params.id } });
    if (!category) {
      return res.status(404).json({ error: "Category not found" });
    }

    if (!category.deletedAt) {
      return res.status(400).json({ error: "Category is not deleted" });
    }

    const existing = await prisma.medicineCategory.findFirst({
      where: {
        name: { equals: category.name, mode: "insensitive" },
        deletedAt: null,
        id: { not: category.id },
      },
    });

    if (existing) {
      return res.status(409).json({
        error: "Cannot restore because an active category with this name already exists",
      });
    }

    const restored = await prisma.medicineCategory.update({
      where: { id: category.id },
      data: {
        isActive: true,
        deletedAt: null,
        deletedById: null,
      },
      include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
    });

    res.json({
      message: "Category restored successfully",
      category: restored,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
