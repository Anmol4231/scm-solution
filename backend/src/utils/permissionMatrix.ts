/**
 * Permission matrix definition — the single source of truth for RBAC modules
 * and actions. Mirrored on the frontend (`frontend/src/lib/permissions.ts`).
 *
 * Modules and actions are plain string constants (NOT DB enums) so new ones can
 * be added without a database migration. A role's permissions are stored as
 * `Role.permissions Json` shaped as `Record<ModuleKey, ActionKey[]>`.
 */

export const ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;
export type ActionKey = (typeof ACTIONS)[number];

export type ModuleKey =
  | "dashboard"
  | "users"
  | "facilities"
  | "roles"
  | "stockCategories"
  | "medicines"
  | "orders"
  | "receiveStock"
  | "stock"
  | "expiry"
  | "transfers"
  | "returns"
  | "patients"
  | "prescriptions"
  | "dispensing"
  | "alerts"
  | "audit"
  | "recovery";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  /** Actions that are meaningful for this module (others render disabled in the matrix). */
  actions: ActionKey[];
  /** Human note for the "approve" action when present. */
  approveLabel?: string;
}

const ALL: ActionKey[] = ["view", "create", "edit", "delete"];

export const MODULES: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", actions: ["view"] },
  { key: "users", label: "Users & Access", actions: ALL },
  { key: "facilities", label: "Facility Master", actions: ALL },
  { key: "roles", label: "Role Master", actions: ALL },
  { key: "stockCategories", label: "Stock Categories", actions: ALL },
  { key: "medicines", label: "Medicines", actions: ALL },
  { key: "orders", label: "Orders", actions: ["view", "create", "edit", "delete"] },
  { key: "receiveStock", label: "Receive Stock", actions: ["view", "create", "edit", "approve"], approveLabel: "Confirm receipt" },
  { key: "stock", label: "Stock (adjustments / report)", actions: ["view", "create", "edit", "approve"], approveLabel: "Approve adjustments" },
  { key: "expiry", label: "Expiry", actions: ["view", "edit", "approve"], approveLabel: "Approve disposal" },
  { key: "transfers", label: "Transfers", actions: ["view", "create", "edit", "approve"], approveLabel: "Receive / authorize" },
  { key: "returns", label: "Returns", actions: ["view", "create", "edit", "approve"], approveLabel: "Approve return" },
  { key: "patients", label: "Patients", actions: ["view", "create", "edit"] },
  { key: "prescriptions", label: "Prescriptions", actions: ["view", "create", "edit"] },
  { key: "dispensing", label: "Medicine Dispensing", actions: ["view", "create"] },
  { key: "alerts", label: "Alert Center", actions: ["view", "approve"], approveLabel: "Resolve alert" },
  { key: "audit", label: "Audit Trail & Restore", actions: ["view"] },
  { key: "recovery", label: "Recovery", actions: ["view", "approve"], approveLabel: "Restore record" },
];

export type PermissionMatrix = Partial<Record<ModuleKey, ActionKey[]>>;

const MODULE_BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/** Keep only known modules/actions and only actions applicable to each module. */
export function sanitizeMatrix(input: unknown): PermissionMatrix {
  const out: PermissionMatrix = {};
  if (!input || typeof input !== "object") return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const def = MODULE_BY_KEY.get(key as ModuleKey);
    if (!def || !Array.isArray(value)) continue;
    const allowed = value.filter(
      (a): a is ActionKey => typeof a === "string" && def.actions.includes(a as ActionKey)
    );
    if (allowed.length) out[def.key] = Array.from(new Set(allowed));
  }
  return out;
}

export function can(matrix: PermissionMatrix, module: ModuleKey, action: ActionKey): boolean {
  return !!matrix[module]?.includes(action);
}

/** Full access to every applicable action — used to seed the Administrator role. */
export function fullAccessMatrix(): PermissionMatrix {
  const out: PermissionMatrix = {};
  for (const m of MODULES) out[m.key] = [...m.actions];
  return out;
}

/** Operational subset reproducing the current Pharmacist tier exactly. */
export function pharmacistMatrix(): PermissionMatrix {
  return {
    dashboard: ["view"],
    stockCategories: ["view"],
    medicines: ["view"],
    orders: ["view", "create"],
    receiveStock: ["view", "create"],
    stock: ["view", "create", "edit"],
    expiry: ["view", "edit"],
    transfers: ["view", "create", "approve"],
    returns: ["view", "create", "approve"],
    patients: ["view", "create", "edit"],
    prescriptions: ["view", "create", "edit"],
    dispensing: ["view", "create"],
    alerts: ["view"],
  };
}
