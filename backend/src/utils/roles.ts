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

/** Roles allowed to manage master data + users (display tier: "Admin"). */
export const MASTER_DATA_ADMIN_ROLES: UserRole[] = [
  UserRole.NURSE_ADMIN,
  UserRole.PROVINCIAL_MANAGER,
  UserRole.SUPER_ADMIN,
];

export function isMasterDataAdminRole(role: UserRole): boolean {
  return MASTER_DATA_ADMIN_ROLES.includes(role);
}
