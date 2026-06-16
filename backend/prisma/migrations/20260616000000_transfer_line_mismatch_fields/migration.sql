-- AddColumn: mismatch tracking fields to TransferLine
ALTER TABLE "TransferLine" ADD COLUMN "mismatchReason" TEXT;
ALTER TABLE "TransferLine" ADD COLUMN "remarks" TEXT;
