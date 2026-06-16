-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('SUBMITTED', 'PROCESSING', 'DISPATCHED', 'IN_TRANSIT', 'ARRIVED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "ShipmentType" AS ENUM ('VENDOR_ORDER', 'TRANSFER');

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "shipmentCode" TEXT NOT NULL,
    "shipmentType" "ShipmentType" NOT NULL,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'SUBMITTED',
    "stockOrderId" TEXT,
    "transferId" TEXT,
    "sourceFacilityId" TEXT,
    "destinationFacilityId" TEXT NOT NULL,
    "estimatedDeliveryDate" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shipmentCode_key" ON "Shipment"("shipmentCode");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_stockOrderId_key" ON "Shipment"("stockOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_transferId_key" ON "Shipment"("transferId");

-- CreateIndex
CREATE INDEX "Shipment_status_shipmentType_idx" ON "Shipment"("status", "shipmentType");

-- CreateIndex
CREATE INDEX "Shipment_destinationFacilityId_idx" ON "Shipment"("destinationFacilityId");

-- CreateIndex
CREATE INDEX "ShipmentEvent_shipmentId_createdAt_idx" ON "ShipmentEvent"("shipmentId", "createdAt");

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_stockOrderId_fkey" FOREIGN KEY ("stockOrderId") REFERENCES "StockOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_sourceFacilityId_fkey" FOREIGN KEY ("sourceFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_destinationFacilityId_fkey" FOREIGN KEY ("destinationFacilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
