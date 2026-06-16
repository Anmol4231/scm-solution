"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Category {
  id: string;
  name: string;
}

interface MedicineDetail {
  medicine: {
    id: string;
    medicineName: string;
    genericName?: string | null;
    dosageForm?: string | null;
    strength?: string | null;
    strengths?: { id: string; strength: string }[];
    reorderThreshold: number;
    leadTimeDays?: number | null;
    minimumOrderLevel?: number | null;
    categoryId?: string | null;
    category?: { name: string } | null;
    storageCondition?: string | null;
  };
  balance: number | null;
  batches: {
    id: string;
    batchNumber: string;
    quantity: number;
    expiryDate: string;
    daysUntilExpiry: number;
    severity: string;
    facility: { name: string };
    inbound30d: number;
    outbound30d: number;
  }[];
  stockAnalytics: { inbound: { daily: number; weekly: number; monthly: number }; outbound: { daily: number; weekly: number; monthly: number } };
  transactions: { id: string; type: string; quantity: number; createdAt: string; facility?: { name: string }; performedBy?: { firstName: string; lastName: string } }[];
  outboundActivities: {
    id: string;
    activityType: string;
    quantity: number;
    batchNumber: string | null;
    facility: string;
    performedBy: string | null;
    createdAt: string;
  }[];
}

const emptyForm = {
  medicineName: "",
  genericName: "",
  dosageForm: "",
  strength: "",
  reorderThreshold: 50,
  leadTimeDays: "",
  minimumOrderLevel: "",
  categoryId: "",
};

function strengthLabel(m: MedicineDetail["medicine"]) {
  if (m.strength) return m.strength;
  const strengths = m.strengths?.map((s) => s.strength).filter(Boolean);
  if (strengths?.length) return strengths.join(", ");
  return "Not recorded";
}

