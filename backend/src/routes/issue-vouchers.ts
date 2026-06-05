import { Router } from "express";
import { z } from "zod";
import { VoucherStatus, StockTransactionType, RequisitionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate } from "../middleware/auth";
import { isCrossFacilityRole } from "../utils/roles";
import { logAudit } from "../services/audit";
import { generateVoucherCode } from "../utils/ids";

const router = Router();
router.use(authenticate);

const positiveNum = z.number().positive();

function isCrossAdmin(req: any): boolean {
  return isCrossFacilityRole(req.user!.role);
}

const includeDetail = {
  requisition: {
    include: {
      requestingFacility: { select: { id: true, name: true, code: true } },
      issuingFacility: { select: { id: true, name: true, code: true } },
      requestedBy: { select: { firstName: true, lastName: true } },
    },
  },
  finalizedBy: { select: { firstName: true, lastName: true } },
  acknowledgedBy: { select: { firstName: true, lastName: true } },
  lines: {
    include: {
      medicine: { select: { id: true, medicineName: true, genericName: true, unitType: true } },
      batch: { select: { id: true, batchNumber: true, expiryDate: true } },
    },
  },
};

// GET / — list vouchers visible to the current user
router.get("/", async (req, res, next) => {
  try {
    const qFacilityId = req.query.facilityId as string | undefined;
    const status = req.query.status as string | undefined;
    const crossAdmin = isCrossAdmin(req);
    const userFacilityId = req.user?.facilityId as string | undefined;

    const facilityFilter = crossAdmin ? qFacilityId : userFacilityId;

    const items = await prisma.issueVoucher.findMany({
      where: {
        ...(status ? { status: status as VoucherStatus } : {}),
        requisition: facilityFilter
          ? { OR: [{ requestingFacilityId: facilityFilter }, { issuingFacilityId: facilityFilter }] }
          : undefined,
      },
      include: {
        requisition: {
          select: {
            requisitionCode: true,
            requestingFacility: { select: { name: true } },
            issuingFacility: { select: { name: true } },
          },
        },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json(items);
  } catch (e) {
    next(e);
  }
});

// GET /:id
router.get("/:id", async (req, res, next) => {
  try {
    const item = await prisma.issueVoucher.findUnique({ where: { id: req.params.id }, include: includeDetail });
    if (!item) return res.status(404).json({ error: "Not found" });
    res.json(item);
  } catch (e) {
    next(e);
  }
});

// POST /from-requisition/:reqId — create DRAFT voucher from APPROVED requisition
router.post("/from-requisition/:reqId", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const userFacilityId = req.user?.facilityId as string | undefined;

    const requisition = await prisma.stockRequisition.findUnique({
      where: { id: req.params.reqId },
      include: { lines: { include: { medicine: true } }, issueVoucher: true },
    });
    if (!requisition) return res.status(404).json({ error: "Requisition not found" });
    if (requisition.status !== RequisitionStatus.APPROVED) return res.status(400).json({ error: "Requisition must be APPROVED" });
    if (requisition.issueVoucher) return res.status(400).json({ error: "Issue Voucher already exists for this requisition" });

    if (!isCrossAdmin(req) && userFacilityId !== requisition.issuingFacilityId) {
      return res.status(403).json({ error: "Only the issuing facility can create a voucher" });
    }

    const count = await prisma.issueVoucher.count();
    const voucherCode = generateVoucherCode(count + 1);

    const voucher = await prisma.issueVoucher.create({
      data: {
        voucherCode,
        requisitionId: requisition.id,
        status: VoucherStatus.DRAFT,
        lines: {
          create: requisition.lines
            .filter((l) => (l.quantityApproved ?? 0) > 0)
            .map((l) => ({
              requisitionLineId: l.id,
              medicineId: l.medicineId,
              batchNumber: "",
              expiryDate: new Date(),
              quantityIssued: l.quantityApproved ?? l.quantityRequested,
            })),
        },
      },
      include: includeDetail,
    });

    await logAudit({ facilityId: requisition.issuingFacilityId, userId, action: "VOUCHER_CREATE", entityType: "IssueVoucher", entityId: voucher.id, details: { code: voucher.voucherCode } });
    res.status(201).json(voucher);
  } catch (e) {
    next(e);
  }
});

// PATCH /:id/lines — update batch selections on DRAFT voucher lines
const updateLinesSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string(),
    batchId: z.string().optional(),
    batchNumber: z.string().min(1),
    expiryDate: z.string(),
    quantityIssued: positiveNum,
  })),
});

