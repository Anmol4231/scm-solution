import { Router } from "express";
import { z } from "zod";
import { FacilityType, Prisma, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles } from "../middleware/auth";
import { requirePermission } from "../middleware/permission";
import { logAudit } from "../services/audit";
import { masterCode, optionalPhone, optionalText, requiredText } from "../utils/validators";

const router = Router();
router.use(authenticate);

const facilityAdmins = requireRoles(
  UserRole.NURSE_ADMIN,
  UserRole.PROVINCIAL_MANAGER,
  UserRole.SUPER_ADMIN
);

// Facility types that act as supply stores — auto-synced to the Vendor table for order sources.
const STORE_TYPES: FacilityType[] = [FacilityType.WAREHOUSE, FacilityType.REGIONAL_STORE, FacilityType.AMS_CENTRAL, FacilityType.MEDICAL_STORE];

const facilitySchema = z.object({
  name: requiredText(120).refine(
    (v) => /[A-Za-z]/.test(v),
    { message: "Facility name must be alphanumeric" }
  ),
  code: masterCode,
  facilityType: z.nativeEnum(FacilityType).optional(),
  customFacilityType: optionalText(100).refine(
    (v) => !v || /[A-Za-z]/.test(v),
    { message: "Custom facility type must be alphanumeric" }
  ).optional(),
  province: optionalText(80),
  district: optionalText(80),
  address: optionalText(250),
  isActive: z.boolean().optional(),
});

/** Keep the Vendor mirror in sync for supply-type facilities so they appear in stock orders. */
async function syncVendorForFacility(facility: { code: string; name: string; address: string | null; isActive: boolean; facilityType: FacilityType | null }) {
  if (facility.facilityType && STORE_TYPES.includes(facility.facilityType)) {
    await prisma.vendor.upsert({
      where: { code: facility.code },
      create: { name: facility.name, code: facility.code, address: facility.address ?? undefined, isActive: facility.isActive },
      update: { name: facility.name, address: facility.address ?? undefined, isActive: facility.isActive },
    });
  } else {
    // Facility is no longer a supply-store type — hide the vendor mirror from order sources.
    await prisma.vendor.updateMany({ where: { code: facility.code }, data: { isActive: false } });
  }
}

/** Deactivate the Vendor mirror when a facility is deleted so it disappears from order sources. */
async function deactivateVendorForFacility(code: string) {
  await prisma.vendor.updateMany({ where: { code }, data: { isActive: false } });
}

const facilitySelect = {
  id: true,
  name: true,
  code: true,
  facilityType: true,
  customFacilityType: true,
  province: true,
  district: true,
  address: true,
  isActive: true,
  createdAt: true,
  _count: { select: { users: true } },
} satisfies Prisma.FacilitySelect;

router.get("/", facilityAdmins, requirePermission("facilities", "view"), async (req, res, next) => {
  try {
    const q = (req.query.q as string | undefined)?.trim();
    const status = req.query.status as string | undefined;
    const facilities = await prisma.facility.findMany({
      where: {
        ...(status === "active" ? { isActive: true } : status === "inactive" ? { isActive: false } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { code: { contains: q, mode: "insensitive" } },
                { district: { contains: q, mode: "insensitive" } },
                { province: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      select: facilitySelect,
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });

    // Augment with active-user counts in a single grouped query
    const activeCounts = await prisma.user.groupBy({
      by: ["facilityId"],
      where: { facilityId: { in: facilities.map((f) => f.id) }, isActive: true },
      _count: true,
    });
    const activeByFacility = Object.fromEntries(
      activeCounts.map((r) => [r.facilityId!, r._count])
    );
    const result = facilities.map((f) => ({
      ...f,
      activeUserCount: activeByFacility[f.id] ?? 0,
    }));

    res.json(result);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", facilityAdmins, requirePermission("facilities", "view"), async (req, res, next) => {
  try {
    const facility = await prisma.facility.findUnique({ where: { id: req.params.id }, select: facilitySelect });
    if (!facility) return res.status(404).json({ error: "Facility not found" });
    res.json(facility);
  } catch (e) {
    next(e);
  }
});

router.post("/", facilityAdmins, requirePermission("facilities", "create"), async (req, res, next) => {
  try {
    const parsed = facilitySchema.parse(req.body);
    const clash = await prisma.facility.findUnique({ where: { code: parsed.code } });
    if (clash) return res.status(409).json({ error: "A facility with this code already exists" });

    const facility = await prisma.facility.create({
      data: {
        name: parsed.name,
        code: parsed.code,
        facilityType: parsed.facilityType ?? FacilityType.HOSPITAL,
        customFacilityType: parsed.facilityType === FacilityType.OTHER ? (parsed.customFacilityType ?? null) : null,
        province: parsed.province ?? null,
        district: parsed.district ?? null,
        address: parsed.address ?? null,
        isActive: parsed.isActive ?? true,
      },
      select: { ...facilitySelect, facilityType: true },
    });

    await syncVendorForFacility(facility);
    await logAudit({
      facilityId: facility.id,
      userId: req.user!.userId,
      action: "CREATE",
      entityType: "Facility",
      entityId: facility.id,
      details: { name: facility.name, code: facility.code },
    });

    res.status(201).json(facility);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", facilityAdmins, requirePermission("facilities", "edit"), async (req, res, next) => {
  try {
    const parsed = facilitySchema.partial().parse(req.body);
    const facility = await prisma.facility.findUnique({ where: { id: req.params.id } });
    if (!facility) return res.status(404).json({ error: "Facility not found" });

    if (parsed.code !== undefined && parsed.code !== facility.code) {
      return res.status(400).json({ error: "Facility code cannot be changed after creation" });
    }

    const data: Prisma.FacilityUpdateInput = {};
    if (parsed.name !== undefined) data.name = parsed.name;
    if (parsed.facilityType !== undefined) {
      data.facilityType = parsed.facilityType;
      data.customFacilityType = parsed.facilityType === FacilityType.OTHER ? (parsed.customFacilityType ?? null) : null;
    } else if (parsed.customFacilityType !== undefined) {
      data.customFacilityType = parsed.customFacilityType ?? null;
    }
    if (parsed.province !== undefined) data.province = parsed.province ?? null;
    if (parsed.district !== undefined) data.district = parsed.district ?? null;
    if (parsed.address !== undefined) data.address = parsed.address ?? null;
    if (parsed.isActive !== undefined) data.isActive = parsed.isActive;

    const updated = await prisma.facility.update({ where: { id: facility.id }, data, select: { ...facilitySelect, facilityType: true } });

    await syncVendorForFacility(updated);
    await logAudit({
      facilityId: updated.id,
      userId: req.user!.userId,
      action: "UPDATE",
      entityType: "Facility",
      entityId: updated.id,
      details: { name: updated.name, code: updated.code, isActive: updated.isActive },
    });

    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", facilityAdmins, requirePermission("facilities", "delete"), async (req, res, next) => {
  try {
    const facility = await prisma.facility.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true } } },
    });
    if (!facility) return res.status(404).json({ error: "Facility not found" });
    if (facility._count.users > 0) {
      return res.status(409).json({ error: `Cannot delete: ${facility._count.users} user(s) are assigned to this facility. Reassign them first.` });
    }

    await prisma.facility.delete({ where: { id: facility.id } });
    await deactivateVendorForFacility(facility.code);

    await logAudit({
      userId: req.user!.userId,
      action: "DELETE",
      entityType: "Facility",
      entityId: facility.id,
      details: { name: facility.name, code: facility.code },
    });

    res.json({ message: "Facility deleted" });
  } catch (e) {
    next(e);
  }
});

export default router;
