import { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { isMasterDataAdminRole } from "../utils/roles";
import {
  ActionKey,
  ModuleKey,
  PermissionMatrix,
  can,
  fullAccessMatrix,
  pharmacistMatrix,
  sanitizeMatrix,
} from "../utils/permissionMatrix";

/**
 * Resolves a user's effective permission matrix.
 *
 * Primary source: their assigned Role Master record (`roleId`). Loaded with a
 * short in-process cache so permission edits propagate within ~`CACHE_TTL_MS`
 * without a DB hit per request. When a user has no `roleId` (legacy tokens /
 * un-migrated users), we fall back to the enum tier so nothing breaks.
 */

const CACHE_TTL_MS = 45_000;
const cache = new Map<string, { matrix: PermissionMatrix; expires: number }>();

export function invalidateRoleCache(roleId?: string) {
  if (roleId) cache.delete(roleId);
  else cache.clear();
}

async function getRoleMatrix(roleId: string): Promise<PermissionMatrix> {
  const hit = cache.get(roleId);
  if (hit && hit.expires > Date.now()) return hit.matrix;

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  // Inactive or missing role grants nothing.
  const matrix = role && role.isActive ? sanitizeMatrix(role.permissions) : {};
  cache.set(roleId, { matrix, expires: Date.now() + CACHE_TTL_MS });
  return matrix;
}

/** Enum-derived fallback matrix (matches the seeded system roles). */
export function fallbackMatrix(role: UserRole): PermissionMatrix {
  return isMasterDataAdminRole(role) ? fullAccessMatrix() : pharmacistMatrix();
}

export async function getEffectiveMatrix(user: {
  roleId?: string | null;
  role: UserRole;
}): Promise<PermissionMatrix> {
  if (user.roleId) return getRoleMatrix(user.roleId);
  return fallbackMatrix(user.role);
}

export async function userCan(
  user: { roleId?: string | null; role: UserRole },
  module: ModuleKey,
  action: ActionKey
): Promise<boolean> {
  const matrix = await getEffectiveMatrix(user);
  return can(matrix, module, action);
}
