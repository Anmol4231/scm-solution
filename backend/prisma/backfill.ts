/**
 * Non-destructive production backfill for the Role Master / password-policy release.
 *
 * Safe to run against a live database: it only UPSERTs the two system roles and
 * UPDATEs users that are missing the new fields. It NEVER deletes anything and is
 * idempotent (safe to re-run). Use this instead of `prisma/seed.ts` in production.
 *
 *   NODE_ENV=production npm run db:backfill
 */
import { PrismaClient, UserRole } from "@prisma/client";
import { fullAccessMatrix, pharmacistMatrix } from "../src/utils/permissionMatrix";

const prisma = new PrismaClient();
const ADMIN_TIER: UserRole[] = [UserRole.NURSE_ADMIN, UserRole.PROVINCIAL_MANAGER, UserRole.SUPER_ADMIN];

async function main() {
  // 1. System roles (idempotent upsert by code) — no deletes.
  const adminRole = await prisma.role.upsert({
    where: { code: "ADMIN" },
    update: { permissions: fullAccessMatrix() as object, scopeAllFacilities: true, isActive: true, isSystem: true },
    create: {
      name: "Administrator",
      code: "ADMIN",
      description: "Full system access across all facilities.",
      isSystem: true,
      isActive: true,
      scopeAllFacilities: true,
      permissions: fullAccessMatrix() as object,
    },
  });
  const pharmacistRole = await prisma.role.upsert({
    where: { code: "PHARMACIST" },
    update: { permissions: pharmacistMatrix() as object, isActive: true, isSystem: true },
    create: {
      name: "Pharmacist",
      code: "PHARMACIST",
      description: "Facility-level operational access (stock, dispensing, patients).",
      isSystem: true,
      isActive: true,
      scopeAllFacilities: false,
      permissions: pharmacistMatrix() as object,
    },
  });

  // 2. Assign a roleId to any user missing one (by enum tier). No deletes.
  const usersMissingRole = await prisma.user.findMany({ where: { roleId: null }, select: { id: true, role: true } });
  for (const u of usersMissingRole) {
    await prisma.user.update({
      where: { id: u.id },
      data: { roleId: ADMIN_TIER.includes(u.role) ? adminRole.id : pharmacistRole.id },
    });
  }

  // 3. Stamp passwordChangedAt where missing so expiry does not trigger immediately.
  const stamped = await prisma.user.updateMany({
    where: { passwordChangedAt: null },
    data: { passwordChangedAt: new Date() },
  });

  console.log(
    `Backfill complete (non-destructive): roles upserted; assigned roleId to ${usersMissingRole.length} user(s); stamped passwordChangedAt on ${stamped.count}.`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
