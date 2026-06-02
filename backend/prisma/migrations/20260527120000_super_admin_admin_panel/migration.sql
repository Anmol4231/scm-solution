-- CreateEnum
CREATE TYPE "FacilityType" AS ENUM ('HOSPITAL', 'CLINIC', 'PHARMACY', 'WAREHOUSE', 'REGIONAL_STORE', 'AMS_CENTRAL');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable
ALTER TABLE "Facility" ADD COLUMN "facilityType" "FacilityType" DEFAULT 'HOSPITAL';

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN "resolvedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Alert_facilityId_resolvedAt_idx" ON "Alert"("facilityId", "resolvedAt");
