import { Router } from "express";
import { z } from "zod";
import { TransferStatus, StockTransactionType } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { UserRole } from "@prisma/client";

const TRANSFER_CREATOR_ROLES: UserRole[] = [
  UserRole.PHARMACIST,
  UserRole.STOREKEEPER,
  UserRole.NURSE_ADMIN,
  UserRole.PROVINCIAL_MANAGER,
  UserRole.SUPER_ADMIN,
];
import { generateTransferCode } from "../utils/ids";
import { logAudit } from "../services/audit";
import { whatsappService } from "../whatsapp/service";
import { createAlert } from "../services/alerts";
import { AlertType, AlertSeverity } from "@prisma/client";
import { createShipmentForTransfer } from "../services/shipment";

const router = Router();
router.use(authenticate);

const positiveWholeNumber = z.number().int("Quantity must be a whole number").positive("Quantity must be greater than zero");

const createSchema = z.object({
  toFacilityId: z.string(),
  medicineId: z.string(),
  batchId: z.string(),
  quantity: positiveWholeNumber,
  authorizationNotes: z.string().optional(),
});

router.post("/", async (req, res, next) => {
  try {
    if (!TRANSFER_CREATOR_ROLES.includes(req.user!.role)) {
      return res.status(403).json({ error: "Insufficient permissions to create transfers" });
    }

    const data = createSchema.parse(req.body);
    const batch = await prisma.stockBatch.findUnique({
      where: { id: data.batchId },
      include: { facility: true, medicine: true },
    });
    if (!batch || batch.quantity < data.quantity) {
      return res.status(400).json({ error: "Invalid batch or insufficient quantity" });
    }

    if (data.toFacilityId === batch.facilityId) {
      return res.status(400).json({ error: "Receiving facility must differ from sending facility" });
    }

    if (req.user!.role !== UserRole.PROVINCIAL_MANAGER && req.user!.role !== UserRole.SUPER_ADMIN) {
      if (!req.user!.facilityId) {
        return res.status(400).json({ error: "Facility selection required" });
      }
      if (batch.facilityId !== req.user!.facilityId) {
        return res.status(403).json({ error: "You can only transfer stock from your own facility" });
      }
    }

    await prisma.stockBatch.update({
      where: { id: batch.id },
      data: { quantity: { decrement: data.quantity } },
    });

    const transfer = await prisma.transfer.create({
      data: {
        transferCode: generateTransferCode(),
        fromFacilityId: batch.facilityId,
        toFacilityId: data.toFacilityId,
        medicineId: data.medicineId,
        batchId: batch.id,
        batchNumber: batch.batchNumber,
        expiryDate: batch.expiryDate,
        quantity: data.quantity,
        authorizationNotes: data.authorizationNotes,
        createdById: req.user!.userId,
      },
      include: { fromFacility: true, toFacility: true, medicine: true },
    });

    await prisma.stockTransaction.create({
      data: {
        facilityId: batch.facilityId,
        medicineId: data.medicineId,
        batchId: batch.id,
        type: StockTransactionType.TRANSFER_OUT,
        quantity: -data.quantity,
        transferId: transfer.id,
        performedById: req.user!.userId,
      },
    });

    await createAlert({
      facilityId: data.toFacilityId,
      type: AlertType.TRANSFER_PENDING,
      severity: AlertSeverity.INFO,
      title: "Incoming transfer",
      message: `Transfer ${transfer.transferCode}: ${batch.batchNumber} qty ${data.quantity}`,
    });

    await whatsappService.sendToFacilityPhones(
      data.toFacilityId,
      `Transfer ${transfer.transferCode} incoming. Confirm receipt in SCM Solution.`
    );

    await createShipmentForTransfer({
      transferId: transfer.id,
      sourceFacilityId: batch.facilityId,
      destinationFacilityId: data.toFacilityId,
      userId: req.user!.userId,
    });

    res.status(201).json(transfer);
  } catch (e) {
    next(e);
  }
});