router.patch("/:id/lines", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const voucher = await prisma.issueVoucher.findUnique({
      where: { id: req.params.id },
      include: { requisition: true },
    });
    if (!voucher) return res.status(404).json({ error: "Not found" });
    if (voucher.status !== VoucherStatus.DRAFT) return res.status(400).json({ error: "Only DRAFT vouchers can be edited" });
    if (!isCrossAdmin(req) && req.user?.facilityId !== voucher.requisition.issuingFacilityId) {
      return res.status(403).json({ error: "Only the issuing facility can edit voucher lines" });
    }

    const data = updateLinesSchema.parse(req.body);
    await prisma.$transaction(
      data.lines.map((l) =>
        prisma.issueVoucherLine.update({
          where: { id: l.lineId },
          data: {
            batchId: l.batchId ?? null,
            batchNumber: l.batchNumber,
            expiryDate: new Date(l.expiryDate),
            quantityIssued: l.quantityIssued,
          },
        })
      )
    );

    const updated = await prisma.issueVoucher.findUnique({ where: { id: voucher.id }, include: includeDetail });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /:id/finalize — DRAFT → FINALIZED, deduct AMS stock, update requisition → ISSUED
router.post("/:id/finalize", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const voucher = await prisma.issueVoucher.findUnique({
      where: { id: req.params.id },
      include: {
        lines: true,
        requisition: { include: { lines: true } },
      },
    });
    if (!voucher) return res.status(404).json({ error: "Not found" });
    if (voucher.status !== VoucherStatus.DRAFT) return res.status(400).json({ error: "Only DRAFT vouchers can be finalized" });

    const issuingFacilityId = voucher.requisition.issuingFacilityId;
    if (!isCrossAdmin(req) && req.user?.facilityId !== issuingFacilityId) {
      return res.status(403).json({ error: "Only the issuing facility can finalize" });
    }

    // Validate all lines have batch numbers
    if (voucher.lines.some((l) => !l.batchNumber)) {
      return res.status(400).json({ error: "All lines must have a batch number before finalizing" });
    }

    await prisma.$transaction(async (tx) => {
      // 1. Deduct stock from AMS for each line
      for (const line of voucher.lines) {
        if (line.batchId) {
          const batch = await tx.stockBatch.findFirst({ where: { id: line.batchId, facilityId: issuingFacilityId } });
          if (batch && batch.quantity >= line.quantityIssued) {
            await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: { decrement: line.quantityIssued } } });
          } else if (batch) {
            // Deduct what's available
            await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: 0 } });
          }
        }
        // Stock transaction: TRANSFER_OUT at issuing facility
        await tx.stockTransaction.create({
          data: {
            facilityId: issuingFacilityId,
            medicineId: line.medicineId,
            batchId: line.batchId ?? undefined,
            type: StockTransactionType.TRANSFER_OUT,
            quantity: -line.quantityIssued,
            reason: `Issue Voucher ${voucher.voucherCode}`,
            performedById: userId,
            notes: `Issued to requisition ${voucher.requisition.requisitionCode}`,
          },
        });

        // Update stock balance on the voucher line
        const remaining = await tx.stockBatch.aggregate({
          where: { medicineId: line.medicineId, facilityId: issuingFacilityId },
          _sum: { quantity: true },
        });
        await tx.issueVoucherLine.update({
          where: { id: line.id },
          data: { stockBalanceAfter: remaining._sum.quantity ?? 0 },
        });
      }

      // 2. Update requisition lines with issued quantities
      for (const line of voucher.lines) {
        if (line.requisitionLineId) {
          await tx.requisitionLine.update({
            where: { id: line.requisitionLineId },
            data: { quantityIssued: line.quantityIssued, batchNumber: line.batchNumber, expiryDate: line.expiryDate },
          });
        }
      }

      // 3. Finalize voucher
      await tx.issueVoucher.update({
        where: { id: voucher.id },
        data: { status: VoucherStatus.FINALIZED, finalizedById: userId, finalizedAt: new Date() },
      });

      // 4. Requisition → ISSUED
      await tx.stockRequisition.update({
        where: { id: voucher.requisitionId },
        data: { status: RequisitionStatus.ISSUED, issuedById: userId, issuedAt: new Date() },
      });
    });

    await logAudit({ facilityId: issuingFacilityId, userId, action: "VOUCHER_FINALIZE", entityType: "IssueVoucher", entityId: voucher.id, details: { code: voucher.voucherCode } });
    const updated = await prisma.issueVoucher.findUnique({ where: { id: voucher.id }, include: includeDetail });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /:id/acknowledge — FINALIZED → ACKNOWLEDGED: receive stock at requesting facility
