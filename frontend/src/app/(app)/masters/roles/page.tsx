"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ShieldCheck, Lock } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { ACTIONS, MODULES, type ActionKey, type ModuleKey, type PermissionMatrix } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeCode, sanitizePersonName, validators } from "@/lib/validation";
import { Wand2 } from "lucide-react";

interface Role {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
  isSystem: boolean;
  scopeAllFacilities: boolean;
  permissions: PermissionMatrix;
  userCount: number;
}

interface RoleForm {
  name: string;
  code: string;
  description: string;
  isActive: boolean;
  permissions: PermissionMatrix;
}

const EMPTY: RoleForm = {
  name: "",
  code: "",
  description: "",
  isActive: true,
  // All modules default to View=ON; Create/Edit/Delete/Approve=OFF (admins can adjust manually).
  permissions: Object.fromEntries(MODULES.map((m) => [m.key, ["view"]])) as PermissionMatrix,
};

const ROLE_TEMPLATES: { label: string; value: Partial<RoleForm> }[] = [
  {
    label: "Administrator",
    value: {
      name: "Administrator",
      code: "ADMIN",
      description: "Full system access across all facilities and modules",
      permissions: Object.fromEntries(
        MODULES.map((m) => [m.key, [...m.actions]])
      ) as PermissionMatrix,
    },
  },
  {
    label: "Pharmacist",
    value: {
      name: "Pharmacist",
      code: "PHARM",
      description: "Dispense medicines, manage stock and prescriptions",
      permissions: {
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
      },
    },
  },
  {
    label: "Store Keeper",
    value: {
      name: "Store Keeper",
      code: "STORE",
      description: "Manage stock receipts, adjustments and transfers",
      permissions: {
        dashboard: ["view"],
        stockCategories: ["view"],
        medicines: ["view"],
        orders: ["view", "create", "edit", "approve"],
        receiveStock: ["view", "create", "edit"],
        stock: ["view", "create", "edit"],
        expiry: ["view"],
        transfers: ["view", "create"],
      },
    },
  },
  {
    label: "Facility Manager",
    value: {
      name: "Facility Manager",
      code: "FAC_MGR",
      description: "Manage facility operations and staff",
      permissions: {
        dashboard: ["view"],
        users: ["view"],
        facilities: ["view"],
        stockCategories: ["view"],
        medicines: ["view"],
        orders: ["view", "create", "edit", "approve"],
        receiveStock: ["view", "create", "edit", "approve"],
        stock: ["view", "create", "edit", "approve"],
        expiry: ["view", "edit", "approve"],
        transfers: ["view", "create", "edit", "approve"],
        returns: ["view", "create", "edit", "approve"],
        patients: ["view", "create", "edit"],
        prescriptions: ["view", "create", "edit"],
        dispensing: ["view", "create"],
        alerts: ["view", "approve"],
      },
    },
  },
  {
    label: "Auditor",
    value: {
      name: "Auditor",
      code: "AUDITOR",
      description: "Read-only access to all modules for audit purposes",
      permissions: Object.fromEntries(
        MODULES.map((m) => [m.key, ["view"]])
      ) as PermissionMatrix,
    },
  },
];

