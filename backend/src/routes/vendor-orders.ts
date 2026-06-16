import { Router, type Request } from "express";
import { z } from "zod";
import { StockTransactionType, VendorOrderStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId, requireFacility } from "../middleware/auth";
import { requirePermission, requireAnyPermission } from "../middleware/permission";
import { logAudit } from "../services/audit";
import { generateOrderCode, generateReceiptCode } from "../utils/ids";
import { assertFutureExpiry, decrementBatchOrThrow, ValidationError } from "../utils/stockGuards";

const router = Router();
router.use(authenticate, requireFacility);

const ordersOrReceiveView = requireAnyPermission(["orders", "view"], ["receiveStock", "view"]);
const ordersCreate        = requirePermission("orders", "create");
const ordersEdit          = requirePermission("orders", "edit");
const ordersDelete        = requirePermission("orders", "delete");
const receiveCreate       = requirePermission("receiveStock", "create");
const receiveEdit         = requirePermission("receiveStock", "edit");

const positiveWholeNumber = z.number().int("Quantity must be a whole number").positive("Quantity must be greater than zero");

function orderFacilityWhere(req: Request, requestedFacilityId?: string) {
  const facilityId = getFacilityId(req, requestedFacilityId);
  return facilityId ? { facilityId } : {};
}