const acknowledgeSchema = z.object({
  lines: z.array(z.object({
    lineId: z.string(),
    quantityReceived: z.number().min(0),
  })),
});

router.post("/:id/acknowledge", async (req, res, next) => {
  try {
    const userId = req.user!.userId;
    const voucher = await prisma.issueVoucher.findUnique({
      where: { id: req.params.id },
      include: { lines: true, requisition: { include: { lines: true } } },
    });
    if (!voucher) return res.status(404).json({ error: "Not found" });
    if (voucher.status !== VoucherStatus.FINALIZED) return res.status(400).json({ error: "Only FINALIZED vouchers can be acknowledged" });

    const receivingFacilityId = voucher.requisition.requestingFacilityId;
    if (!isCrossAdmin(req) && req.user?.facilityId !== receivingFacilityId) {
      return res.status(403).json({ error: "Only the requesting facility can acknowledge" });
    }

    const data = acknowledgeSchema.parse(req.body);
    let anyShortfall = false;
    let allReceived = true;

    await prisma.$transaction(async (tx) => {
      for (const receipt of data.lines) {
        const voucherLine = voucher.lines.find((l) => l.id === receipt.lineId);
        if (!voucherLine || receipt.quantityReceived <= 0) { allReceived = false; continue; }

        if (receipt.quantityReceived < voucherLine.quantityIssued) {
          anyShortfall = true; allReceived = false;
        }

        // Upsert StockBatch at receiving facility
        let batch = await tx.stockBatch.findUnique({
          where: { medicineId_facilityId_batchNumber: { medicineId: voucherLine.medicineId, facilityId: receivingFacilityId, batchNumber: voucherLine.batchNumber } },
        });
        if (batch) {
          batch = await tx.stockBatch.update({ where: { id: batch.id }, data: { quantity: { increment: receipt.quantityReceived } } });
        } else {
          batch = await tx.stockBatch.create({
            data: { medicineId: voucherLine.medicineId, facilityId: receivingFacilityId, batchNumber: voucherLine.batchNumber, expiryDate: voucherLine.expiryDate, quantity: receipt.quantityReceived },
          });
        }

        // RECEIPT stock transaction at receiving facility
        const balance = await tx.stockBatch.aggregate({ where: { medicineId: voucherLine.medicineId, facilityId: receivingFacilityId }, _sum: { quantity: true } });
        await tx.stockTransaction.create({
          data: {
            facilityId: receivingFacilityId,
            medicineId: voucherLine.medicineId,
            batchId: batch.id,
            type: StockTransactionType.RECEIPT,
            quantity: receipt.quantityReceived,
            receivedQty: receipt.quantityReceived,
            requestedQty: voucherLine.quantityIssued,
            shortfallFlag: receipt.quantityReceived < voucherLine.quantityIssued,
            balanceAfter: balance._sum.quantity ?? 0,
            reason: `Issue Voucher ${voucher.voucherCode}`,
            performedById: userId,
          },
        });

        // Update requisition line
        if (voucherLine.requisitionLineId) {
          await tx.requisitionLine.update({
            where: { id: voucherLine.requisitionLineId },
            data: { quantityReceived: receipt.quantityReceived },
          });
        }
      }

      // Update voucher
      await tx.issueVoucher.update({
        where: { id: voucher.id },
        data: { status: VoucherStatus.ACKNOWLEDGED, acknowledgedById: userId, acknowledgedAt: new Date() },
      });

      // Update requisition status
      const newReqStatus = allReceived ? RequisitionStatus.RECEIVED : anyShortfall ? RequisitionStatus.PARTIALLY_RECEIVED : RequisitionStatus.RECEIVED;
      await tx.stockRequisition.update({
        where: { id: voucher.requisitionId },
        data: { status: newReqStatus, receivedById: userId, receivedAt: new Date() },
      });
    });

    await logAudit({ facilityId: receivingFacilityId, userId, action: "VOUCHER_ACKNOWLEDGE", entityType: "IssueVoucher", entityId: voucher.id });
    const updated = await prisma.issueVoucher.findUnique({ where: { id: voucher.id }, include: includeDetail });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

// POST /:id/void — FINALIZED → VOID (SUPER_ADMIN only), reverses stock
router.post("/:id/void", async (req, res, next) => {
  try {
    if (req.user!.role !== "SUPER_ADMIN") return res.status(403).json({ error: "Only SUPER_ADMIN can void a voucher" });
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);

    const voucher = await prisma.issueVoucher.findUnique({
      where: { id: req.params.id },
      include: { lines: true, requisition: true },
    });
    if (!voucher) return res.status(404).json({ error: "Not found" });
    if (voucher.status !== VoucherStatus.FINALIZED) return res.status(400).json({ error: "Only FINALIZED vouchers can be voided" });

    const userId = req.user!.userId;
    const issuingFacilityId = voucher.requisition.issuingFacilityId;

    await prisma.$transaction(async (tx) => {
      // Reverse TRANSFER_OUT: add stock back at AMS
      for (const line of voucher.lines) {
        if (line.batchId) {
          await tx.stockBatch.update({ where: { id: line.batchId }, data: { quantity: { increment: line.quantityIssued } } });
        }
        await tx.stockTransaction.create({
          data: {
            facilityId: issuingFacilityId,
            medicineId: line.medicineId,
            batchId: line.batchId ?? undefined,
            type: StockTransactionType.ADJUSTMENT,
            quantity: line.quantityIssued,
            reason: `Void of voucher ${voucher.voucherCode}: ${reason}`,
            performedById: userId,
          },
        });
      }
      await tx.issueVoucher.update({
        where: { id: voucher.id },
        data: { status: VoucherStatus.VOID, voidedById: userId, voidedAt: new Date(), voidReason: reason },
      });
      await tx.stockRequisition.update({
        where: { id: voucher.requisitionId },
        data: { status: RequisitionStatus.APPROVED },
      });
    });

    await logAudit({ facilityId: issuingFacilityId, userId, action: "VOUCHER_VOID", entityType: "IssueVoucher", entityId: voucher.id, details: { reason } });
    const updated = await prisma.issueVoucher.findUnique({ where: { id: voucher.id }, include: includeDetail });
    res.json(updated);
  } catch (e) {
    next(e);
  }
});

export default router;
