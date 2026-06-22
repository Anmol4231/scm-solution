"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Search, UserCheck, UserX, Copy, Check, Pencil, KeyRound } from "lucide-react";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { sanitizePersonName, sanitizePhone, validators } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Facility { id: string; name: string; code: string }
interface RoleOption { id: string; name: string; code: string; scopeAllFacilities: boolean; isActive: boolean }

interface ManagedUser {
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

const EXPIRY_PRESETS = [
  { value: "0", label: "Never" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "custom", label: "Custom…" },
];

interface UserForm {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
  /** "all" = access all facilities; "assigned" = single facility (requires facilityId). */
  facilityAccess: "all" | "assigned";
  facilityId: string;
  phone: string;
  mustChangePassword: boolean;
  expiryPreset: string;
  customExpiry: string;
}

const EMPTY_FORM: UserForm = {
  firstName: "", lastName: "", email: "", roleId: "",
  facilityAccess: "assigned", facilityId: "", phone: "",
  mustChangePassword: true, expiryPreset: "0", customExpiry: "",
};

function expiryToDays(form: UserForm): number | null {
  if (form.expiryPreset === "0") return null;
  if (form.expiryPreset === "custom") return form.customExpiry ? parseInt(form.customExpiry, 10) : null;
  return parseInt(form.expiryPreset, 10);
}

function daysToPreset(days?: number | null): { preset: string; custom: string } {
  if (!days) return { preset: "0", custom: "" };
  if (["30", "60", "90", "180"].includes(String(days))) return { preset: String(days), custom: "" };
  return { preset: "custom", custom: String(days) };
}

export default function UsersAccessPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [roleFilter, setRoleFilter] = useState<string>("");
  const [facilityFilter, setFacilityFilter] = useState<string>("");

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [error, setError] = useState("");
  const [tempPassword, setTempPassword] = useState<{ name: string; password: string; emailSent: boolean; emailWarning?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const load = () => {
    setIsLoading(true);
    api<ManagedUser[]>("/users")
      .then(setUsers)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load users"))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    if (!loading && !isAdmin) { router.replace("/dashboard"); return; }
    if (isAdmin) {
      load();
      api<Facility[]>("/auth/facilities").then(setFacilities).catch(console.error);
      api<RoleOption[]>("/roles").then((r) => setRoles(r.filter((x) => x.isActive))).catch(console.error);
    }
  }, [isAdmin, loading, router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const role = params.get("role");
    if (role) setRoleFilter(role);
  }, []);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === "active" && !u.isActive) return false;
      if (statusFilter === "inactive" && u.isActive) return false;
      if (roleFilter && u.roleId !== roleFilter) return false;
      if (facilityFilter && u.facilityId !== facilityFilter) return false;
      if (!q) return true;
      return `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    });
  }, [users, query, statusFilter, roleFilter, facilityFilter]);

  const hasActiveFilters = query !== "" || statusFilter !== "all" || roleFilter !== "" || facilityFilter !== "";
  const clearFilters = () => { setQuery(""); setStatusFilter("all"); setRoleFilter(""); setFacilityFilter(""); };

  const spansAll = form.facilityAccess === "all";

  const startAdd = () => { setError(""); setTempPassword(null); setForm(EMPTY_FORM); setEditingId("new"); };
  const startEdit = (u: ManagedUser) => {
    setError(""); setTempPassword(null);
    const { preset, custom } = daysToPreset(u.passwordExpiryDays);
    setForm({
      firstName: u.firstName, lastName: u.lastName, email: u.email,
      roleId: u.roleId ?? "",
      facilityAccess: u.facilityId ? "assigned" : "all",
      facilityId: u.facilityId ?? "",
      phone: u.phone ?? "",
      mustChangePassword: u.mustChangePassword, expiryPreset: preset, customExpiry: custom,
    });
    setEditingId(u.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const cancel = () => { setEditingId(null); setForm(EMPTY_FORM); };

  const validate = (): string => {
    const f = validators.personName(form.firstName, "First name"); if (f) return f;
    const l = validators.personName(form.lastName, "Last name"); if (l) return l;
    const e = validators.email(form.email); if (e) return e;
    const p = validators.phone(form.phone); if (p) return p;
    if (!form.roleId) return "Please select a role";
    if (!spansAll && !form.facilityId) return "Please assign a location for this role";
    if (form.expiryPreset === "custom" && !form.customExpiry) return "Enter the custom expiry in days";
    return "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setTempPassword(null);
    const v = validate();
    if (v) return setError(v);

    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      roleId: form.roleId,
      accessAllFacilities: spansAll,
      facilityId: spansAll ? "" : form.facilityId,
      phone: form.phone.trim(),
      mustChangePassword: form.mustChangePassword,
      passwordExpiryDays: expiryToDays(form),
    };

    try {
      if (editingId === "new") {
        const res = await api<{ user: ManagedUser; temporaryPassword: string; emailSent: boolean; emailWarning?: string }>("/users", {
          method: "POST", body: JSON.stringify(payload),
        });
        setTempPassword({ name: `${res.user.firstName} ${res.user.lastName}`, password: res.temporaryPassword, emailSent: res.emailSent, emailWarning: res.emailWarning });
      } else {
        await api(`/users/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
      }
      cancel();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save user");
    }
  };

  const toggleStatus = async (u: ManagedUser) => {
    try {
      await api(`/users/${u.id}/status`, { method: "PATCH", body: JSON.stringify({ isActive: !u.isActive }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    }
  };

  const resetPassword = async (u: ManagedUser) => {
    if (!window.confirm(`Reset password for ${u.firstName} ${u.lastName}? A new temporary password will be generated.`)) return;
    try {
      const res = await api<{ temporaryPassword: string; emailSent: boolean; emailWarning?: string }>(`/users/${u.id}/reset-password`, { method: "POST" });
      setTempPassword({ name: `${u.firstName} ${u.lastName}`, password: res.temporaryPassword, emailSent: res.emailSent, emailWarning: res.emailWarning });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    }
  };

  const copyPassword = async () => {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-5">
      {editingId && (
        <button type="button" onClick={cancel} className="text-sm text-medflow-600 hover:underline">
          ← Users &amp; Access
        </button>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {editingId ? (editingId === "new" ? "Add User" : "Edit User") : "Users & Access"}
          </h1>
          {!editingId && <p className="text-sm text-muted-foreground">Manage system user accounts, roles, and access levels.</p>}
        </div>
        {!editingId && (
          <Button onClick={startAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add User
          </Button>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {tempPassword && (
        <div className={`rounded-lg border p-4 ${tempPassword.emailWarning ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <p className={`text-sm font-medium ${tempPassword.emailWarning ? "text-amber-800" : "text-emerald-800"}`}>
            {tempPassword.emailWarning ? (
              <>
                <AlertTriangle className="mr-1.5 inline h-4 w-4 align-text-bottom" />
                {tempPassword.emailWarning}
              </>
            ) : tempPassword.emailSent ? (
              <>Credentials sent to &ldquo;{tempPassword.name}&rdquo;&apos;s email. Share the password below as a backup.</>
            ) : (
              <>Temporary password for &ldquo;{tempPassword.name}&rdquo; — share this password directly.</>
            )}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-white px-3 py-1.5 font-mono text-sm">{tempPassword.password}</code>
            <Button size="sm" variant="outline" onClick={copyPassword}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {editingId && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>First name *</Label>
                <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: sanitizePersonName(e.target.value) })} />
              </div>
              <div>
                <Label>Last name *</Label>
                <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: sanitizePersonName(e.target.value) })} />
              </div>
              <div>
                <Label>Login ID (Email) *</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email address" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.phone} inputMode="tel" onChange={(e) => setForm({ ...form, phone: sanitizePhone(e.target.value) })} placeholder="Phone number" />
              </div>
              <div>
                <Label>Role *</Label>
                <select
                  className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
                  value={form.roleId}
                  onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                >
                  <option value="">Select role</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Facility Access *</Label>
                <select
                  className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
                  value={form.facilityAccess}
                  onChange={(e) => {
                    const val = e.target.value as "assigned" | "all";
                    setForm({ ...form, facilityAccess: val, facilityId: val === "all" ? "" : form.facilityId });
                  }}
                >
                  <option value="assigned">Assigned Facility</option>
                  <option value="all">All Facilities</option>
                </select>
              </div>
              {!spansAll && (
                <div className="md:col-span-2">
                  <Label>Assigned Facility *</Label>
                  <select
                    className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
                    value={form.facilityId}
                    onChange={(e) => setForm({ ...form, facilityId: e.target.value })}
                  >
                    <option value="">Select location</option>
                    {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <Label>Password expiry</Label>
                <div className="flex gap-2">
                  <select
                    className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
                    value={form.expiryPreset}
                    onChange={(e) => setForm({ ...form, expiryPreset: e.target.value })}
                  >
                    {EXPIRY_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                  {form.expiryPreset === "custom" && (
                    <Input
                      className="w-28"
                      inputMode="numeric"
                      placeholder="days"
                      value={form.customExpiry}
                      onChange={(e) => setForm({ ...form, customExpiry: e.target.value.replace(/\D/g, "") })}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-medflow-600"
                    checked={form.mustChangePassword}
                    onChange={(e) => setForm({ ...form, mustChangePassword: e.target.checked })}
                  />
                  Force password change at next login
                </label>
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">{editingId === "new" ? "Create User" : "Save Changes"}</Button>
                <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex gap-1">
            {(["all", "active", "inactive"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-full border px-3 py-1 text-sm font-medium capitalize transition ${
                  statusFilter === s ? "border-medflow-300 bg-medflow-50 text-medflow-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 min-w-[160px] flex-1 rounded-lg border bg-white px-3 text-sm text-slate-700 sm:max-w-[220px]"
            value={facilityFilter}
            onChange={(e) => setFacilityFilter(e.target.value)}
            aria-label="Filter by facility"
          >
            <option value="">All facilities</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <select
            className="h-9 min-w-[160px] flex-1 rounded-lg border bg-white px-3 text-sm text-slate-700 sm:max-w-[220px]"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-full border border-slate-200 px-3 py-1 text-sm font-medium text-slate-500 transition hover:bg-slate-50"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-sm font-semibold text-slate-500">
                <th className="p-3 pl-4">Name</th>
                <th className="p-3">Login ID (Email)</th>
                <th className="p-3">Role</th>
                <th className="p-3">Facility</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u.id} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="p-3 pl-4 font-medium text-slate-800">{u.firstName} {u.lastName}</td>
                  <td className="p-3 text-slate-600">{u.email}</td>
                  <td className="p-3 text-slate-600">
                    {u.roleMaster?.name ?? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-sm font-medium text-amber-700">
                        <AlertTriangle className="h-3 w-3" /> No role — edit to assign
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-slate-600">{u.facility?.name ?? (u.roleMaster?.scopeAllFacilities ? "All locations" : "—")}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${u.isActive ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {u.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-0.5">
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="Edit user" aria-label="Edit user"
                        onClick={() => startEdit(u)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        title="Reset password" aria-label="Reset password"
                        onClick={() => resetPassword(u)}
                      >
                        <KeyRound className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm" variant="ghost"
                        className="h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        onClick={() => toggleStatus(u)}
                        disabled={u.id === user?.id}
                        title={u.id === user?.id ? "You cannot deactivate yourself" : u.isActive ? "Deactivate user" : "Activate user"}
                        aria-label={u.isActive ? "Deactivate user" : "Activate user"}
                      >
                        {u.isActive
                          ? <UserX className="h-4 w-4" aria-hidden="true" />
                          : <UserCheck className="h-4 w-4" aria-hidden="true" />}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {isLoading && <SkeletonRows rows={6} cols={6} />}
              {!isLoading && visible.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No users found</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
