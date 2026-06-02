import { UserRole } from "@prisma/client";

/** Roles with cross-facility visibility (all locations). */
export const CROSS_FACILITY_ROLES: UserRole[] = [
  UserRole.PROVINCIAL_MANAGER,
  UserRole.SUPER_ADMIN,
];

export function isCrossFacilityRole(role: UserRole): boolean {
  return CROSS_FACILITY_ROLES.includes(role);
}

export function isAdminDashboardRole(role: UserRole): boolean {
  return isCrossFacilityRole(role);
}