export default function MedicineDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);
  const [data, setData] = useState<MedicineDetail | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = () => {
    const q = user?.facilityId ? `?facilityId=${user.facilityId}` : "";
    api<MedicineDetail>(`/medicines/${id}/detail${q}`).then(setData).catch(console.error);
  };

  useEffect(() => {
    load();
    if (isAdmin) api<Category[]>("/categories").then(setCategories).catch(console.error);
  }, [id, user?.facilityId, isAdmin]);

  if (!data) return <p className="text-muted-foreground">Loading medicine details...</p>;

  const m = data.medicine;

  const startEdit = () => {
    setError("");
    setSuccess("");
    setEditing(true);
    setForm({
      medicineName: m.medicineName,
      genericName: m.genericName ?? "",
      dosageForm: m.dosageForm ?? "",
      strength: m.strength ?? m.strengths?.[0]?.strength ?? "",
      reorderThreshold: m.reorderThreshold,
      leadTimeDays: m.leadTimeDays?.toString() ?? "",
      minimumOrderLevel: m.minimumOrderLevel?.toString() ?? "",
      categoryId: m.categoryId ?? "",
    });
  };

  const saveMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    try {
      await api(`/medicines/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          medicineName: form.medicineName,
          genericName: form.genericName || undefined,
          dosageForm: form.dosageForm || undefined,
          strengths: form.strength.trim() ? [form.strength.trim()] : undefined,
          reorderThreshold: Number(form.reorderThreshold),
          leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : undefined,
          minimumOrderLevel: form.minimumOrderLevel ? Number(form.minimumOrderLevel) : undefined,
          categoryId: form.categoryId,
        }),
      });
      setSuccess("Medicine updated");
      setEditing(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update medicine");
    }
  };

  const deleteMedicine = async () => {
    if (!window.confirm(`Delete ${m.medicineName}? It can be restored from Audit Trail & Restore.`)) return;
    try {
      await api(`/medicines/${id}`, { method: "DELETE" });
      router.push("/medicines");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete medicine");
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/medicines" className="text-sm text-medflow-600 hover:underline">
          {isAdmin ? "Back to Medicine Master" : "Back to Medicines"}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{m.medicineName}</h1>
            <p className="text-muted-foreground">{m.genericName || "-"} | {m.category?.name || "Uncategorized"}</p>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={startEdit}>Edit Medicine</Button>
              <Button type="button" variant="destructive" onClick={deleteMedicine}>Delete Medicine</Button>
            </div>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      {editing && isAdmin && (
        <Card>
          <CardHeader><CardTitle>Edit Medicine</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={saveMedicine} className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Category *</Label>
                <select className="h-11 w-full rounded-lg border px-3" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })} required>
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Medicine Name *</Label>
                <Input value={form.medicineName} onChange={(e) => setForm({ ...form, medicineName: e.target.value })} required />
              </div>
              <div>
                <Label>Generic Name</Label>
                <Input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} />
              </div>
              <div>
                <Label>Dosage Form</Label>
                <Input value={form.dosageForm} onChange={(e) => setForm({ ...form, dosageForm: e.target.value })} />
              </div>
              <div>
                <Label>Stock Threshold</Label>
                <Input type="number" min={0} step={1} value={form.reorderThreshold} onChange={(e) => setForm({ ...form, reorderThreshold: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Lead Time</Label>
                <Input type="number" min={0} step={1} value={form.leadTimeDays} onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })} />
              </div>
              <div>
                <Label>Minimum Order Level</Label>
                <Input type="number" min={0} step={1} value={form.minimumOrderLevel} onChange={(e) => setForm({ ...form, minimumOrderLevel: e.target.value })} />
              </div>
              <div>
                <Label>Strength</Label>
                <Input value={form.strength} placeholder="e.g. 500 mg" onChange={(e) => setForm({ ...form, strength: e.target.value })} />
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">Update Medicine</Button>
                <Button type="button" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Current stock" value={data.balance ?? "-"} />
        <Stat label="Inbound (30d)" value={data.stockAnalytics.inbound.monthly} />
        <Stat label="Outbound (30d)" value={data.stockAnalytics.outbound.monthly} />
        <Stat label="Stock Threshold" value={m.reorderThreshold} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Medicine Information</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Medicine Name" value={m.medicineName} />
            <Row label="Generic Name" value={m.genericName} />
            <Row label="Strength" value={strengthLabel(m)} />
            <Row label="Category" value={m.category?.name} />
            <Row label="Dosage Form" value={m.dosageForm} />
            <Row label="Stock Threshold" value={String(m.reorderThreshold)} />
            <Row label="Lead Time" value={m.leadTimeDays != null ? `${m.leadTimeDays} days` : null} />
            <Row label="Minimum Order Level" value={m.minimumOrderLevel != null ? String(m.minimumOrderLevel) : null} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Stock Movement</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <Metric label="Inbound today" value={data.stockAnalytics.inbound.daily} />
            <Metric label="Outbound today" value={data.stockAnalytics.outbound.daily} />
            <Metric label="Inbound weekly" value={data.stockAnalytics.inbound.weekly} />
            <Metric label="Outbound weekly" value={data.stockAnalytics.outbound.weekly} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Batches & Supply ({data.batches.length})</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-2">Batch</th>
                <th className="p-2">Facility</th>
                <th className="p-2">On hand</th>
                <th className="p-2">Inbound (30d)</th>
                <th className="p-2">Outbound (30d)</th>
                <th className="p-2">Expiry</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.map((b) => (
                <tr key={b.id} className="border-b">
                  <td className="p-2 font-mono text-xs">{b.batchNumber}</td>
                  <td className="p-2">{b.facility.name}</td>
                  <td className="p-2 font-medium">{b.quantity}</td>
                  <td className="p-2">{b.inbound30d}</td>
                  <td className="p-2">{b.outbound30d}</td>
                  <td className="p-2">{new Date(b.expiryDate).toLocaleDateString()}</td>
                  <td className="p-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityClass(b.severity)}`}>{b.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Recent Outbound Activities</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-2">Activity</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Batch</th>
                <th className="p-2">Facility</th>
                <th className="p-2">By</th>
                <th className="p-2">When</th>
              </tr>
            </thead>
            <tbody>
              {(data.outboundActivities ?? []).slice(0, 15).map((a) => (
                <tr key={a.id} className="border-b">
                  <td className="p-2">{formatActivityType(a.activityType)}</td>
                  <td className="p-2">{a.quantity}</td>
                  <td className="p-2 font-mono text-xs">{a.batchNumber ?? "-"}</td>
                  <td className="p-2">{a.facility}</td>
                  <td className="p-2">{a.performedBy ?? "-"}</td>
                  <td className="p-2">{new Date(a.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-2xl font-bold text-medflow-700">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value || "-"}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

function formatActivityType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityClass(s: string) {
  if (s === "expired") return "bg-slate-200 text-slate-700";
  if (s === "critical") return "bg-red-100 text-red-700";
  if (s === "warning") return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}
