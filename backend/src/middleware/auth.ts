import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { config } from "../utils/config";
import { UserRole } from "@prisma/client";
import { isCrossFacilityRole } from "../utils/roles";

export interface AuthPayload {
  userId: string;
  email: string;
  role: UserRole;
  facilityId?: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
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
  if (isCrossFacilityRole(req.user!.role) && queryFacilityId) {
    return queryFacilityId;
  }
  return req.user?.facilityId ?? null;
}