const receiptInclude = {
  receivedBy: { select: { id: true, firstName: true, lastName: true } },
  lastEditedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: {
    include: {
      medicine: { select: { id: true, medicineName: true } },
      batch: { select: { id: true, quantity: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
};

const orderDetailInclude = {
  facility: { select: { id: true, name: true, code: true } },
  vendor: true,
  lines: { include: { medicine: true } },
  orderedBy: { select: { id: true, firstName: true, lastName: true } },
  receipts: {
    include: receiptInclude,
    orderBy: { createdAt: "asc" as const },
  },
};

const orderListInclude = {
  facility: { select: { id: true, name: true, code: true } },
  vendor: true,
  orderedBy: { select: { id: true, firstName: true, lastName: true } },
  lines: {
    include: {
      medicine: {
        include: { strengths: { where: { isActive: true }, orderBy: { sortOrder: "asc" as const } } },
      },
    },
  },
};

router.get("/vendors", ordersOrReceiveView, async (_req, res, next) => {
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

router.get("/sources", ordersOrReceiveView, async (_req, res, next) => {
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

router.get("/", ordersOrReceiveView, async (req, res, next) => {
  try {
    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);
    const orders = await prisma.stockOrder.findMany({
      where: { ...facilityWhere, deletedAt: null },
      include: orderListInclude,
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(orders);
  } catch (e) {
    next(e);
  }
});

router.get("/received", ordersOrReceiveView, async (req, res, next) => {
  try {
    const { from, to, status: statusFilter } = req.query as Record<string, string>;
    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);

    const allowedStatuses: VendorOrderStatus[] = [VendorOrderStatus.RECEIVED, VendorOrderStatus.PARTIALLY_RECEIVED];
    const statuses: VendorOrderStatus[] = statusFilter
      ? statusFilter.split(",").filter((s): s is VendorOrderStatus => allowedStatuses.includes(s as VendorOrderStatus))
      : allowedStatuses;

    const orders = await prisma.stockOrder.findMany({
      where: {
        ...facilityWhere,
        deletedAt: null,
        status: { in: statuses.length ? statuses : allowedStatuses },
        ...(from || to
          ? {
              receipts: {
                some: {
                  createdAt: {
                    ...(from ? { gte: new Date(from) } : {}),
                    ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
                  },
                },
              },
            }
          : {}),
      },
      include: {
        facility: { select: { id: true, name: true, code: true } },
        vendor: { select: { id: true, name: true } },
        orderedBy: { select: { id: true, firstName: true, lastName: true } },
        lines: { select: { id: true, quantityOrdered: true, quantityReceived: true } },
        receipts: {
          include: {
            receivedBy: { select: { id: true, firstName: true, lastName: true } },
            lastEditedBy: { select: { id: true, firstName: true, lastName: true } },
            lines: { select: { id: true, quantityReceived: true } },
          },
          orderBy: { createdAt: "asc" as const },
        },
      },
      orderBy: { updatedAt: "desc" as const },
      take: 100,
    });
    res.json(orders);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", ordersOrReceiveView, async (req, res, next) => {
  try {
    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);
    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, ...facilityWhere, deletedAt: null },
      include: orderDetailInclude,
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/print", ordersOrReceiveView, async (req, res, next) => {
  try {
    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);
    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, ...facilityWhere, deletedAt: null },
      include: {
        facility: true,
        vendor: true,
        orderedBy: { select: { id: true, firstName: true, lastName: true } },
        lines: {
          include: {
            medicine: {
              include: { strengths: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
            },
          },
        },
        receipts: {
          include: receiptInclude,
          orderBy: { createdAt: "asc" },
        },
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
  facilityId: z.string().optional(),
  vendorId: z.string().optional(),
  notes: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

function deduplicateOrderLines<T extends { medicineId: string; quantityOrdered: number }>(lines: T[]): T[] {
  const seen = new Map<string, T>();
  for (const line of lines) {
    if (seen.has(line.medicineId)) {
      const prev = seen.get(line.medicineId)!;
      seen.set(line.medicineId, { ...prev, quantityOrdered: prev.quantityOrdered + line.quantityOrdered });
    } else {
      seen.set(line.medicineId, { ...line });
    }
  }
  return Array.from(seen.values());
}

async function resolveOrderSource(vendorId?: string) {
  if (vendorId) {
    return prisma.vendor.findFirst({ where: { id: vendorId, isActive: true } });
  }
  return prisma.vendor.findFirst({ where: { isActive: true }, orderBy: { name: "asc" } });
}

async function validateMinimumOrderLevels(lines: { medicineId: string; quantityOrdered: number }[]) {
  const medicineIds = lines.map((l) => l.medicineId);
  const medicines = await prisma.medicine.findMany({
    where: { id: { in: medicineIds } },
    select: { id: true, medicineName: true, minimumOrderLevel: true },
  });
  const medMap = new Map(medicines.map((m) => [m.id, m]));
  const errors: string[] = [];
  for (const line of lines) {
    const med = medMap.get(line.medicineId);
    if (med?.minimumOrderLevel != null && line.quantityOrdered < med.minimumOrderLevel) {
      errors.push(
        `${med.medicineName}: Quantity cannot be less than the minimum reorder level (${med.minimumOrderLevel}).`
      );
    }
  }
  return errors;
}

function computeOrderStatus(
  lines: { quantityOrdered: number; quantityReceived: number | null }[]
): VendorOrderStatus {
  const anyReceived = lines.some((l) => (l.quantityReceived ?? 0) > 0);
  const allReceived = lines.every((l) => (l.quantityReceived ?? 0) >= l.quantityOrdered);
  if (allReceived && anyReceived) return VendorOrderStatus.RECEIVED;
  if (anyReceived) return VendorOrderStatus.PARTIALLY_RECEIVED;
  return VendorOrderStatus.SUBMITTED;
}

router.post("/", ordersCreate, async (req, res, next) => {
  try {
    const rawData = createSchema.parse(req.body);
    const data = { ...rawData, lines: deduplicateOrderLines(rawData.lines) };
    const facilityId = getFacilityId(req, data.facilityId);
    const userId = req.user!.userId;
    if (!facilityId) return res.status(400).json({ error: "Facility selection required" });

    const molErrors = await validateMinimumOrderLevels(data.lines);
    if (molErrors.length) return res.status(400).json({ error: molErrors.join(" | ") });

    const source = await resolveOrderSource(data.vendorId);
    if (!source) return res.status(400).json({ error: "No active order source configured" });

    const count = await prisma.stockOrder.count();
    const order = await prisma.stockOrder.create({
      data: {
        orderCode: generateOrderCode(count + 1),
        facilityId,
        vendorId: source.id,
        status: VendorOrderStatus.SUBMITTED,
        notes: data.notes,
        orderedById: userId,
        lines: { create: data.lines },
      },
      include: orderDetailInclude,
    });

    await logAudit({
      facilityId,
      userId,
      action: "ORDER_CREATE",
      entityType: "StockOrder",
      entityId: order.id,
      details: { orderCode: order.orderCode },
    });

    res.status(201).json(order);
  } catch (e) {
    next(e);
  }
});

router.patch("/:id", ordersEdit, async (req, res, next) => {
  try {
    const data = createSchema.partial().parse(req.body);
    const facilityWhere = orderFacilityWhere(req, data.facilityId);
    const userId = req.user!.userId;

    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, ...facilityWhere, deletedAt: null },
      include: { lines: true },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status === VendorOrderStatus.RECEIVED || order.status === VendorOrderStatus.CANCELLED) {
      return res.status(400).json({ error: "Received or cancelled orders cannot be edited" });
    }

    const receiptStarted = order.lines.some((l) => (l.quantityReceived ?? 0) > 0);

    if (data.lines) {
      const medicineIds = data.lines.map((l) => l.medicineId);
      const hasDuplicates = medicineIds.length !== new Set(medicineIds).size;
      if (hasDuplicates) {
        return res.status(400).json({ error: "Duplicate medicine lines are not allowed. Each medicine must appear only once per order." });
      }

      const molErrors = await validateMinimumOrderLevels(data.lines);
      if (molErrors.length) return res.status(400).json({ error: molErrors.join(" | ") });

      if (receiptStarted) {
        const receivedLineIds = new Set(
          order.lines.filter((l) => (l.quantityReceived ?? 0) > 0).map((l) => l.medicineId)
        );
        const newMedicineIds = new Set(data.lines.map((l) => l.medicineId));
        for (const medicineId of receivedLineIds) {
          if (!newMedicineIds.has(medicineId)) {
            return res.status(400).json({
              error: "Cannot remove medicines that have already been partially received",
            });
          }
        }
        const receivedMap = new Map(order.lines.map((l) => [l.medicineId, l.quantityReceived ?? 0]));
        for (const line of data.lines) {
          const received = receivedMap.get(line.medicineId) ?? 0;
          if (line.quantityOrdered < received) {
            return res.status(400).json({
              error: `Cannot reduce ordered quantity below already received quantity (${received})`,
            });
          }
        }
      }
    }

    const source = data.vendorId ? await resolveOrderSource(data.vendorId) : null;
    if (data.vendorId && !source) return res.status(400).json({ error: "Invalid order source" });

    const updated = await prisma.$transaction(async (tx) => {
      if (data.lines) {
        if (receiptStarted) {
          const newMedicineIds = new Set(data.lines.map((l) => l.medicineId));
          for (const existing of order.lines) {
            if (!newMedicineIds.has(existing.medicineId) && (existing.quantityReceived ?? 0) === 0) {
              await tx.stockOrderLine.delete({ where: { id: existing.id } });
            }
          }
          for (const line of data.lines) {
            const existing = order.lines.find((l) => l.medicineId === line.medicineId);
            if (existing) {
              await tx.stockOrderLine.update({
                where: { id: existing.id },
                data: { quantityOrdered: line.quantityOrdered, notes: line.notes ?? null },
              });
            } else {
              await tx.stockOrderLine.create({ data: { orderId: order.id, ...line } });
            }
          }
        } else {
          await tx.stockOrderLine.deleteMany({ where: { orderId: order.id } });
          for (const line of data.lines) {
            await tx.stockOrderLine.create({ data: { orderId: order.id, ...line } });
          }
        }
      }

      return tx.stockOrder.update({
        where: { id: order.id },
        data: {
          ...(source ? { vendorId: source.id } : {}),
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
        },
        include: orderDetailInclude,
      });
    });

    await logAudit({
      facilityId: updated.facilityId,
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

function isFutureDate(dateStr: string): boolean {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return dateStr > todayStr;
}

const receiveLineSchema = z.object({
  lineId: z.string(),
  batchNumber: z.string().trim().min(1, "Batch number is required"),
  expiryDate: z
    .string()
    .trim()
    .min(1, "Expiry date is required")
    .refine(isFutureDate, { message: "Expiry date must be a future date." }),
  quantityReceived: positiveWholeNumber,
  notes: z.string().optional(),
});

router.post("/:id/receive", receiveCreate, async (req, res, next) => {
  try {
    const data = z
      .object({ lines: z.array(receiveLineSchema).min(1), notes: z.string().optional() })
      .parse(req.body);
    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);
    const userId = req.user!.userId;

    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, ...facilityWhere, deletedAt: null },
      include: {
        facility: { select: { id: true, name: true, code: true } },
        vendor: true,
        lines: { include: { medicine: true } },
      },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (order.status === VendorOrderStatus.CANCELLED) {
      return res.status(400).json({ error: "Cancelled orders cannot receive stock" });
    }
    if (order.status === VendorOrderStatus.RECEIVED) {
      return res.status(400).json({ error: "Order already fully received" });
    }

    const receiptCount = await prisma.stockReceipt.count();
    const receiptCode = generateReceiptCode(receiptCount + 1);

    const updated = await prisma.$transaction(async (tx) => {
      const receipt = await tx.stockReceipt.create({
        data: {
          receiptCode,
          orderId: order.id,
          facilityId: order.facilityId,
          receivedById: userId,
          notes: data.notes,
        },
      });

      for (const receiptLine of data.lines) {
        const line = order.lines.find((l) => l.id === receiptLine.lineId);
        if (!line) throw new Error("Order line not found");

        const alreadyReceived = line.quantityReceived ?? 0;
        if (alreadyReceived + receiptLine.quantityReceived > line.quantityOrdered) {
          throw new Error(
            `Received quantity exceeds ordered quantity for ${line.medicine.medicineName}`
          );
        }

        const expiryDate = new Date(receiptLine.expiryDate);
        let batch = await tx.stockBatch.findUnique({
          where: {
            medicineId_facilityId_batchNumber: {
              medicineId: line.medicineId,
              facilityId: order.facilityId,
              batchNumber: receiptLine.batchNumber,
            },
          },
        });

        if (batch) {
          batch = await tx.stockBatch.update({
            where: { id: batch.id },
            data: { quantity: { increment: receiptLine.quantityReceived }, expiryDate },
          });
        } else {
          batch = await tx.stockBatch.create({
            data: {
              medicineId: line.medicineId,
              facilityId: order.facilityId,
              batchNumber: receiptLine.batchNumber,
              expiryDate,
              quantity: receiptLine.quantityReceived,
              supplierSource: order.vendor.name,
            },
          });
        }

        await tx.stockReceiptLine.create({
          data: {
            receiptId: receipt.id,
            orderLineId: line.id,
            medicineId: line.medicineId,
            batchId: batch.id,
            batchNumber: receiptLine.batchNumber,
            expiryDate,
            quantityReceived: receiptLine.quantityReceived,
            notes: receiptLine.notes,
          },
        });

        await tx.stockOrderLine.update({
          where: { id: line.id },
          data: { quantityReceived: alreadyReceived + receiptLine.quantityReceived },
        });

        const balance = await tx.stockBatch.aggregate({
          _sum: { quantity: true },
          where: { medicineId: line.medicineId, facilityId: order.facilityId },
        });

        await tx.stockTransaction.create({
          data: {
            facilityId: order.facilityId,
            medicineId: line.medicineId,
            batchId: batch.id,
            type: StockTransactionType.RECEIPT,
            quantity: receiptLine.quantityReceived,
            receivedQty: receiptLine.quantityReceived,
            requestedQty: line.quantityOrdered,
            balanceAfter: balance._sum.quantity ?? 0,
            performedById: userId,
            reason: `Order ${order.orderCode} / ${receiptCode}`,
            notes: receiptLine.notes,
          },
        });
      }

      const refreshedLines = await tx.stockOrderLine.findMany({ where: { orderId: order.id } });
      const newStatus = computeOrderStatus(refreshedLines);

      return tx.stockOrder.update({
        where: { id: order.id },
        data: { status: newStatus },
        include: orderDetailInclude,
      });
    });

    await logAudit({
      facilityId: order.facilityId,
      userId,
      action: "ORDER_RECEIVE",
      entityType: "StockOrder",
      entityId: order.id,
      details: { orderCode: order.orderCode, receiptCode, lines: data.lines.length },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

const editReceiptLineSchema = z.object({
  lineId: z.string(),
  quantityReceived: z.number().int().min(0).optional(),
  batchNumber: z.string().trim().min(1).optional(),
  expiryDate: z.string().optional(),
  notes: z.string().optional().nullable(),
});

const editReceiptSchema = z.object({
  reasonForChange: z.string().trim().min(1, "Reason for change is required"),
  notes: z.string().optional().nullable(),
  lines: z.array(editReceiptLineSchema).optional(),
});

router.patch("/:id/receipts/:receiptId", receiveEdit, async (req, res, next) => {
  try {
    const data = editReceiptSchema.parse(req.body);

    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);
    const userId = req.user!.userId;

    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, ...facilityWhere, deletedAt: null },
      include: { lines: true, vendor: { select: { name: true } } },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });

    const receipt = await prisma.stockReceipt.findFirst({
      where: { id: req.params.receiptId, orderId: order.id },
      include: {
        lines: {
          include: {
            orderLine: true,
            medicine: { select: { id: true, medicineName: true } },
          },
        },
      },
    });
    if (!receipt) return res.status(404).json({ error: "Receipt not found" });

    type LineChange = {
      lineId: string;
      medicine: string;
      previous: { quantityReceived: number; batchNumber: string; expiryDate: string };
      current: { quantityReceived: number; batchNumber: string; expiryDate: string };
    };
    const lineChanges: LineChange[] = [];

    const updated = await prisma.$transaction(async (tx) => {
      if (data.lines) {
        for (const correction of data.lines) {
          const receiptLine = receipt.lines.find((l) => l.id === correction.lineId);
          if (!receiptLine) throw new ValidationError(`Receipt line ${correction.lineId} not found`);

          const oldQty = receiptLine.quantityReceived;
          const newQty = correction.quantityReceived ?? oldQty;
          const oldBatchNumber = receiptLine.batchNumber;
          const newBatchNumber = correction.batchNumber ?? oldBatchNumber;
          const oldExpiryDate = receiptLine.expiryDate instanceof Date
            ? receiptLine.expiryDate
            : new Date(receiptLine.expiryDate);
          const newExpiryDate = correction.expiryDate ? new Date(correction.expiryDate) : oldExpiryDate;

          // A corrected expiry date must still be a valid future date — a receipt
          // edit can never backdate stock into an expired state.
          if (correction.expiryDate) {
            assertFutureExpiry(newExpiryDate, `${receiptLine.medicine.medicineName} (batch ${newBatchNumber})`);
          }

          const batchChanged = newBatchNumber !== oldBatchNumber;

          if (newQty !== oldQty || batchChanged) {
            const otherTotal = await tx.stockReceiptLine.aggregate({
              _sum: { quantityReceived: true },
              where: { orderLineId: receiptLine.orderLineId, id: { not: receiptLine.id } },
            });
            const sumOthers = otherTotal._sum.quantityReceived ?? 0;
            if (sumOthers + newQty > receiptLine.orderLine.quantityOrdered) {
              throw new ValidationError(
                `Corrected quantity exceeds ordered quantity for ${receiptLine.medicine.medicineName}`
              );
            }
          }

          if (batchChanged) {
            const currentOldBatch = await tx.stockBatch.findUnique({ where: { id: receiptLine.batchId } });
            if (!currentOldBatch || currentOldBatch.quantity < oldQty) {
              const available = currentOldBatch?.quantity ?? 0;
              const consumed = oldQty - available;
              throw new ValidationError(
                `Cannot change batch for "${receiptLine.medicine.medicineName}" — ${consumed} of ${oldQty} received units have already been consumed or transferred from batch "${oldBatchNumber}" (${available} units remain). Correct the quantity to ${available} first, then change the batch.`
              );
            }

            await decrementBatchOrThrow(tx, receiptLine.batchId, oldQty, `${receiptLine.medicine.medicineName} (batch ${oldBatchNumber})`);
            const balAfterRemove = await tx.stockBatch.aggregate({
              _sum: { quantity: true },
              where: { medicineId: receiptLine.medicineId, facilityId: order.facilityId },
            });
            await tx.stockTransaction.create({
              data: {
                facilityId: order.facilityId,
                medicineId: receiptLine.medicineId,
                batchId: receiptLine.batchId,
                type: StockTransactionType.ADJUSTMENT,
                quantity: -oldQty,
                balanceAfter: balAfterRemove._sum.quantity ?? 0,
                performedById: userId,
                reason: `Receipt edit (batch change) ${receipt.receiptCode}`,
                notes: data.reasonForChange,
              },
            });

            let newBatch = await tx.stockBatch.findUnique({
              where: {
                medicineId_facilityId_batchNumber: {
                  medicineId: receiptLine.medicineId,
                  facilityId: order.facilityId,
                  batchNumber: newBatchNumber,
                },
              },
            });
            if (newBatch) {
              newBatch = await tx.stockBatch.update({
                where: { id: newBatch.id },
                data: { quantity: { increment: newQty }, expiryDate: newExpiryDate },
              });
            } else {
              newBatch = await tx.stockBatch.create({
                data: {
                  medicineId: receiptLine.medicineId,
                  facilityId: order.facilityId,
                  batchNumber: newBatchNumber,
                  expiryDate: newExpiryDate,
                  quantity: newQty,
                  supplierSource: order.vendor?.name,
                },
              });
            }
            const balAfterAdd = await tx.stockBatch.aggregate({
              _sum: { quantity: true },
              where: { medicineId: receiptLine.medicineId, facilityId: order.facilityId },
            });
            await tx.stockTransaction.create({
              data: {
                facilityId: order.facilityId,
                medicineId: receiptLine.medicineId,
                batchId: newBatch.id,
                type: StockTransactionType.ADJUSTMENT,
                quantity: newQty,
                balanceAfter: balAfterAdd._sum.quantity ?? 0,
                performedById: userId,
                reason: `Receipt edit (batch change) ${receipt.receiptCode}`,
                notes: data.reasonForChange,
              },
            });

            await tx.stockReceiptLine.update({
              where: { id: receiptLine.id },
              data: {
                batchId: newBatch.id,
                batchNumber: newBatchNumber,
                expiryDate: newExpiryDate,
                quantityReceived: newQty,
                ...(correction.notes !== undefined ? { notes: correction.notes } : {}),
              },
            });
          } else {
            const diff = newQty - oldQty;
            if (diff !== 0) {
              const currentBatch = await tx.stockBatch.findUnique({ where: { id: receiptLine.batchId } });
              if ((currentBatch?.quantity ?? 0) + diff < 0) {
                const available = currentBatch?.quantity ?? 0;
                const consumed = oldQty - available;
                const minCorrectable = Math.max(0, oldQty - available);
                throw new ValidationError(
                  `Cannot reduce received quantity for "${receiptLine.medicine.medicineName}" below ${minCorrectable} — ${consumed} unit${consumed !== 1 ? "s" : ""} have already been dispensed or transferred from this batch (${available} remain in stock).`
                );
              }
              if (diff < 0) {
                // Reduction — conditional decrement backstops the friendly check above
                // so a correction can never drive the batch negative.
                await decrementBatchOrThrow(tx, receiptLine.batchId, -diff, `${receiptLine.medicine.medicineName} (batch ${oldBatchNumber})`);
              } else {
                await tx.stockBatch.update({
                  where: { id: receiptLine.batchId },
                  data: { quantity: { increment: diff } },
                });
              }
              const bal = await tx.stockBatch.aggregate({
                _sum: { quantity: true },
                where: { medicineId: receiptLine.medicineId, facilityId: order.facilityId },
              });
              await tx.stockTransaction.create({
                data: {
                  facilityId: order.facilityId,
                  medicineId: receiptLine.medicineId,
                  batchId: receiptLine.batchId,
                  type: StockTransactionType.ADJUSTMENT,
                  quantity: diff,
                  balanceAfter: bal._sum.quantity ?? 0,
                  performedById: userId,
                  reason: `Receipt edit: ${receipt.receiptCode}`,
                  notes: data.reasonForChange,
                },
              });
            }

            const expiryChanged = newExpiryDate.getTime() !== oldExpiryDate.getTime();
            if (expiryChanged) {
              await tx.stockBatch.update({
                where: { id: receiptLine.batchId },
                data: { expiryDate: newExpiryDate },
              });
            }

            await tx.stockReceiptLine.update({
              where: { id: receiptLine.id },
              data: {
                quantityReceived: newQty,
                expiryDate: newExpiryDate,
                ...(correction.notes !== undefined ? { notes: correction.notes } : {}),
              },
            });
          }

          // Recalculate order line total
          const total = await tx.stockReceiptLine.aggregate({
            _sum: { quantityReceived: true },
            where: { orderLineId: receiptLine.orderLineId },
          });
          await tx.stockOrderLine.update({
            where: { id: receiptLine.orderLineId },
            data: { quantityReceived: total._sum.quantityReceived ?? 0 },
          });

          lineChanges.push({
            lineId: receiptLine.id,
            medicine: receiptLine.medicine.medicineName,
            previous: {
              quantityReceived: oldQty,
              batchNumber: oldBatchNumber,
              expiryDate: oldExpiryDate.toISOString(),
            },
            current: {
              quantityReceived: newQty,
              batchNumber: newBatchNumber,
              expiryDate: newExpiryDate.toISOString(),
            },
          });
        }
      }

      await tx.stockReceipt.update({
        where: { id: receipt.id },
        data: {
          ...(data.notes !== undefined ? { notes: data.notes } : {}),
          lastEditedById: userId,
          lastEditedAt: new Date(),
          lastEditReason: data.reasonForChange,
        },
      });

      const refreshedLines = await tx.stockOrderLine.findMany({ where: { orderId: order.id } });
      const newStatus = computeOrderStatus(refreshedLines);

      return tx.stockOrder.update({
        where: { id: order.id },
        data: { status: newStatus },
        include: orderDetailInclude,
      });
    });

    await logAudit({
      facilityId: order.facilityId,
      userId,
      action: "RECEIPT_UPDATE",
      entityType: "StockReceipt",
      entityId: receipt.id,
      details: {
        orderCode: order.orderCode,
        receiptCode: receipt.receiptCode,
        reasonForChange: data.reasonForChange,
        changes: lineChanges,
      },
    });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

router.get("/:id/receipts/:receiptId/history", ordersOrReceiveView, async (req, res, next) => {
  try {
    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);
    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, ...facilityWhere, deletedAt: null },
    });
    if (!order) return res.status(404).json({ error: "Order not found" });
    const receipt = await prisma.stockReceipt.findFirst({
      where: { id: req.params.receiptId, orderId: order.id },
    });
    if (!receipt) return res.status(404).json({ error: "Receipt not found" });
    const history = await prisma.auditLog.findMany({
      where: { entityType: "StockReceipt", entityId: receipt.id },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "desc" },
    });
    res.json(history);
  } catch (e) {
    next(e);
  }
});

router.post("/:id/cancel", ordersEdit, async (req, res, next) => {
  try {
    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);
    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, ...facilityWhere, deletedAt: null },
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

router.delete("/:id", ordersDelete, async (req, res, next) => {
  try {
    const facilityWhere = orderFacilityWhere(req, req.query.facilityId as string | undefined);
    const order = await prisma.stockOrder.findFirst({
      where: { id: req.params.id, ...facilityWhere, deletedAt: null },
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
