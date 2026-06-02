import { Router } from "express";
import { z } from "zod";
import { VendorOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { logAudit } from "../services/audit";
import { generateOrderCode } from "../utils/ids";
import { createShipmentForOrder } from "../services/shipment";

const router = Router();
router.use(authenticate, requireFacility);

const positiveWholeNumber = z.number().int("Quantity must be a whole number").positive("Quantity must be greater than zero");
const optionalWholeNumber = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
  z.number().int("Value must be a whole number").min(0).optional()
);

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

router.get("/sources", async (_req, res, next) => {
  try {
    const sources = await prisma.vendor.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
    res.json(sources);
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string)!;
    const orders = await prisma.stockOrder.findMany({
      where: { facilityId, deletedAt: null },
      include: {
        vendor: true,
        orderedBy: { select: { firstName: true, lastName: true } },
        lines: { include: { medicine: { include: { strengths: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(orders);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/print", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req)!;
    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, facilityId, deletedAt: null },
      include: {
        facility: true,
        vendor: true,
        orderedBy: { select: { firstName: true, lastName: true } },
        lines: { include: { medicine: { include: { strengths: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } } } } },
      },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (e) {
    next(e);
  }
});

const lineSchema = z.object({
  medicineId: z.string(),
  quantityOrdered: positiveWholeNumber,
  notes: z.string().optional(),
});

const createSchema = z.object({
  vendorId: z.string().optional(),
  priority: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  leadTimeDays: optionalWholeNumber,
  minimumOrderLevel: optionalWholeNumber,
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

async function resolveOrderSource(vendorId?: string) {
  if (vendorId) {
    return prisma.vendor.findFirst({ where: { id: vendorId, isActive: true } });
  }
  return prisma.vendor.findFirst({ where: { isActive: true }, orderBy: { name: "asc" } });
}

router.post("/", async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

    const source = await resolveOrderSource(data.vendorId);
    if (!source) return res.status(400).json({ error: "No active order source configured" });

    const count = await prisma.stockOrder.count();
    const order = await prisma.stockOrder.create({
      data: {
        orderCode: generateOrderCode(count + 1),
        facilityId,
        vendorId: source.id,
        status: VendorOrderStatus.SUBMITTED,
        priority: data.priority ?? "ROUTINE",
        expectedDeliveryDate: data.expectedDeliveryDate
          ? new Date(data.expectedDeliveryDate)
          : undefined,
        leadTimeDays: data.leadTimeDays,
        minimumOrderLevel: data.minimumOrderLevel,
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
      action: "ORDER_CREATE",
      entityType: "StockOrder",
      entityId: order.id,
      details: { orderCode: order.orderCode },
    });

    await createShipmentForOrder({
      stockOrderId: order.id,
      destinationFacilityId: facilityId,
      estimatedDeliveryDate: order.expectedDeliveryDate ?? undefined,
      userId,
    });

    res.status(201).json(order);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const data = createSchema.partial().parse(req.body);
    const facilityId = getFacilityId(req)!;
    const userId = req.user!.userId;

    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, facilityId, deletedAt: null },
      include: { lines: true },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status === VendorOrderStatus.RECEIVED || order.status === VendorOrderStatus.CANCELLED) {
      return res.status(400).json({ error: "Received or cancelled orders cannot be edited" });
    }

    const source = data.vendorId ? await resolveOrderSource(data.vendorId) : null;
    if (data.vendorId && !source) return res.status(400).json({ error: "Invalid order source" });

    const updated = await prisma.$transaction(async (tx) => {
      if (data.lines) {
        await tx.stockOrderLine.deleteMany({ where: { orderId: order.id } });
      }
      return tx.stockOrder.update({
        where: { id: order.id },
        data: {
          ...(source ? { vendorId: source.id } : {}),
          ...(data.priority !== undefined ? { priority: data.priority } : {}),
          ...(data.expectedDeliveryDate !== undefined
            ? { expectedDeliveryDate: data.expectedDeliveryDate ? new Date(data.expectedDeliveryDate) : null }
            : {}),
          ...(data.leadTimeDays !== undefined ? { leadTimeDays: data.leadTimeDays } : {}),
          ...(data.minimumOrderLevel !== undefined ? { minimumOrderLevel: data.minimumOrderLevel } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          ...(data.lines ? { lines: { create: data.lines } } : {}),
        },
        include: {
          vendor: true,
          lines: { include: { medicine: true } },
          orderedBy: { select: { firstName: true, lastName: true } },
        },
      });
    });

    await logAudit({
      facilityId,
      userId,
      action: "ORDER_UPDATE",
      entityType: "StockOrder",
      entityId: updated.id,
      details: { orderCode: updated.orderCode },
    });
    res.json(updated);
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
      where: { id: req.params.id, facilityId, deletedAt: null },
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

router.post("/:id/cancel", async (req, res, next) => {
  try {
    req.body = { status: VendorOrderStatus.CANCELLED };
    const facilityId = getFacilityId(req)!;
    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, facilityId, deletedAt: null },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const updated = await prisma.stockOrder.update({
      where: { id: order.id },
      data: { status: VendorOrderStatus.CANCELLED },
      include: { vendor: true, lines: { include: { medicine: true } } },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req)!;
    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, facilityId, deletedAt: null },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const deleted = await prisma.stockOrder.update({
      where: { id: order.id },
      data: { deletedAt: new Date(), deletedById: req.user!.userId },
      include: { vendor: true, lines: { include: { medicine: true } } },
    });
    res.json(deleted);
  } catch (e) {
    next(e);
  }
});

export default router;