export default function RoleMasterPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);

  const [roles, setRoles] = useState<Role[]>([]);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<RoleForm>(EMPTY);
  const [showTemplates, setShowTemplates] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<Role | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [isAdmin, loading, router]);

  const load = () => api<Role[]>("/roles").then(setRoles).catch((e) => setError(e.message));
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) return null;

  const startAdd = () => {
    setError(""); setSuccess("");
    setForm(EMPTY);
    setShowTemplates(false);
    setEditingId("new");
  };

  const applyTemplate = (tpl: Partial<RoleForm>) => {
    setForm((f) => ({ ...f, ...tpl }));
    setShowTemplates(false);
  };

  const doStartEdit = (r: Role) => {
    setError(""); setSuccess(""); setPendingEdit(null);
    setForm({
      name: r.name,
      code: r.code,
      description: r.description ?? "",
      isActive: r.isActive,
      permissions: r.permissions ?? {},
    });
    setEditingId(r.id);
  };

  const startEdit = (r: Role) => {
    if (r.userCount > 0) {
      setPendingEdit(r);
    } else {
      doStartEdit(r);
    }
  };

  const cancel = () => { setEditingId(null); setForm(EMPTY); };

  const editingRole = editingId && editingId !== "new" ? roles.find((r) => r.id === editingId) : null;
  const isSystem = !!editingRole?.isSystem;

  const cellChecked = (m: ModuleKey, a: ActionKey) => !!form.permissions[m]?.includes(a);

  // Dependencies: which actions must also be checked when enabling a given action.
  const ACTION_REQUIRES: Partial<Record<ActionKey, ActionKey[]>> = {
    create: ["view"],
    edit: ["view", "create"],
    delete: ["view"],
    approve: ["view"],
  };

  const toggleCell = (m: ModuleKey, a: ActionKey) => {
    setForm((f) => {
      const mod = MODULES.find((x) => x.key === m);
      if (!mod) return f;
      const current = new Set(f.permissions[m] ?? []);

      if (current.has(a)) {
        // Unchecking "view" cascades — clear all actions for this module.
        if (a === "view") {
          mod.actions.forEach((act) => current.delete(act));
        } else {
          current.delete(a);
          // Also uncheck anything that requires this action (e.g. un-check create → un-check edit).
          for (const [dependent, deps] of Object.entries(ACTION_REQUIRES) as [ActionKey, ActionKey[]][]) {
            if (deps.includes(a) && mod.actions.includes(dependent)) {
              current.delete(dependent);
            }
          }
        }
      } else {
        // Checking: auto-check required dependencies first.
        for (const dep of ACTION_REQUIRES[a] ?? []) {
          if (mod.actions.includes(dep)) current.add(dep);
        }
        current.add(a);
      }

      const next = { ...f.permissions };
      if (current.size) next[m] = Array.from(current) as ActionKey[];
      else delete next[m];
      return { ...f, permissions: next };
    });
  };

  const save = async () => {
    setError(""); setSuccess("");
    const nameErr = validators.personName(form.name, "Role name");
    if (nameErr) return setError(nameErr);
    if (editingId === "new") {
      const codeErr = validators.code(form.code, "Role code");
      if (codeErr) return setError(codeErr);
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        ...(editingId === "new" ? { code: form.code.trim().toUpperCase() } : {}),
        description: form.description.trim(),
        isActive: form.isActive,
        permissions: form.permissions,
      };
      if (editingId === "new") {
        await api("/roles", { method: "POST", body: JSON.stringify(payload) });
        setSuccess(`Role "${form.name}" created`);
      } else {
        await api(`/roles/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setSuccess(`Role "${form.name}" updated`);
      }
      cancel();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save role");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Role) => {
    if (!window.confirm(`Delete role "${r.name}"? This cannot be undone.`)) return;
    setError(""); setSuccess("");
    try {
      await api(`/roles/${r.id}`, { method: "DELETE" });
      setSuccess(`Role "${r.name}" deleted`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete role");
    }
  };

  const ACTION_TIPS: Record<ActionKey, string> = {
    view: "Read-only access to this module",
    create: "Add new records (requires View)",
    edit: "Modify existing records (requires View + Create)",
    delete: "Remove records permanently (requires View)",
    approve: "Authorize pending operations (requires View)",
  };

  return (
    <div className="space-y-5">
      {/* Warning dialog before editing a role that has assigned users */}
      {pendingEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-slate-800">Edit role with active users?</h2>
            <p className="mt-2 text-sm text-slate-600">
              <strong>{pendingEdit.name}</strong> is assigned to{" "}
              <strong>{pendingEdit.userCount} user{pendingEdit.userCount !== 1 ? "s" : ""}</strong>.
              Changing permissions will immediately affect their access on the next API call.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => doStartEdit(pendingEdit)}>Continue editing</Button>
              <Button variant="outline" onClick={() => setPendingEdit(null)}>Cancel</Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-medflow-600" /> Role Master
          </h1>
        </div>
        {!editingId && <Button onClick={startAdd}><Plus className="mr-2 h-4 w-4" /> New Role</Button>}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      {editingId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingId === "new" ? "New Role" : `Edit Role: ${editingRole?.name}`}
              {isSystem && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  <Lock className="h-3 w-3" /> System role
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingId === "new" && (
              <div className="rounded-lg border border-dashed border-medflow-200 bg-medflow-50/40 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-medflow-600" />
                  <span className="text-sm font-medium text-medflow-700">Use a template</span>
                  <button
                    type="button"
                    onClick={() => setShowTemplates(!showTemplates)}
                    className="ml-auto text-sm text-medflow-600 underline"
                  >
                    {showTemplates ? "Hide" : "Choose template"}
                  </button>
                </div>
                {showTemplates && (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {ROLE_TEMPLATES.map((t) => (
                      <button
                        key={t.label}
                        type="button"
                        onClick={() => applyTemplate(t.value)}
                        className="rounded-lg border border-medflow-200 bg-white px-3 py-2 text-left text-sm hover:border-medflow-400 hover:bg-medflow-50"
                      >
                        <p className="font-medium text-slate-800">{t.label}</p>
                        <p className="mt-0.5 text-[11px] text-slate-500 line-clamp-2">{t.value.description}</p>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setForm(EMPTY); setShowTemplates(false); }}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:border-slate-300"
                    >
                      <p className="font-medium text-slate-800">Custom</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">Start from scratch</p>
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Role name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: sanitizePersonName(e.target.value) })}
                  placeholder="Role name"
                />
              </div>
              <div>
                <Label>Role code *</Label>
                <Input
                  value={form.code}
                  disabled={editingId !== "new"}
                  onChange={(e) => setForm({ ...form, code: sanitizeCode(e.target.value) })}
                  placeholder="ROLE-CODE"
                />
                {editingId !== "new" && <p className="mt-1 text-sm text-slate-400">Code is fixed after creation.</p>}
              </div>
              <div className="md:col-span-2">
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What this role is for"
                />
              </div>
              <div>
                <Label>Status</Label>
                <select
                  className="h-11 w-full rounded-lg border px-3 text-sm"
                  value={form.isActive ? "active" : "inactive"}
                  onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <div>
              <Label>Permission matrix</Label>
              <div className="mt-1 overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-left">
                      <th className="p-2.5 font-medium">Module</th>
                      {ACTIONS.map((a) => (
                        <th key={a} className="p-2.5 text-center font-medium capitalize" title={ACTION_TIPS[a]}>{a}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((mod) => (
                      <tr key={mod.key} className="border-b last:border-0 hover:bg-slate-50/60">
                        <td className="p-2.5 font-medium text-slate-700">
                          {mod.label}
                          {mod.approveLabel && (
                            <span className="block text-[10px] font-normal text-slate-400">Approve = {mod.approveLabel}</span>
                          )}
                        </td>
                        {ACTIONS.map((a) => {
                          const applies = mod.actions.includes(a);
                          return (
                            <td key={a} className="p-2.5 text-center">
                              {applies ? (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 cursor-pointer accent-medflow-600"
                                  checked={cellChecked(mod.key, a)}
                                  onChange={() => toggleCell(mod.key, a)}
                                />
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Role"}</Button>
              <Button variant="outline" onClick={cancel}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <th className="p-3 font-medium">Name</th>
                  <th className="p-3 font-medium">Code</th>
                  <th className="p-3 font-medium">Status</th>
                  <th className="p-3 font-medium">Users</th>
                  <th className="p-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-slate-50/60">
                    <td className="p-3 font-medium text-slate-800">
                      {r.name}
                      {r.isSystem && <Lock className="ml-1.5 inline h-3 w-3 text-slate-400" aria-label="System role" />}
                    </td>
                    <td className="p-3 font-mono text-sm text-slate-600">{r.code}</td>
                    <td className="p-3">
                      <span className={r.isActive ? "text-emerald-600" : "text-slate-400"}>
                        {r.isActive ? "● Active" : "○ Inactive"}
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">{r.userCount}</td>
                    <td className="p-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => startEdit(r)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => remove(r)}
                          disabled={r.isSystem || r.userCount > 0}
                          title={r.isSystem ? "System roles cannot be deleted" : r.userCount > 0 ? "Reassign users before deleting" : ""}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {roles.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No roles yet.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
