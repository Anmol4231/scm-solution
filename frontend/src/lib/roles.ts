export const CROSS_FACILITY_ROLES = ["PROVINCIAL_MANAGER", "SUPER_ADMIN"] as const;

export type CrossFacilityRole = (typeof CROSS_FACILITY_ROLES)[number];

export function isCrossFacilityRole(role?: string): role is CrossFacilityRole {
  return !!role && CROSS_FACILITY_ROLES.includes(role as CrossFacilityRole);
}

export function isAdminDashboardRole(role?: string): boolean {
  return isCrossFacilityRole(role);
}

export function isMasterDataAdminRole(role?: string): boolean {
  return role === "NURSE_ADMIN" || role === "PROVINCIAL_MANAGER" || role === "SUPER_ADMIN";
}

export function adminRoleLabel(role?: string): string {
  if (role === "SUPER_ADMIN") return "Super Admin";
  if (role === "PROVINCIAL_MANAGER") return "Provincial Manager";
  return role ?? "";
}
