import { Router } from "express";
import { z } from "zod";
import { ShipmentStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { authenticate, getFacilityId } from "../middleware/auth";
import { isCrossFacilityRole } from "../utils/roles";
import { advanceShipmentStatus, shipmentTimeline } from "../services/shipment";

const router = Router();
router.use(authenticate);

router.get("/", async (req, res, next) => {
  try {
    const facilityId = getFacilityId(req, req.query.facilityId as string);
    const status = req.query.status as ShipmentStatus | undefined;
    const q = String(req.query.q ?? "").trim();

    const where = {
      ...(status ? { status } : {}),
      ...(q ? { shipmentCode: { contains: q, mode: "insensitive" as const } } : {}),
      ...(facilityId && !isCrossFacilityRole(req.user!.role)
        ? {
            OR: [
              { destinationFacilityId: facilityId },
              { sourceFacilityId: facilityId },
            ],
          }
        : facilityId
          ? {
              OR: [
                { destinationFacilityId: facilityId },
                { sourceFacilityId: facilityId },
              ],
            }
          : {}),
    };

    const shipments = await prisma.shipment.findMany({
      where,
      include: {
        sourceFacility: { select: { id: true, name: true, code: true } },
        destinationFacility: { select: { id: true, name: true, code: true } },
        stockOrder: { select: { orderCode: true } },
        transfer: { select: { transferCode: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    const today = new Date();
    const widgets = {
      active: shipments.filter((s) => !["RECEIVED"].includes(s.status)).length,
      delayed: shipments.filter(
        (s) =>
          s.estimatedDeliveryDate &&
          s.estimatedDeliveryDate < today &&
          s.status !== ShipmentStatus.RECEIVED
      ).length,
      completed: shipments.filter((s) => s.status === ShipmentStatus.RECEIVED).length,
    };

    res.json({ shipments, widgets });
  } catch (e) {
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const shipment = await prisma.shipment.findUnique({
      where: { id: req.params.id },
      include: {
        events: { orderBy: { createdAt: "asc" } },
        sourceFacility: true,
        destinationFacility: true,
        stockOrder: { include: { vendor: true, lines: { include: { medicine: true } } } },
        transfer: { include: { medicine: true, fromFacility: true, toFacility: true } },
      },
    });
    if (!shipment) return res.status(404).json({ error: "Shipment not found" });
    res.json({
      shipment,
      timeline: shipmentTimeline(shipment.status),
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/:id/status", async (req, res, next) => {
  try {
    const { status, note } = z
      .object({
        status: z.nativeEnum(ShipmentStatus),
        note: z.string().optional(),
      })
      .parse(req.body);

    const existing = await prisma.shipment.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Shipment not found" });

    const shipment = await advanceShipmentStatus(
      existing.id,
      status,
      note,
      req.user!.userId
    );
    res.json({
      shipment,
      timeline: shipmentTimeline(shipment.status),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
