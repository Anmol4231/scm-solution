-- Migration: replace name-only unique on Medicine with (name, strength) composite unique.
-- Safe because the existing name-unique constraint means no two records share a name,
-- so all (name, strength) pairs are already unique in existing data.

DROP INDEX "Medicine_medicineName_key";

CREATE UNIQUE INDEX "Medicine_medicineName_strength_key" ON "Medicine"("medicineName", "strength");
