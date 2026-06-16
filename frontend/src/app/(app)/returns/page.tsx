"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";
import { formatDateTime } from "@/lib/datetime";

interface Facility { id: string; name: string; code: string; facilityType: string }
interface Medicine { id: string; medicineName: string }
interface ReturnRecord {
  id: string;
  returnType: string;
  quantity: number;
  returnReason: string;
  batchNumber?: string | null;
  createdAt: string;
  medicine: { medicineName: string };
  patient?: { firstName: string; lastName: string; patientId: string } | null;
  processedBy?: { firstName: string; lastName: string } | null;
}

const STORE_TYPES = ["AMS_CENTRAL", "MEDICAL_STORE", "WAREHOUSE", "REGIONAL_STORE"];

const TYPE_LABEL: Record<string, string> = {
  FACILITY_TO_AMS: "→ AMS",
  INTER_FACILITY: "Transfer Return",
};
const TYPE_COLOR: Record<string, string> = {
  FACILITY_TO_AMS: "bg-purple-100 text-purple-700",
  INTER_FACILITY: "bg-teal-100 text-teal-700",
};

const emptyAms = { receivingFacilityId: "", medicineId: "", batchNumber: "", expiryDate: "", quantity: 0, returnReason: "Near expiry" };

export default function ReturnsPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("returns");
  const isAdmin = isAdminDashboardRole(user?.role);
  const canCreate = can(user?.permissions, "returns", "create");

  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [facilityFilter, setFacilityFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [ams, setAms] = useState(emptyAms);

  const load = () => {
    const params = new URLSearchParams();
    if (isAdmin && facilityFilter) params.set("facilityId", facilityFilter);
    api<ReturnRecord[]>(`/returns?${params}`).then((r) => setReturns(r.filter((x) => x.returnType !== "PATIENT_RETURN"))).catch(() => {});
  };

  useEffect(() => { load(); }, [facilityFilter, isAdmin]);
  useEffect(() => {
    api<Medicine[]>("/medicines").then(setMedicines).catch(() => {});
    api<Facility[]>("/auth/facilities").then(setAllFacilities).catch(() => {});
  }, []);

  if (!hasAccess) return null;

  const amsFacilities = allFacilities.filter((f) => STORE_TYPES.includes(f.facilityType));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setMsg(""); setBusy(true);
    try {
      await api("/returns/facility", {
        method: "POST",
        body: JSON.stringify({ returnType: "FACILITY_TO_AMS", ...ams, quantity: +ams.quantity }),
      });
      setMsg("Return to AMS processed successfully.");
      setShowForm(false);
      setAms(emptyAms);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to process return");
    } finally {
      setBusy(false);
    }
  };

  const personName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : "—");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 text-2xl font-bold">Returns to AMS</h1>
          <p className="text-sm text-slate-500">
            {isAdmin
              ? facilityFilter ? allFacilities.find((f) => f.id === facilityFilter)?.name : "All Facilities"
              : user?.facility?.name ?? "Assigned facility"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select className="h-10 rounded-lg border px-3 text-sm" value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)}>
              <option value="">All Facilities</option>
              {allFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
            </select>
          )}
          {canCreate && (
            <Button size="lg" onClick={() => { setShowForm((s) => !s); setError(""); setMsg(""); }}>
              {showForm ? "Close" : "+ Return to AMS"}
            </Button>
          )}
        </div>
      </div>


      {msg && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* New Return to AMS form */}
      {showForm && canCreate && (
        <Card>
          <CardHeader><CardTitle>Return to AMS</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              <div>
                <Label>Receiving AMS / Medical Store *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={ams.receivingFacilityId} onChange={(e) => setAms({ ...ams, receivingFacilityId: e.target.value })} required>
                  <option value="">Select AMS…</option>
                  {amsFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.facilityType})</option>)}
                </select>
              </div>
              <div>
                <Label>Medicine *</Label>
                <MedicineCombobox medicines={medicines} value={ams.medicineId} onChange={(id) => setAms({ ...ams, medicineId: id })} className="mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Batch Number *</Label><Input value={ams.batchNumber} onChange={(e) => setAms({ ...ams, batchNumber: e.target.value })} required /></div>
                <div><Label>Expiry Date *</Label><Input type="date" value={ams.expiryDate} onChange={(e) => setAms({ ...ams, expiryDate: e.target.value })} required /></div>
                <div><Label>Quantity *</Label><Input type="number" min={1} value={ams.quantity || ""} onChange={(e) => setAms({ ...ams, quantity: +e.target.value })} required /></div>
              </div>
              <div>
                <Label>Return Reason *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={ams.returnReason} onChange={(e) => setAms({ ...ams, returnReason: e.target.value })}>
                  <option>Near expiry</option>
                  <option>Surplus stock</option>
                  <option>Product recall</option>
                  <option>Damaged</option>
                  <option>Other</option>
                </select>
              </div>
              <p className="text-sm text-slate-500">Stock will be immediately decremented from your facility and credited to the AMS.</p>
              <Button type="submit" disabled={busy}>Process Return to AMS</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Returns history */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Type</th>
                <th className="p-3">Medicine</th>
                <th className="p-3 text-right">Qty</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Processed By</th>
                <th className="p-3">Date</th>
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id} className="border-b align-middle">
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${TYPE_COLOR[r.returnType] ?? "bg-slate-100 text-slate-600"}`}>
                      {TYPE_LABEL[r.returnType] ?? r.returnType.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-3 font-medium">{r.medicine?.medicineName ?? "—"}</td>
                  <td className="p-3 text-right">{r.quantity}</td>
                  <td className="p-3 text-slate-600">{r.returnReason}</td>
                  <td className="p-3 text-slate-600">{personName(r.processedBy)}</td>
                  <td className="p-3 whitespace-nowrap text-slate-500">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
              {returns.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No returns recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