router.post("/receive", async (req, res, next) => {
  try {
    const { transferCode, quantityReceived } = z
      .object({ transferCode: z.string(), quantityReceived: positiveWholeNumber })
      .parse(req.body);

    const transfer = await prisma.transfer.findUnique({
      where: { transferCode },
      include: { medicine: true },
    });
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (transfer.status === TransferStatus.RECEIVED) {
      return res.status(400).json({ error: "Already received" });
    }
    // Legacy endpoint only handles single-item transfers
    if (!transfer.medicineId || !transfer.batchNumber || !transfer.expiryDate) {
      return res.status(400).json({ error: "Use /receive-multi for multi-line transfers" });
    }

    const facilityId = getFacilityId(req, undefined);
    if (facilityId && facilityId !== transfer.toFacilityId) {
      return res.status(403).json({ error: "Wrong receiving facility" });
    }

    let batch = await prisma.stockBatch.findUnique({
      where: {
        medicineId_facilityId_batchNumber: {
          medicineId: transfer.medicineId,
          facilityId: transfer.toFacilityId,
          batchNumber: transfer.batchNumber,
        },
      },
    });

    if (batch) {
      batch = await prisma.stockBatch.update({
        where: { id: batch.id },
        data: { quantity: { increment: quantityReceived } },
      });
    } else {
      batch = await prisma.stockBatch.create({
        data: {
          medicineId: transfer.medicineId!,
          facilityId: transfer.toFacilityId,
          batchNumber: transfer.batchNumber!,
          expiryDate: transfer.expiryDate!,
          quantity: quantityReceived,
        },
      });
    }

    const updated = await prisma.transfer.update({
      where: { id: transfer.id },
      data: {
        status: TransferStatus.RECEIVED,
        quantityReceived,
        receivedById: req.user!.userId,
        receivedAt: new Date(),
      },
    });

    await prisma.stockTransaction.create({
      data: {
        facilityId: transfer.toFacilityId,
        medicineId: transfer.medicineId!,
        batchId: batch.id,
        type: StockTransactionType.TRANSFER_IN,
        quantity: quantityReceived,
        transferId: transfer.id,
        performedById: req.user!.userId,
      },
    });

    await prisma.medicineReturn.create({
      data: {
        returnType: "INTER_FACILITY",
        facilityId: transfer.fromFacilityId,
        medicineId: transfer.medicineId!,
        batchId: transfer.batchId ?? undefined,
        batchNumber: transfer.batchNumber!,
        expiryDate: transfer.expiryDate!,
        quantity: quantityReceived,
        returnReason: "Inter-facility transfer received",
        transferCode: transfer.transferCode,
        receivingFacilityId: transfer.toFacilityId,
        reusable: true,
        stockAdjusted: true,
        processedById: req.user!.userId,
      },
    });

    await logAudit({
      facilityId: transfer.toFacilityId,
      userId: req.user!.userId,
      action: "TRANSFER_RECEIVE",
      entityType: "Transfer",
      entityId: transfer.id,
    });

    res.json({ transfer: updated, batch });
  } catch (e) {
    next(e);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const status = req.query.status as string | undefined;
    const transfers = await prisma.transfer.findMany({
      where: {
        ...(facilityId ? { OR: [{ fromFacilityId: facilityId }, { toFacilityId: facilityId }] } : {}),
        ...(status ? { status: status as TransferStatus } : {}),
      },
      include: {
        fromFacility: { select: { id: true, name: true, code: true } },
        toFacility: { select: { id: true, name: true, code: true } },
        medicine: { select: { id: true, medicineName: true } },
        lines: { include: { medicine: { select: { id: true, medicineName: true } }, batch: { select: { batchNumber: true, expiryDate: true } } } },
        createdBy: { select: { firstName: true, lastName: true } },
        authorizedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(transfers);
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const transfer = await prisma.transfer.findUnique({
      where: { id: req.params.id },
      include: {
        fromFacility: true, toFacility: true,
        medicine: true, batch: true,
        lines: { include: { medicine: true, batch: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        authorizedBy: { select: { firstName: true, lastName: true } },
        receivedBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!transfer) return res.status(404).json({ error: "Not found" });
    res.json(transfer);
  } catch (e) {
    next(e);
  }
});

// POST /transfers/new — create multi-line transfer (PENDING, no stock movement)
const newTransferSchema = z.object({
  fromFacilityId: z.string().optional(),
  toFacilityId: z.string(),
  priority: z.enum(["ROUTINE", "URGENT", "EMERGENCY"]).default("ROUTINE"),
  authorizationNotes: z.string().optional(),
  lines: z.array(z.object({
    batchId: z.string(),
    quantityTransferred: positiveWholeNumber,
  })).min(1),
});

router.post("/new", async (req, res, next) => {
  try {
    const data = newTransferSchema.parse(req.body);
    const userId = req.user!.userId;
    const isCrossAdminUser = req.user!.role === UserRole.PROVINCIAL_MANAGER || req.user!.role === UserRole.SUPER_ADMIN;

    const effectiveFromFacilityId = (isCrossAdminUser && data.fromFacilityId)
      ? data.fromFacilityId
      : req.user!.facilityId;
    if (!effectiveFromFacilityId) return res.status(400).json({ error: "From-facility required" });
    if (effectiveFromFacilityId === data.toFacilityId) return res.status(400).json({ error: "From and to facility must differ" });

    // Validate all batches belong to the from-facility and have sufficient stock
    const batchIds = data.lines.map((l) => l.batchId);
    const batches = await prisma.stockBatch.findMany({
      where: { id: { in: batchIds }, facilityId: effectiveFromFacilityId },
      include: { medicine: true },
    });
    if (batches.length !== data.lines.length) return res.status(400).json({ error: "One or more batches not found at the sending facility" });

    for (const line of data.lines) {
      const batch = batches.find((b) => b.id === line.batchId);
      if (!batch) return res.status(400).json({ error: "Batch not found" });
      if (batch.quantity < line.quantityTransferred) return res.status(400).json({ error: `Insufficient stock in batch ${batch.batchNumber}` });
    }

    const transfer = await prisma.transfer.create({
      data: {
        transferCode: generateTransferCode(),
        fromFacilityId: effectiveFromFacilityId,
        toFacilityId: data.toFacilityId,
        status: TransferStatus.PENDING,
        priority: data.priority,
        authorizationNotes: data.authorizationNotes,
        createdById: userId,
        lines: {
          create: data.lines.map((l) => {
            const batch = batches.find((b) => b.id === l.batchId)!;
            return {
              medicineId: batch.medicineId,
              batchId: batch.id,
              batchNumber: batch.batchNumber,
              expiryDate: batch.expiryDate,
              quantityTransferred: l.quantityTransferred,
            };
          }),
        },
      },
      include: {
        fromFacility: true, toFacility: true,
        lines: { include: { medicine: true, batch: true } },
      },
    });

    await logAudit({ facilityId: effectiveFromFacilityId, userId, action: "TRANSFER_CREATE", entityType: "Transfer", entityId: transfer.id, details: { code: transfer.transferCode } });
    res.status(201).json(transfer);
  } catch (e) {
    next(e);
  }
});

// POST /transfers/:id/authorize — PENDING → AUTHORIZED
router.post("/:id/authorize", async (req, res, next) => {
  try {
    const transfer = await prisma.transfer.findUnique({ where: { id: req.params.id } });
    if (!transfer) return res.status(404).json({ error: "Not found" });
    if (transfer.status !== TransferStatus.PENDING) return res.status(400).json({ error: "Only PENDING transfers can be authorized" });

    const userId = req.user!.userId;
    const isCrossAdmin = req.user!.role === UserRole.PROVINCIAL_MANAGER || req.user!.role === UserRole.SUPER_ADMIN;
    const userFacilityId = req.user!.facilityId;
    if (!isCrossAdmin && userFacilityId !== transfer.fromFacilityId) {
      return res.status(403).json({ error: "Only the sending facility or admin can authorize" });
    }

    const updated = await prisma.transfer.update({
      where: { id: transfer.id },
      data: { status: TransferStatus.AUTHORIZED, authorizedById: userId, authorizedAt: new Date() },
    });
    await logAudit({ facilityId: transfer.fromFacilityId, userId, action: "TRANSFER_AUTHORIZE", entityType: "Transfer", entityId: transfer.id });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /transfers/:id/dispatch — AUTHORIZED → IN_TRANSIT, deduct stock
router.post("/:id/dispatch", async (req, res, next) => {
  try {
    const transfer = await prisma.transfer.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!transfer) return res.status(404).json({ error: "Not found" });
    if (transfer.status !== TransferStatus.AUTHORIZED) return res.status(400).json({ error: "Transfer must be AUTHORIZED before dispatch" });

    const userId = req.user!.userId;
    const userFacilityId = req.user!.facilityId;
    const isCrossAdmin = req.user!.role === UserRole.PROVINCIAL_MANAGER || req.user!.role === UserRole.SUPER_ADMIN;
    if (!isCrossAdmin && userFacilityId !== transfer.fromFacilityId) {
      return res.status(403).json({ error: "Only the sending facility can dispatch" });
    }

    await prisma.$transaction(async (tx) => {
      for (const line of transfer.lines) {
        const batch = await tx.stockBatch.findUnique({ where: { id: line.batchId } });
        if (!batch || batch.quantity < line.quantityTransferred) throw new Error(`Insufficient stock in batch ${line.batchNumber} at time of dispatch`);
        await tx.stockBatch.update({ where: { id: line.batchId }, data: { quantity: { decrement: line.quantityTransferred } } });
        await tx.stockTransaction.create({
          data: {
            facilityId: transfer.fromFacilityId,
            medicineId: line.medicineId,
            batchId: line.batchId,
            type: StockTransactionType.TRANSFER_OUT,
            quantity: -line.quantityTransferred,
            transferId: transfer.id,
            performedById: userId,
            reason: `Transfer ${transfer.transferCode}`,
          },
        });
      }
      await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: TransferStatus.IN_TRANSIT, dispatchedAt: new Date() },
      });
    });

    await logAudit({ facilityId: transfer.fromFacilityId, userId, action: "TRANSFER_DISPATCH", entityType: "Transfer", entityId: transfer.id });
    const updated = await prisma.transfer.findUnique({ where: { id: transfer.id }, include: { lines: { include: { medicine: true } }, fromFacility: true, toFacility: true } });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /transfers/:id/receive-multi — IN_TRANSIT → RECEIVED/PARTIALLY_RECEIVED, credit stock
const receiveMultiSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string(),
    quantityReceived: z.number().min(0),
  })),
});

router.post("/:id/receive-multi", async (req, res, next) => {
  try {
    const transfer = await prisma.transfer.findUnique({ where: { id: req.params.id }, include: { lines: true } });
    if (!transfer) return res.status(404).json({ error: "Not found" });
    if (transfer.status !== TransferStatus.IN_TRANSIT) return res.status(400).json({ error: "Transfer must be IN_TRANSIT to receive" });

    const userId = req.user!.userId;
    const userFacilityId = req.user!.facilityId;
    const isCrossAdmin = req.user!.role === UserRole.PROVINCIAL_MANAGER || req.user!.role === UserRole.SUPER_ADMIN;
    if (!isCrossAdmin && userFacilityId !== transfer.toFacilityId) {
      return res.status(403).json({ error: "Only the receiving facility can confirm receipt" });
    }

    const data = receiveMultiSchema.parse(req.body);
    let anyShortfall = false;
    let allReceived = true;

    await prisma.$transaction(async (tx) => {
      for (const receipt of data.lines) {
        const line = transfer.lines.find((l) => l.id === receipt.lineId);
        if (!line || receipt.quantityReceived <= 0) { allReceived = false; continue; }
        if (receipt.quantityReceived < line.quantityTransferred) { anyShortfall = true; allReceived = false; }

        let batch = await tx.stockBatch.findUnique({
          where: { medicineId_facilityId_batchNumber: { medicineId: line.medicineId, facilityId: transfer.toFacilityId, batchNumber: line.batchNumber } },
        });
        if (batch) {
          batch = await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: { increment: receipt.quantityReceived } } });
        } else {
          batch = await tx.stockBatch.create({
            data: { medicineId: line.medicineId, facilityId: transfer.toFacilityId, batchNumber: line.batchNumber, expiryDate: line.expiryDate, quantity: receipt.quantityReceived },
          });
        }

        await tx.stockTransaction.create({
          data: {
            facilityId: transfer.toFacilityId,
            medicineId: line.medicineId,
            batchId: batch.id,
            type: StockTransactionType.TRANSFER_IN,
            quantity: receipt.quantityReceived,
            transferId: transfer.id,
            performedById: userId,
            reason: `Transfer ${transfer.transferCode}`,
          },
        });

        await tx.transferLine.update({ where: { id: line.id }, data: { quantityReceived: receipt.quantityReceived, shortfallFlag: receipt.quantityReceived < line.quantityTransferred } });
      }

      const newStatus = allReceived ? TransferStatus.RECEIVED : anyShortfall ? TransferStatus.PARTIALLY_RECEIVED : TransferStatus.RECEIVED;
      await tx.transfer.update({
        where: { id: transfer.id },
        data: { status: newStatus, receivedById: userId, receivedAt: new Date() },
      });
    });

    await logAudit({ facilityId: transfer.toFacilityId, userId, action: "TRANSFER_RECEIVE", entityType: "Transfer", entityId: transfer.id });
    const updated = await prisma.transfer.findUnique({ where: { id: transfer.id }, include: { lines: { include: { medicine: true } }, fromFacility: true, toFacility: true } });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /transfers/:id/cancel — PENDING|AUTHORIZED → CANCELLED
router.post("/:id/cancel", async (req, res, next) => {
  try {
    const transfer = await prisma.transfer.findUnique({ where: { id: req.params.id } });
    if (!transfer) return res.status(404).json({ error: "Not found" });
    const cancellable: TransferStatus[] = [TransferStatus.PENDING, TransferStatus.AUTHORIZED];
    if (!cancellable.includes(transfer.status)) return res.status(400).json({ error: "Only PENDING or AUTHORIZED transfers can be cancelled" });

    const userId = req.user!.userId;
    const isCrossAdmin = req.user!.role === UserRole.PROVINCIAL_MANAGER || req.user!.role === UserRole.SUPER_ADMIN;
    if (!isCrossAdmin && req.user!.facilityId !== transfer.fromFacilityId) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    const updated = await prisma.transfer.update({ where: { id: transfer.id }, data: { status: TransferStatus.CANCELLED } });
    await logAudit({ facilityId: transfer.fromFacilityId, userId, action: "TRANSFER_CANCEL", entityType: "Transfer", entityId: transfer.id });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
