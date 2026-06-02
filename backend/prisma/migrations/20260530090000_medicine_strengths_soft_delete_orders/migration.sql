-- Safe additive migration for SCM medicine/category/order updates.
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "leadTimeDays" INTEGER;
ALTER TABLE "Medicine" ADD COLUMN IF NOT EXISTS "minimumOrderLevel" INTEGER;
ALTER TABLE "MedicineCategory" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "MedicineCategory" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
ALTER TABLE "StockOrder" ADD COLUMN IF NOT EXISTS "leadTimeDays" INTEGER;
ALTER TABLE "StockOrder" ADD COLUMN IF NOT EXISTS "minimumOrderLevel" INTEGER;
ALTER TABLE "StockOrder" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "StockOrder" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

CREATE TABLE IF NOT EXISTS "MedicineStrength" (
  "id" TEXT NOT NULL,
  "medicineId" TEXT NOT NULL,
  "strength" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MedicineStrength_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MedicineStrength_medicineId_fkey'
  ) THEN
    ALTER TABLE "MedicineStrength"
      ADD CONSTRAINT "MedicineStrength_medicineId_fkey"
      FOREIGN KEY ("medicineId") REFERENCES "Medicine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Medicine_deletedById_fkey'
  ) THEN
    ALTER TABLE "Medicine"
      ADD CONSTRAINT "Medicine_deletedById_fkey"
      FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MedicineCategory_deletedById_fkey'
  ) THEN
    ALTER TABLE "MedicineCategory"
      ADD CONSTRAINT "MedicineCategory_deletedById_fkey"
      FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'StockOrder_deletedById_fkey'
  ) THEN
    ALTER TABLE "StockOrder"
      ADD CONSTRAINT "StockOrder_deletedById_fkey"
      FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "MedicineStrength_medicineId_strength_key"
  ON "MedicineStrength"("medicineId", "strength");
CREATE INDEX IF NOT EXISTS "MedicineStrength_strength_idx" ON "MedicineStrength"("strength");
CREATE INDEX IF NOT EXISTS "Medicine_medicineName_idx" ON "Medicine"("medicineName");
CREATE INDEX IF NOT EXISTS "Medicine_deletedAt_idx" ON "Medicine"("deletedAt");
CREATE INDEX IF NOT EXISTS "StockOrder_deletedAt_idx" ON "StockOrder"("deletedAt");

-- Backfill existing flat strength values into the new child table.
INSERT INTO "MedicineStrength" ("id", "medicineId", "strength", "sortOrder", "isActive", "createdAt", "updatedAt")
SELECT 'strength_' || md5(m."id" || ':' || trim(m."strength")), m."id", trim(m."strength"), 0, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Medicine" m
WHERE m."strength" IS NOT NULL
  AND trim(m."strength") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "MedicineStrength" s
    WHERE s."medicineId" = m."id" AND lower(s."strength") = lower(trim(m."strength"))
  );

-- Enforce active medicine name uniqueness when existing data allows it.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "Medicine"
    WHERE "deletedAt" IS NULL AND "isActive" = true
    GROUP BY lower("medicineName")
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "Medicine_active_name_unique"
      ON "Medicine"(lower("medicineName"))
      WHERE "deletedAt" IS NULL AND "isActive" = true;
  END IF;
END $$;
