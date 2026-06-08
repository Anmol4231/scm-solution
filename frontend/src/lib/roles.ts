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

/**
 * The UI exposes only two visible roles. Backend roles are preserved; this is a
 * display mapping only:
 *   SUPER_ADMIN | PROVINCIAL_MANAGER | NURSE_ADMIN → Admin
 *   PHARMACIST  | STOREKEEPER                      → Pharmacist
 */
export function simpleRoleLabel(role?: string): string {
  if (!role) return "";
  if (role === "PHARMACIST" || role === "STOREKEEPER") return "Pharmacist";
  return "Admin";
}

/** Role options exposed when creating/editing users. Admin = all locations. */
export const ROLE_OPTIONS = [
  { value: "PROVINCIAL_MANAGER", label: "Admin (all locations)" },
  { value: "PHARMACIST", label: "Pharmacist (single location)" },
] as const;

/** Roles that span all locations (no single facility assignment). */
export function roleSpansAllLocations(role?: string): boolean {
  return isCrossFacilityRole(role);
}
