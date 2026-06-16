"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Building2, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeCode, sanitizeLocationName, sanitizeAddress, validators } from "@/lib/validation";

const FACILITY_TYPES = [
  "HOSPITAL",
  "CLINIC",
  "WAREHOUSE",
  "REGIONAL_STORE",
  "MEDICAL_STORE",
  "AMS_CENTRAL",
  "OTHER",
] as const;

const TYPE_LABELS: Record<string, string> = {
  HOSPITAL: "Hospital",
  CLINIC: "Clinic",
  PHARMACY: "Pharmacy",
  WAREHOUSE: "Warehouse",
  REGIONAL_STORE: "Regional Store",
  MEDICAL_STORE: "Medical Store",
  AMS_CENTRAL: "AMS Central",
  OTHER: "Other",
};

const INVENTORY_TYPES = ["WAREHOUSE", "REGIONAL_STORE", "MEDICAL_STORE", "AMS_CENTRAL"];

const typeLabel = (t?: string | null, custom?: string | null) => {
  if (!t) return "—";
  if (t === "OTHER" && custom) return custom;
  return TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

interface Facility {
  id: string;
  name: string;
  code: string;
  facilityType?: string | null;
  customFacilityType?: string | null;
  province?: string | null;
  district?: string | null;
  address?: string | null;
  isActive: boolean;
  _count?: { users: number };
  activeUserCount?: number;
}

interface FacForm {
  name: string;
  code: string;
  facilityType: string;
  customFacilityType: string;
  province: string;
  district: string;
  address: string;
  isActive: boolean;
}

const EMPTY: FacForm = {
  name: "", code: "", facilityType: "HOSPITAL", customFacilityType: "",
  province: "", district: "", address: "", isActive: true,
};

export default function FacilityMasterPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FacForm>(EMPTY);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [isAdmin, loading, router]);

  const load = () =>
    api<Facility[]>(`/facilities${q ? `?q=${encodeURIComponent(q)}` : ""}`)
      .then(setFacilities)
      .catch((e) => setError(e.message));

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]);

  if (!isAdmin) return null;

  const startAdd = () => { setError(""); setSuccess(""); setForm(EMPTY); setEditingId("new"); };
  const startEdit = (f: Facility) => {
    setError(""); setSuccess("");
    setForm({
      name: f.name, code: f.code, facilityType: f.facilityType ?? "HOSPITAL",
      customFacilityType: f.customFacilityType ?? "",
      province: f.province ?? "", district: f.district ?? "",
      address: f.address ?? "", isActive: f.isActive,
    });
    setEditingId(f.id);
  };
  const cancel = () => { setEditingId(null); setForm(EMPTY); };

  const save = async () => {
    setError(""); setSuccess("");
    const nameErr = validators.required(form.name, "Facility name");
    if (nameErr) return setError(nameErr);
    if (!/[A-Za-z]/.test(form.name.trim())) return setError("Facility name must be alphanumeric");
    if (form.facilityType === "OTHER") {
      const custom = form.customFacilityType.trim();
      if (!custom) return setError("Please specify the custom facility type");
      if (!/[A-Za-z]/.test(custom)) return setError("Custom facility type must be alphanumeric");
      if (!/^[A-Za-z ]+$/.test(custom)) return setError("Custom facility type may only contain letters and spaces");
    }
    if (editingId === "new") {
      const codeErr = validators.code(form.code, "Facility code");
      if (codeErr) return setError(codeErr);
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        ...(editingId === "new" ? { code: form.code.trim().toUpperCase() } : {}),
        facilityType: form.facilityType,
        ...(form.facilityType === "OTHER" ? { customFacilityType: form.customFacilityType.trim() } : {}),
        province: form.province.trim() || undefined,
        district: form.district.trim() || undefined,
        address: form.address.trim() || undefined,
        isActive: form.isActive,
      };
      if (editingId === "new") {
        await api("/facilities", { method: "POST", body: JSON.stringify(payload) });
        setSuccess(`Facility "${form.name}" created`);
      } else {
        await api(`/facilities/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setSuccess(`Facility "${form.name}" updated`);
      }
      cancel(); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save facility");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (f: Facility) => {
    if (!window.confirm(`Delete facility "${f.name}"? This cannot be undone.`)) return;
    setError(""); setSuccess("");
    try {
      await api(`/facilities/${f.id}`, { method: "DELETE" });
      setSuccess(`Facility "${f.name}" deleted`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete facility");
    }
  };

  const editingFacility = editingId && editingId !== "new" ? facilities.find((f) => f.id === editingId) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Building2 className="h-6 w-6 text-medflow-600" /> Facility Master
        </h1>
        {!editingId && <Button onClick={startAdd}><Plus className="mr-2 h-4 w-4" /> New Facility</Button>}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      {editingId ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingId === "new" ? "New Facility" : `Edit: ${editingFacility?.name}`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Facility name *</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Facility code *</Label>
                <Input
                  value={form.code}
                  disabled={editingId !== "new"}
                  onChange={(e) => setForm({ ...form, code: sanitizeCode(e.target.value) })}
                  placeholder="Facility code"
                />
                {editingId !== "new" && <p className="mt-1 text-sm text-slate-400">Code is fixed after creation.</p>}
              </div>
              <div>
                <Label>Type</Label>
                <select className="h-11 w-full rounded-lg border px-3 text-sm" value={form.facilityType} onChange={(e) => setForm({ ...form, facilityType: e.target.value, customFacilityType: "" })}>
                  {FACILITY_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
                </select>
                {INVENTORY_TYPES.includes(form.facilityType) && (
                  <p className="mt-1 text-sm text-medflow-600">This type is linked to supply/vendor records automatically.</p>
                )}
              </div>
              {form.facilityType === "OTHER" && (
                <div>
                  <Label>Custom Type <span className="text-red-500">*</span></Label>
                  <Input
                    value={form.customFacilityType}
                    onChange={(e) => setForm({ ...form, customFacilityType: e.target.value.replace(/[^A-Za-z ]/g, "") })}
                    placeholder="Custom type"
                    maxLength={100}
                  />
                  <p className="mt-1 text-sm text-slate-400">Letters and spaces only.</p>
                </div>
              )}
              <div>
                <Label>Status</Label>
                <select className="h-11 w-full rounded-lg border px-3 text-sm" value={form.isActive ? "active" : "inactive"} onChange={(e) => setForm({ ...form, isActive: e.target.value === "active" })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
              <div>
                <Label>Province / State</Label>
                <Input value={form.province} onChange={(e) => setForm({ ...form, province: sanitizeLocationName(e.target.value) })} />
              </div>
              <div>
                <Label>District</Label>
                <Input value={form.district} onChange={(e) => setForm({ ...form, district: sanitizeLocationName(e.target.value) })} />
              </div>
              <div className="md:col-span-2">
                <Label>Address</Label>
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: sanitizeAddress(e.target.value) })} placeholder="Street, building, block" />
              </div>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Warehouse, Regional Store, Medical Store and AMS Central facilities are linked to vendor/supply records automatically.
            </p>
            <div className="mt-4 flex gap-2">
              <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save Facility"}</Button>
              <Button variant="outline" onClick={cancel}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <form onSubmit={(e) => { e.preventDefault(); load(); }} className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="" value={q} onChange={(e) => setQ(e.target.value)} />
          </form>
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[780px] text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Code</th>
                    <th className="p-3 font-medium">Type</th>
                    <th className="p-3 font-medium">Province</th>
                    <th className="p-3 font-medium">District</th>
                    <th className="p-3 font-medium">Users</th>
                    <th className="p-3 font-medium">Active</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {facilities.map((f) => (
                    <tr key={f.id} className="border-b last:border-0 hover:bg-slate-50/60">
                      <td className="p-3 font-medium text-slate-800">{f.name}</td>
                      <td className="p-3 font-mono text-sm text-slate-600">{f.code}</td>
                      <td className="p-3 text-slate-600">{typeLabel(f.facilityType, f.customFacilityType)}</td>
                      <td className="p-3 text-slate-600">{f.province || "—"}</td>
                      <td className="p-3 text-slate-600">{f.district || "—"}</td>
                      <td className="p-3 text-slate-600">{f._count?.users ?? 0}</td>
                      <td className="p-3 text-slate-600">{f.activeUserCount ?? 0}</td>
                      <td className="p-3">
                        <span className={f.isActive ? "text-emerald-600" : "text-slate-400"}>
                          {f.isActive ? "● Active" : "○ Inactive"}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => startEdit(f)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => remove(f)}
                            disabled={(f._count?.users ?? 0) > 0}
                            title={(f._count?.users ?? 0) > 0 ? "Reassign users before deleting" : ""}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {facilities.length === 0 && (
                    <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No facilities found.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
