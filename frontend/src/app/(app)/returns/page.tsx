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

type FormType = "patient" | "ams";

interface Facility { id: string; name: string; code: string; facilityType: string }
interface Medicine { id: string; medicineName: string }
interface DispenseRecord { id: string; medicineId: string; batchNumber: string; quantity: number; dispensedAt: string; medicine: { medicineName: string } }
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
  PATIENT_RETURN: "Patient",
  FACILITY_TO_AMS: "→ AMS",
  INTER_FACILITY: "Inter-Facility",
};
const TYPE_COLOR: Record<string, string> = {
  PATIENT_RETURN: "bg-blue-100 text-blue-700",
  FACILITY_TO_AMS: "bg-purple-100 text-purple-700",
  INTER_FACILITY: "bg-teal-100 text-teal-700",
};

const emptyPatient = { patientId: "", dispensingRecordId: "", medicineId: "", quantity: 0, condition: "UNOPENED", returnReason: "No longer needed", batchNumber: "" };
const emptyAms = { receivingFacilityId: "", medicineId: "", batchNumber: "", expiryDate: "", quantity: 0, returnReason: "Near expiry" };

export default function ReturnsPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("returns");
  const isAdmin = isAdminDashboardRole(user?.role);
  const canCreate = can(user?.permissions, "returns", "create");

  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [dispenseRecords, setDispenseRecords] = useState<DispenseRecord[]>([]);
  const [facilityFilter, setFacilityFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState<FormType>("patient");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [patient, setPatient] = useState(emptyPatient);
  const [ams, setAms] = useState(emptyAms);

  const load = () => {
    const params = new URLSearchParams();
    if (isAdmin && facilityFilter) params.set("facilityId", facilityFilter);
    api<ReturnRecord[]>(`/returns?${params}`).then(setReturns).catch(() => {});
  };

  useEffect(() => { load(); }, [facilityFilter, isAdmin]);
  useEffect(() => {
    api<Medicine[]>("/medicines").then(setMedicines).catch(() => {});
    api<Facility[]>("/auth/facilities").then(setAllFacilities).catch(() => {});
  }, []);

  if (!hasAccess) return null;

  const loadDispenseRecords = (patientId: string) => {
    if (!patientId) return;
    api<DispenseRecord[]>(`/dispensing?patientId=${patientId}`).then(setDispenseRecords).catch(() => {});
  };

  const amsFacilities = allFacilities.filter((f) => STORE_TYPES.includes(f.facilityType));

  const resetForms = () => {
    setPatient(emptyPatient); setAms(emptyAms); setDispenseRecords([]);
  };

  const submit = async (endpoint: string, body: object) => {
    setError(""); setMsg(""); setBusy(true);
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify(body) });
      setMsg("Return processed successfully.");
      setShowForm(false);
      resetForms();
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to process return");
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
          <h1 className="mt-1 text-2xl font-bold">Returns</h1>
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
              {showForm ? "Close" : "+ New Return"}
            </Button>
          )}
        </div>
      </div>

      {msg && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* New Return form */}
      {showForm && canCreate && (
        <Card>
          <CardHeader><CardTitle>New Return</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {([["patient", "Patient Return"], ["ams", "Facility → AMS"]] as const).map(([t, label]) => (
                <button key={t} type="button" onClick={() => setFormType(t)}
                  className={`rounded-full px-3 py-1 text-sm font-medium ${formType === t ? "bg-medflow-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Patient Return */}
            {formType === "patient" && (
              <form onSubmit={(e) => { e.preventDefault(); submit("/returns/patient", { ...patient, quantity: +patient.quantity }); }} className="space-y-3">
                <div>
                  <Label>Patient ID</Label>
                  <Input value={patient.patientId} onChange={(e) => { setPatient({ ...patient, patientId: e.target.value }); loadDispenseRecords(e.target.value); }} required />
                </div>
                {dispenseRecords.length > 0 && (
                  <div>
                    <Label>Original Dispensing Record (optional)</Label>
                    <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={patient.dispensingRecordId} onChange={(e) => {
                      const rec = dispenseRecords.find((r) => r.id === e.target.value);
                      setPatient({ ...patient, dispensingRecordId: e.target.value, medicineId: rec?.medicineId ?? patient.medicineId, batchNumber: rec?.batchNumber ?? patient.batchNumber, quantity: rec?.quantity ?? patient.quantity });
                    }}>
                      <option value="">Select dispensing record…</option>
                      {dispenseRecords.map((r) => <option key={r.id} value={r.id}>{r.medicine.medicineName} — {r.quantity} units — {new Date(r.dispensedAt).toLocaleDateString()}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <Label>Medicine</Label>
                  <MedicineCombobox medicines={medicines} value={patient.medicineId} onChange={(id) => setPatient({ ...patient, medicineId: id })} className="mt-1" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Quantity</Label><Input type="number" min={1} value={patient.quantity || ""} onChange={(e) => setPatient({ ...patient, quantity: +e.target.value })} required /></div>
                  <div><Label>Batch Number</Label><Input value={patient.batchNumber} onChange={(e) => setPatient({ ...patient, batchNumber: e.target.value })} /></div>
                </div>
                <div>
                  <Label>Condition</Label>
                  <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={patient.condition} onChange={(e) => setPatient({ ...patient, condition: e.target.value })}>
                    <option value="UNOPENED">Unopened</option>
                    <option value="OPENED_UNDAMAGED">Opened but undamaged</option>
                    <option value="DAMAGED_CONTAMINATED">Damaged / Contaminated</option>
                  </select>
                </div>
                <div>
                  <Label>Reason</Label>
                  <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={patient.returnReason} onChange={(e) => setPatient({ ...patient, returnReason: e.target.value })}>
                    <option>No longer needed</option>
                    <option>Wrong medication dispensed</option>
                    <option>Patient refused medication</option>
                    <option>Other</option>
                  </select>
                </div>
                <Button type="submit" disabled={busy}>Process Patient Return</Button>
              </form>
            )}

            {/* Facility → AMS Return */}
            {formType === "ams" && (
              <form onSubmit={(e) => { e.preventDefault(); submit("/returns/facility", { returnType: "FACILITY_TO_AMS", ...ams, quantity: +ams.quantity }); }} className="space-y-3">
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
            )}
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
