-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'QUARANTINED', 'DISPOSED');

-- AlterTable
ALTER TABLE "StockBatch"
  ADD COLUMN "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "quarantinedAt" TIMESTAMP(3),
  ADD COLUMN "quarantineReason" TEXT,
  ADD COLUMN "disposedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "StockBatch_status_expiryDate_idx" ON "StockBatch"("status", "expiryDate");
