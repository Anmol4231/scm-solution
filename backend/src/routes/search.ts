import { Router } from "express";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { isMasterDataAdminRole } from "../utils/roles";

const router = Router();
router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      return res.json({ patients: [], medicines: [], categories: [], staff: [], facilities: [], users: [], prescriptions: [], transfers: [], returns: [] });
    }

    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const facilityScope = facilityId ? { facilityId } : {};
    const canSeeUsers = isMasterDataAdminRole(req.user!.role);

    const [patients, medicines, categories, staff, facilities, users, prescriptions, transfers, returns] =
      await Promise.all([
        prisma.patient.findMany({
          where: {
            ...facilityScope,
            OR: [
              { patientId: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
            ],
          },
          include: { facility: { select: { name: true, code: true } } },
          take: 8,
        }),
        prisma.medicine.findMany({
          where: {
            isActive: true,
            OR: [
              { medicineName: { contains: q, mode: "insensitive" } },
              { genericName: { contains: q, mode: "insensitive" } },
            ],
          },
          take: 8,
        }),
        prisma.medicineCategory.findMany({
          where: {
            isActive: true,
            deletedAt: null,
            name: { contains: q, mode: "insensitive" },
          },
          include: { _count: { select: { medicines: { where: { isActive: true, deletedAt: null } } } } },
          take: 8,
        }),
        prisma.healthcareWorker.findMany({
          where: {
            ...facilityScope,
            OR: [
              { workerId: { contains: q, mode: "insensitive" } },
              { firstName: { contains: q, mode: "insensitive" } },
              { lastName: { contains: q, mode: "insensitive" } },
            ],
          },
          include: { facility: { select: { name: true } } },
          take: 8,
        }),
        prisma.facility.findMany({
          where: {
            isActive: true,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
            ],
          },
          take: 8,
        }),
        // Users are only searchable by master-data admins.
        canSeeUsers
          ? prisma.user.findMany({
              where: {
                OR: [
                  { firstName: { contains: q, mode: "insensitive" } },
                  { lastName: { contains: q, mode: "insensitive" } },
                  { email: { contains: q, mode: "insensitive" } },
                ],
              },
              select: { id: true, firstName: true, lastName: true, email: true, role: true },
              take: 8,
            })
          : Promise.resolve([]),
        prisma.prescription.findMany({
          where: {
            ...facilityScope,
            OR: [
              { prescriptionId: { contains: q, mode: "insensitive" } },
              { patient: { firstName: { contains: q, mode: "insensitive" } } },
              { patient: { lastName: { contains: q, mode: "insensitive" } } },
            ],
          },
          include: { patient: true, facility: { select: { name: true } } },
          take: 8,
        }),
        prisma.transfer.findMany({
          where: {
            ...(facilityId
              ? { OR: [{ fromFacilityId: facilityId }, { toFacilityId: facilityId }] }
              : {}),
            transferCode: { contains: q, mode: "insensitive" },
          },
          include: {
            fromFacility: { select: { name: true } },
            toFacility: { select: { name: true } },
            medicine: { select: { medicineName: true } },
          },
          take: 8,
        }),
        prisma.medicineReturn.findMany({
          where: {
            ...facilityScope,
            OR: [{ returnReason: { contains: q, mode: "insensitive" } }, { transferCode: { contains: q, mode: "insensitive" } }],
          },
          include: { medicine: { select: { medicineName: true } }, facility: { select: { name: true } } },
          take: 8,
        }),
      ]);

    res.json({ patients, medicines, categories, staff, facilities, users, prescriptions, transfers, returns });
  } catch (e) {
    next(e);
  }
});

export default router;
