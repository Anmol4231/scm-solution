import { ShipmentStatus, ShipmentType } from "@prisma/client";
import { prisma } from "../lib/prisma";

const STATUS_ORDER: ShipmentStatus[] = [
  ShipmentStatus.SUBMITTED,
  ShipmentStatus.PROCESSING,
  ShipmentStatus.DISPATCHED,
  ShipmentStatus.IN_TRANSIT,
  ShipmentStatus.ARRIVED,
  ShipmentStatus.RECEIVED,
];

export function shipmentTimeline(currentStatus: ShipmentStatus) {
  const currentIdx = STATUS_ORDER.indexOf(currentStatus);
  return STATUS_ORDER.map((status, idx) => ({
    status,
    label: status.replace(/_/g, " "),
    completed: idx <= currentIdx,
    current: idx === currentIdx,
  }));
}

export async function generateShipmentCode(): Promise<string> {
  const count = await prisma.shipment.count();
  const year = new Date().getFullYear();
  return `SHP-${year}-${String(count + 1).padStart(5, "0")}`;
}

export async function createShipmentForOrder(params: {
  stockOrderId: string;
  destinationFacilityId: string;
  estimatedDeliveryDate?: Date;
  userId?: string;
}) {
  const code = await generateShipmentCode();
  return prisma.shipment.create({
    data: {
      shipmentCode: code,
      shipmentType: ShipmentType.VENDOR_ORDER,
      status: ShipmentStatus.SUBMITTED,
      stockOrderId: params.stockOrderId,
      destinationFacilityId: params.destinationFacilityId,
      estimatedDeliveryDate: params.estimatedDeliveryDate,
      events: {
        create: {
          status: ShipmentStatus.SUBMITTED,
          note: "Vendor order submitted",
          createdById: params.userId,
        },
      },
    },
    include: { events: true, destinationFacility: true },
  });
}

export async function createShipmentForTransfer(params: {
  transferId: string;
  sourceFacilityId: string;
  destinationFacilityId: string;
  userId?: string;
}) {
  const code = await generateShipmentCode();
  return prisma.shipment.create({
    data: {
      shipmentCode: code,
      shipmentType: ShipmentType.TRANSFER,
      status: ShipmentStatus.SUBMITTED,
      transferId: params.transferId,
      sourceFacilityId: params.sourceFacilityId,
      destinationFacilityId: params.destinationFacilityId,
      events: {
        create: {
          status: ShipmentStatus.SUBMITTED,
          note: "Inter-facility transfer created",
          createdById: params.userId,
        },
      },
    },
    include: { events: true, sourceFacility: true, destinationFacility: true },
  });
}

export async function advanceShipmentStatus(
  shipmentId: string,
  status: ShipmentStatus,
  note?: string,
  userId?: string
) {
  const shipment = await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      status,
      events: {
        create: { status, note, createdById: userId },
      },
    },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      sourceFacility: true,
      destinationFacility: true,
      stockOrder: true,
      transfer: true,
    },
  });

  if (status === ShipmentStatus.IN_TRANSIT && shipment.transferId) {
    await prisma.transfer.update({
      where: { id: shipment.transferId },
      data: { status: "IN_TRANSIT" },
    });
  }
  if (status === ShipmentStatus.RECEIVED && shipment.transferId) {
    await prisma.transfer.update({
      where: { id: shipment.transferId },
      data: { status: "RECEIVED", receivedAt: new Date() },
    });
  }

  return shipment;
}
