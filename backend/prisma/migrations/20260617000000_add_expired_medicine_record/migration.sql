-- CreateTable: ExpiredMedicineRecord
-- Records stock disposed due to expiry. Uses IF NOT EXISTS so this migration
-- is safe to apply even on databases that already have the table from db push.
CREATE TABLE IF NOT EXISTS "ExpiredMedicineRecord" (
    "id"              TEXT NOT NULL,
    "facilityId"      TEXT NOT NULL,
    "medicineId"      TEXT NOT NULL,
    "batchNumber"     TEXT NOT NULL,
    "expiryDate"      TIMESTAMP(3) NOT NULL,
    "quantity"        DOUBLE PRECISION NOT NULL,
    "disposalMethod"  TEXT NOT NULL,
    "disposalWitness" TEXT,
    "approvalStatus"  TEXT DEFAULT 'APPROVED',
    "processedById"   TEXT NOT NULL,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpiredMedicineRecord_pkey" PRIMARY KEY ("id")
);
