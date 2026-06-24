"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ShieldCheck, Lock } from "lucide-react";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { ACTIONS, MODULES, type ActionKey, type ModuleKey, type PermissionMatrix } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeCode, sanitizePersonName, validators } from "@/lib/validation";

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
  permissions: Object.fromEntries(MODULES.map((m) => [m.key, ["view"]])) as PermissionMatrix,
};

export default function RoleMasterPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);

  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<RoleForm>(EMPTY);
  const [pendingEdit, setPendingEdit] = useState<Role | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [isAdmin, loading, router]);

  const load = () => {
    setIsLoading(true);
    api<Role[]>("/roles").then(setRoles).catch((e) => setError(e.message)).finally(() => setIsLoading(false));
  };
  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  if (!isAdmin) return null;

  const startAdd = () => {
    setError(""); setSuccess("");
    setForm(EMPTY);
    setEditingId("new");
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
        if (a === "view") {
          mod.actions.forEach((act) => current.delete(act));
        } else {
          current.delete(a);
          for (const [dependent, deps] of Object.entries(ACTION_REQUIRES) as [ActionKey, ActionKey[]][]) {
            if (deps.includes(a) && mod.actions.includes(dependent)) {
              current.delete(dependent);
            }
          }
        }
      } else {
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
    if (!window.confirm(`Delete role "${r.name}"? It can be restored from Audit Logs.`)) return;
    setError(""); setSuccess("");
    try {
      await api(`/roles/${r.id}`, { method: "DELETE" });
      setSuccess(`Role "${r.name}" deleted`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete role");
    }
  };

  return (
    <div className="space-y-5">
      {/* Warning dialog before editing a role that has assigned users */}
      {pendingEdit && createPortal(
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95 duration-[120ms] [animation-fill-mode:backwards]">
            <h2 className="text-base font-semibold text-slate-800">Edit role with active users?</h2>
            <p className="mt-2 text-sm text-slate-600">
              <strong>{pendingEdit.name}</strong> is assigned to{" "}
              <strong>{pendingEdit.userCount} user{pendingEdit.userCount !== 1 ? "s" : ""}</strong>.
              Any changes to this role will affect their access permissions.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={() => doStartEdit(pendingEdit)}>Continue editing</Button>
              <Button variant="outline" onClick={() => setPendingEdit(null)}>Cancel</Button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {editingId && (
        <button type="button" onClick={cancel} className="text-sm text-medflow-600 hover:underline">
          ← Role Master
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ShieldCheck className="h-6 w-6 text-medflow-600" />
            {editingId ? (editingId === "new" ? "New Role" : `Edit Role`) : "Role Master"}
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
              {editingId === "new" ? "New Role" : editingRole?.name}
              {isSystem && (
                <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  <Lock className="h-3 w-3" /> System role
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                <Label>Scope of Responsibility</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What this role is for"
                />
              </div>
              <div>
                <Label>Status</Label>
                <select
                  className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
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
                        <th key={a} className="p-2.5 text-center font-medium capitalize">{a}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {MODULES.map((mod) => (
                      <tr key={mod.key} className="border-b last:border-0 hover:bg-slate-50/60">
                        <td className="p-2.5 font-medium text-slate-700">{mod.label}</td>
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
                      {(r.isSystem || r.userCount > 0) && (
                        <Lock className="ml-1.5 inline h-3 w-3 text-slate-400" aria-label={r.isSystem ? "System role" : "Role has assigned users"} />
                      )}
                    </td>
                    <td className="p-3 font-mono text-sm text-slate-600">{r.code}</td>
                    <td className="p-3">
                      <span className={r.isActive ? "text-emerald-600" : "text-slate-400"}>
                        {r.isActive ? "● Active" : "○ Inactive"}
                      </span>
                    </td>
                    <td className="p-3">
                      {r.userCount > 0 ? (
                        <Link
                          href={`/users?role=${r.id}`}
                          className="text-medflow-600 underline hover:text-medflow-700"
                        >
                          {r.userCount}
                        </Link>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="p-3">
                      <div className="flex gap-0.5">
                        <Button
                          size="sm" variant="ghost"
                          className="h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Edit role" aria-label="Edit role"
                          onClick={() => startEdit(r)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-8 w-8 p-0 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          onClick={() => remove(r)}
                          disabled={r.isSystem || r.userCount > 0}
                          title={r.isSystem ? "System roles cannot be deleted" : r.userCount > 0 ? "Reassign users before deleting" : "Delete role"}
                          aria-label="Delete role"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {isLoading && <SkeletonRows rows={4} cols={5} />}
                {!isLoading && roles.length === 0 && (
                  <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No roles found</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
