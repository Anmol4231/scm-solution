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
];
import { generateTransferCode } from "../utils/ids";
import { logAudit } from "../services/audit";
import { whatsappService } from "../whatsapp/service";
import { createAlert } from "../services/alerts";
import { AlertType, AlertSeverity } from "@prisma/client";

const router = Router();
router.use(authenticate);

const createSchema = z.object({
  toFacilityId: z.string(),
  medicineId: z.string(),
  batchId: z.string(),
  quantity: z.number().positive(),
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

    if (req.user!.role !== UserRole.PROVINCIAL_MANAGER) {
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

    res.status(201).json(transfer);
  } catch (e) {
    next(e);
  }
});

router.post("/receive", async (req, res, next) => {
  try {
    const { transferCode, quantityReceived } = z
      .object({ transferCode: z.string(), quantityReceived: z.number().positive() })
      .parse(req.body);

    const transfer = await prisma.transfer.findUnique({
      where: { transferCode },
      include: { medicine: true },
    });
    if (!transfer) return res.status(404).json({ error: "Transfer not found" });
    if (transfer.status === TransferStatus.RECEIVED) {
      return res.status(400).json({ error: "Already received" });
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
          medicineId: transfer.medicineId,
          facilityId: transfer.toFacilityId,
          batchNumber: transfer.batchNumber,
          expiryDate: transfer.expiryDate,
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
        medicineId: transfer.medicineId,
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
        medicineId: transfer.medicineId,
        batchId: transfer.batchId,
        batchNumber: transfer.batchNumber,
        expiryDate: transfer.expiryDate,
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
    const transfers = await prisma.transfer.findMany({
      where: facilityId
        ? { OR: [{ fromFacilityId: facilityId }, { toFacilityId: facilityId }] }
        : undefined,
      include: { fromFacility: true, toFacility: true, medicine: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    res.json(transfers);
  } catch (e) {
    next(e);
  }
});

export default router;
