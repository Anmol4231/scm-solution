import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { authenticate, requireRoles } from "../middleware/auth";
import { UserRole } from "@prisma/client";
import { logAudit } from "../services/audit";

const router = Router();
router.use(authenticate);

router.get("/", async (_req, res, next) => {
  try {
    const categories = await prisma.medicineCategory.findMany({
      where: { isActive: true },
      include: { _count: { select: { medicines: { where: { isActive: true } } } } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json(categories);
  } catch (e) {
    next(e);
  }
});

router.post(
  "/",
  requireRoles(
    UserRole.STOREKEEPER,
    UserRole.PHARMACIST,
    UserRole.NURSE_ADMIN,
    UserRole.PROVINCIAL_MANAGER
  ),
  async (req, res, next) => {
    try {
      const data = z
        .object({
          name: z.string().min(1),
          description: z.string().optional(),
          sortOrder: z.number().int().default(0),
        })
        .parse(req.body);

      const existing = await prisma.medicineCategory.findFirst({
        where: { name: { equals: data.name, mode: "insensitive" } },
      });
      if (existing) {
        return res.status(409).json({ error: "Category name already exists" });
      }

      const category = await prisma.medicineCategory.create({ data });
      await logAudit({
        facilityId: req.user!.facilityId,
        userId: req.user!.userId,
        action: "CREATE",
        entityType: "MedicineCategory",
        entityId: category.id,
        details: { name: category.name },
      });
      res.status(201).json(category);
    } catch (e) {
      next(e);
    }
  }
);

export default router;
