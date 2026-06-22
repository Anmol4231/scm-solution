import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../utils/config";
import { UserRole } from "@prisma/client";
import { isCrossFacilityRole } from "../utils/roles";
import { prisma } from "../lib/prisma";

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
  roleId?: string | null;
  facilityId?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

// ─── Live identity resolution ──────────────────────────────────────────────────
// The JWT proves *who* the user is (immutable userId), but their role, role
// assignment, facility, email and active status can all change after the token
// was issued. We therefore re-derive those from the database on each request
// (short-TTL cached, invalidated on edit) so account changes take effect on the
// very next request instead of being frozen until the user logs in again.

interface LiveIdentity {
  email: string;
  role: UserRole;
  roleId: string | null;
  facilityId: string | null;
  isActive: boolean;
}

const IDENTITY_TTL_MS = 15_000;
const identityCache = new Map<string, { identity: LiveIdentity; expires: number }>();

/** Drop a user's cached identity so the next request reloads it from the DB. */
export function invalidateUserIdentity(userId?: string) {
  if (userId) identityCache.delete(userId);
  else identityCache.clear();
}

async function loadIdentity(userId: string): Promise<LiveIdentity | null> {
  const hit = identityCache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.identity;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, role: true, roleId: true, facilityId: true, isActive: true },
  });
  if (!user) {
    identityCache.delete(userId);
    return null;
  }
  identityCache.set(userId, { identity: user, expires: Date.now() + IDENTITY_TTL_MS });
  return user;
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  let payload: AuthPayload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ["HS256"] }) as AuthPayload;
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  try {
    const fresh = await loadIdentity(payload.userId);
    if (!fresh || !fresh.isActive) {
      return res.status(401).json({ error: "Session no longer valid. Please log in again." });
    }
    req.user = {
      userId: payload.userId,
      email: fresh.email,
      role: fresh.role,
      roleId: fresh.roleId,
      // Cross-facility admins carry their active facility in the token (set by
      // switch-facility; their DB facility is null), so preserve it. Everyone
      // else is scoped by their live DB facility assignment.
      facilityId: isCrossFacilityRole(fresh.role) ? payload.facilityId ?? null : fresh.facilityId,
    };
    next();
  } catch (e) {
    next(e);
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

export function requireFacility(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.facilityId && !isCrossFacilityRole(req.user!.role)) {
    return res.status(400).json({ error: "Facility selection required" });
  }
  next();
}

export function getFacilityId(req: Request, queryFacilityId?: string): string | null {
  if (isCrossFacilityRole(req.user!.role)) {
    // Cross-facility roles (SUPER_ADMIN, PROVINCIAL_MANAGER) must never be
    // silently scoped by a JWT-embedded facilityId (e.g. from a stale
    // switchFacility token). An explicit query/body param is the only source.
    return queryFacilityId || null;
  }
  return req.user?.facilityId ?? null;
}
