// Mirror of backend/src/utils/permissionMatrix.ts — keep in sync.

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
  actions: ActionKey[];
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
  { key: "orders", label: "Orders", actions: ["view", "create", "edit", "delete", "approve"], approveLabel: "Approve order" },
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

export function can(matrix: PermissionMatrix | undefined, module: ModuleKey, action: ActionKey): boolean {
  return !!matrix?.[module]?.includes(action);
}

export function moduleActionApplies(module: ModuleKey, action: ActionKey): boolean {
  return MODULES.find((m) => m.key === module)?.actions.includes(action) ?? false;
}
