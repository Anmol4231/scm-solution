import { Request, Response, NextFunction } from "express";
import { config } from "../utils/config";
import { ActionKey, ModuleKey } from "../utils/permissionMatrix";
import { userCan } from "../services/permissions";

/**
 * Permission-based route guard. Enforced only when `RBAC_ENFORCE=true`; otherwise
 * it passes through (legacy `requireRoles` enum guards still apply). This lets the
 * Role Master matrix be adopted route-by-route without regressing existing access.
 *
 * Requires `authenticate` to have populated `req.user`.
 */
export function requirePermission(module: ModuleKey, action: ActionKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!config.rbacEnforce) return next();
    try {
      const allowed = await userCan(req.user, module, action);
      if (!allowed) return res.status(403).json({ error: "Insufficient permissions" });
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Allow access if the user has ANY of the listed module/action pairs. */
export function requireAnyPermission(...perms: Array<[ModuleKey, ActionKey]>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (!config.rbacEnforce) return next();
    try {
      for (const [module, action] of perms) {
        if (await userCan(req.user, module, action)) return next();
      }
      return res.status(403).json({ error: "Insufficient permissions" });
    } catch (e) {
      next(e);
    }
  };
}
