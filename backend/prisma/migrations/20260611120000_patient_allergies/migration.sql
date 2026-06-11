-- Add nullable allergies field to Patient (C2: allergy visibility at dispensing)
ALTER TABLE "Patient" ADD COLUMN "allergies" TEXT;
