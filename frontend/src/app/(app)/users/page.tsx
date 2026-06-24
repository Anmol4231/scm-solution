"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Search, UserCheck, UserX, Pencil, KeyRound } from "lucide-react";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import type { Facility, ManagedUser, RoleOption, TempPasswordInfo } from "@/lib/users";
import { PasswordResultDialog } from "@/components/users/password-result-dialog";

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
  const [error, setError] = useState("");
  const [tempPassword, setTempPassword] = useState<TempPasswordInfo | null>(null);

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

  if (!isAdmin) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Users & Access</h1>
          <p className="text-sm text-muted-foreground">Manage system user accounts, roles, and access levels.</p>
        </div>
        <Button onClick={() => router.push("/users/new")}>
          <Plus className="mr-2 h-4 w-4" /> Add User
        </Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

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
                        onClick={() => router.push(`/users/${u.id}/edit`)}
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

      <PasswordResultDialog info={tempPassword} onClose={() => setTempPassword(null)} />
    </div>
  );
}
