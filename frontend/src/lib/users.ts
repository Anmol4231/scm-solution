export interface Facility {
  id: string;
  name: string;
  code: string;
}

export interface RoleOption {
  id: string;
  name: string;
  code: string;
  scopeAllFacilities: boolean;
  isActive: boolean;
}

export interface ManagedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  roleId?: string | null;
  roleMaster?: { id: string; name: string; code: string; scopeAllFacilities: boolean } | null;
  facilityId?: string | null;
  facility?: Facility | null;
  phone?: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  passwordExpiryDays?: number | null;
}

/** Result of creating a user or resetting a password — the credential to surface to the admin. */
export interface TempPasswordInfo {
  name: string;
  password: string;
  emailSent: boolean;
  emailWarning?: string;
}
