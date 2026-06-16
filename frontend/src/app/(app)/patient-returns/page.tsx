"use client";

import { useEffect, useState } from "react";
import { Search, User as UserIcon, X } from "lucide-react";
import { OperationsTabs } from "@/components/layout/operations-tabs";
import { api } from "@/lib/api";
import { can } from "@/lib/permissions";
import { useAuth } from "@/lib/auth-context";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";
import { formatDateTime } from "@/lib/datetime";

interface Patient {
  id: string;
  patientId: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number;
  phoneNumber?: string;
}

interface Medicine { id: string; medicineName: string }

interface DispenseRecord {
  id: string;
  medicineId: string;
  batchNumber: string;
  quantity: number;
  dispensedAt: string;
  medicine: { medicineName: string };
}

interface ReturnRecord {
  id: string;
  quantity: number;
  returnReason: string;
  batchNumber?: string | null;
  createdAt: string;
  medicine: { medicineName: string };
  processedBy?: { firstName: string; lastName: string } | null;
}

const emptyForm = { dispensingRecordId: "", medicineId: "", quantity: 0, condition: "UNOPENED", returnReason: "No longer needed", batchNumber: "" };

export default function MedicinesReturnByPatientsPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("returns");
  const canCreate = can(user?.permissions, "returns", "create");

  const [medicines, setMedicines] = useState<Medicine[]>([]);

  // Patient search + selection
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Patient | null>(null);

  // Selected patient's data
  const [dispenseRecords, setDispenseRecords] = useState<DispenseRecord[]>([]);
  const [patientReturns, setPatientReturns] = useState<ReturnRecord[]>([]);

  // Return form
  const [form, setForm] = useState(emptyForm);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Medicine[]>("/medicines").then(setMedicines).catch(() => {});
  }, []);

  const searchPatients = (e?: React.FormEvent) => {
    e?.preventDefault();
    setSearching(true);
    api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`)
      .then(setResults)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to search patients"))
      .finally(() => setSearching(false));
  };
  // Load an initial list so registered patients are visible without searching first.
  useEffect(() => { searchPatients(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPatient = (p: Patient) => {
    setSelected(p);
    setForm(emptyForm);
    setMsg(""); setError("");
    api<DispenseRecord[]>(`/dispensing?patientId=${p.id}`).then(setDispenseRecords).catch(() => setDispenseRecords([]));
    api<ReturnRecord[]>(`/returns?patientId=${p.id}`).then(setPatientReturns).catch(() => setPatientReturns([]));
  };

  const clearPatient = () => { setSelected(null); setDispenseRecords([]); setPatientReturns([]); setForm(emptyForm); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setError(""); setMsg(""); setBusy(true);
    try {
      await api("/returns/patient", {
        method: "POST",
        body: JSON.stringify({ patientId: selected.id, ...form, quantity: +form.quantity }),
      });
      setMsg("Patient return processed successfully.");
      setForm(emptyForm);
      // Refresh the patient's records.
      api<DispenseRecord[]>(`/dispensing?patientId=${selected.id}`).then(setDispenseRecords).catch(() => {});
      api<ReturnRecord[]>(`/returns?patientId=${selected.id}`).then(setPatientReturns).catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to process return");
    } finally {
      setBusy(false);
    }
  };

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      <OperationsTabs />
      <div>
        <h1 className="text-2xl font-bold">Patient Returns</h1>
        <p className="text-sm text-slate-500">Search a registered patient and record medicines returned to the facility.</p>
      </div>

      {msg && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {!selected ? (
        /* ── Patient picker ── */
        <Card>
          <CardHeader><CardTitle>Select a Patient</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <form onSubmit={searchPatients} className="flex gap-2 sm:max-w-md">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input className="pl-9" placeholder="Search by name, patient ID, or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <Button type="submit" variant="outline" disabled={searching}>{searching ? "Searching…" : "Search"}</Button>
            </form>

            <div className="space-y-2">
              {results.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPatient(p)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border bg-white p-3 text-left transition hover:border-medflow-300 hover:bg-slate-50"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-medflow-50 text-medflow-600">
                      <UserIcon className="h-4 w-4" />
                    </span>
                    <div>
                      <p className="font-semibold text-slate-900">{p.firstName} {p.lastName}</p>
                      <p className="text-sm text-slate-500">{p.patientId} · {p.gender}, {p.age}y{p.phoneNumber ? ` · ${p.phoneNumber}` : ""}</p>
                    </div>
                  </div>
                  <span className="text-sm font-medium text-medflow-600">Select →</span>
                </button>
              ))}
              {!searching && results.length === 0 && (
                <p className="py-6 text-center text-sm text-slate-400">No patients found.</p>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Selected patient ── */}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-medflow-50 text-medflow-600">
                  <UserIcon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-lg font-semibold">{selected.firstName} {selected.lastName}</p>
                  <p className="text-sm text-slate-500">
                    {selected.patientId} · {selected.gender}, {selected.age}y{selected.phoneNumber ? ` · ${selected.phoneNumber}` : ""}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={clearPatient}>
                <X className="mr-1 h-3.5 w-3.5" /> Change Patient
              </Button>
            </CardContent>
          </Card>

          {/* ── Return form ── */}
          {canCreate && (
            <Card>
              <CardHeader><CardTitle>Record Return</CardTitle></CardHeader>
              <CardContent>
                <form onSubmit={submit} className="space-y-3">
                  {dispenseRecords.length > 0 && (
                    <div>
                      <Label>Original Dispensing Record (optional)</Label>
                      <select
                        className="mt-1 h-10 w-full rounded-lg border px-3 text-sm"
                        value={form.dispensingRecordId}
                        onChange={(e) => {
                          const rec = dispenseRecords.find((r) => r.id === e.target.value);
                          setForm({
                            ...form,
                            dispensingRecordId: e.target.value,
                            medicineId: rec?.medicineId ?? form.medicineId,
                            batchNumber: rec?.batchNumber ?? form.batchNumber,
                            quantity: rec?.quantity ?? form.quantity,
                          });
                        }}
                      >
                        <option value="">Select dispensing record…</option>
                        {dispenseRecords.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.medicine.medicineName} — {r.quantity} units — {new Date(r.dispensedAt).toLocaleDateString()}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div>
                    <Label>Medicine *</Label>
                    <MedicineCombobox medicines={medicines} value={form.medicineId} onChange={(id) => setForm({ ...form, medicineId: id })} className="mt-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Quantity *</Label><Input type="number" min={1} value={form.quantity || ""} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} required /></div>
                    <div><Label>Batch Number</Label><Input value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} /></div>
                  </div>
                  <div>
                    <Label>Condition</Label>
                    <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                      <option value="UNOPENED">Unopened</option>
                      <option value="OPENED_UNDAMAGED">Opened but undamaged</option>
                      <option value="DAMAGED_CONTAMINATED">Damaged / Contaminated</option>
                    </select>
                  </div>
                  <div>
                    <Label>Reason</Label>
                    <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={form.returnReason} onChange={(e) => setForm({ ...form, returnReason: e.target.value })}>
                      <option>No longer needed</option>
                      <option>Wrong medication dispensed</option>
                      <option>Patient refused medication</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <Button type="submit" disabled={busy || !form.medicineId}>{busy ? "Processing…" : "Process Patient Return"}</Button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* ── This patient's previous returns ── */}
          <Card>
            <CardHeader><CardTitle>Previous Returns</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <th className="p-3">Medicine</th>
                    <th className="p-3 text-right">Qty</th>
                    <th className="p-3">Batch</th>
                    <th className="p-3">Reason</th>
                    <th className="p-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {patientReturns.map((r) => (
                    <tr key={r.id}>
                      <td className="p-3 font-medium">{r.medicine?.medicineName ?? "—"}</td>
                      <td className="p-3 text-right">{r.quantity}</td>
                      <td className="p-3 text-slate-600">{r.batchNumber ?? "—"}</td>
                      <td className="p-3 text-slate-600">{r.returnReason}</td>
                      <td className="p-3 whitespace-nowrap text-slate-500">{formatDateTime(r.createdAt)}</td>
                    </tr>
                  ))}
                  {patientReturns.length === 0 && (
                    <tr><td colSpan={5} className="p-6 text-center text-slate-400">No previous returns for this patient.</td></tr>
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
