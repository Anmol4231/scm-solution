-- Make Patient.facilityId optional — patients are now global entities not owned by a specific facility
ALTER TABLE "Patient" ALTER COLUMN "facilityId" DROP NOT NULL;
