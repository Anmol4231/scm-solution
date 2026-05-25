import { Router } from "express";
import { z } from "zod";
import { VendorOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { generateOrderCode } from "../utils/ids";

const router = Router();
router.use(authenticate, requireFacility);

router.get("/vendors", async (_req, res, next) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    res.json(vendors);
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string)!;
    const orders = await prisma.stockOrder.findMany({
      where: { facilityId },
      include: {
        vendor: true,
        orderedBy: { select: { firstName: true, lastName: true } },
        lines: { include: { medicine: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(orders);
  } catch (e) {
    next(e);
  }
});

const createSchema = z.object({
  vendorId: z.string(),
  priority: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().optional(),
  lines: z
    .array(
      z.object({
        medicineId: z.string(),
        quantityOrdered: z.number().positive(),
        unitCost: z.number().optional(),
        notes: z.string().optional(),
      })
    )
    .min(1),
});

router.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

    const vendor = await prisma.vendor.findFirst({
      where: { id: data.vendorId, isActive: true },
    });
    if (!vendor) return res.status(400).json({ error: "Invalid vendor" });

    const count = await prisma.stockOrder.count();
    const order = await prisma.stockOrder.create({
      data: {
        orderCode: generateOrderCode(count + 1),
        facilityId,
        vendorId: data.vendorId,
        status: VendorOrderStatus.SUBMITTED,
        priority: data.priority ?? "ROUTINE",
        expectedDeliveryDate: data.expectedDeliveryDate
          ? new Date(data.expectedDeliveryDate)
          : undefined,
        notes: data.notes,
        orderedById: userId,
        lines: { create: data.lines },
      },
      include: {
        vendor: true,
        lines: { include: { medicine: true } },
        orderedBy: { select: { firstName: true, lastName: true } },
      },
    });

    await logAudit({
      facilityId,
      userId,
      action: "VENDOR_ORDER",
      entityType: "StockOrder",
      entityId: order.id,
      details: { orderCode: order.orderCode, vendor: vendor.name },
    });

    res.status(201).json(order);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req)!;
    const { status } = z
      .object({ status: z.nativeEnum(VendorOrderStatus) })
      .parse(req.body);

    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, facilityId },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const updated = await prisma.stockOrder.update({
      where: { id: order.id },
      data: { status },
      include: {
        vendor: true,
        lines: { include: { medicine: true } },
        orderedBy: { select: { firstName: true, lastName: true } },
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
