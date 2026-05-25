"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface PrescriptionOption {
  id: string;
  prescriptionId: string;
  status: string;
}

function DispenseForm() {
  const searchParams = useSearchParams();
  const [patients, setPatients] = useState<{ id: string; patientId: string; firstName: string; lastName: string }[]>([]);
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; batchNumber: string; expiryDate: string; quantity: number; medicineId: string }[]>([]);
  const [prescriptions, setPrescriptions] = useState<PrescriptionOption[]>([]);
  const [form, setForm] = useState({
    patientId: searchParams.get("patientId") || "",
    prescriptionId: "",
    medicineId: "",
    batchId: "",
    dosage: "",
    form: "Tablet",
    quantity: 1,
    duration: "",
    notes: "",
    dispensingPurpose: "",
    prescribingDepartment: "",
  });
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api("/patients").then(setPatients);
    api("/medicines").then(setMedicines);
  }, []);

  useEffect(() => {
    if (form.patientId) {
      api<PrescriptionOption[]>(`/prescriptions?patientId=${form.patientId}`)
        .then((list) => setPrescriptions(list.filter((rx) => rx.status === "ACTIVE")))
        .catch(() => setPrescriptions([]));
      setForm((f) => ({ ...f, prescriptionId: "" }));
    } else {
      setPrescriptions([]);
    }
  }, [form.patientId]);

  useEffect(() => {
    if (form.medicineId) {
      api(`/stock/balance?medicineId=${form.medicineId}`).then((res: { batches: typeof batches }) => {
        setBatches(res.batches || []);
        if (res.batches?.[0]) setForm((f) => ({ ...f, batchId: res.batches[0].id }));
      });
    }
  }, [form.medicineId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.prescriptionId) {
      setError("Please select an active prescription");
      return;
    }
    try {
      await api("/dispensing", { method: "POST", body: JSON.stringify(form) });
      setSuccess("Medicine dispensed to patient successfully!");
      setForm({ ...form, quantity: 1, notes: "", dispensingPurpose: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dispensing failed");
    }
  };

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Patient Dispensing</h1>
      <p className="text-sm text-muted-foreground">
        Patient-centric dispensing only. An active prescription is required for every issue.
      </p>
      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      <Card>
        <CardHeader><CardTitle>Dispense to Patient</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Patient *</Label>
              <select
                className="h-11 w-full rounded-lg border px-3"
                value={form.patientId}
                onChange={(e) => setForm({ ...form, patientId: e.target.value })}
                required
              >
                <option value="">Select patient</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.patientId})</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Prescription *</Label>
              <select
                className="h-11 w-full rounded-lg border px-3"
                value={form.prescriptionId}
                onChange={(e) => setForm({ ...form, prescriptionId: e.target.value })}
                required
                disabled={!form.patientId}
              >
                <option value="">{form.patientId ? "Select active prescription" : "Select patient first"}</option>
                {prescriptions.map((rx) => (
                  <option key={rx.id} value={rx.id}>{rx.prescriptionId}</option>
                ))}
              </select>
              {form.patientId && prescriptions.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">
                  No active prescription — <Link href="/prescriptions" className="underline">upload one</Link> first.
                </p>
              )}
            </div>
            <div>
              <Label>Medicine *</Label>
              <select className="h-11 w-full rounded-lg border px-3" value={form.medicineId} onChange={(e) => setForm({ ...form, medicineId: e.target.value, batchId: "" })} required>
                <option value="">Select medicine</option>
                {medicines.map((m) => (
                  <option key={m.id} value={m.id}>{m.medicineName}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Batch (FEFO) *</Label>
              <select className="h-11 w-full rounded-lg border px-3" value={form.batchId} onChange={(e) => setForm({ ...form, batchId: e.target.value })} required>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchNumber} — exp {new Date(b.expiryDate).toLocaleDateString()} — qty {b.quantity}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Dosage</Label><Input value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} placeholder="500mg" /></div>
              <div><Label>Form</Label><Input value={form.form} onChange={(e) => setForm({ ...form, form: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Quantity *</Label><Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} required /></div>
              <div><Label>Duration</Label><Input value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="5 days" /></div>
            </div>
            <div><Label>Dispensing purpose</Label><Input value={form.dispensingPurpose} onChange={(e) => setForm({ ...form, dispensingPurpose: e.target.value })} placeholder="Treatment, prophylaxis" /></div>
            <div><Label>Prescribing department</Label><Input value={form.prescribingDepartment} onChange={(e) => setForm({ ...form, prescribingDepartment: e.target.value })} placeholder="OPD, Maternity" /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            <Button type="submit" size="lg" className="w-full" disabled={!form.prescriptionId}>Confirm Dispensing</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DispensePage() {
  return (
    <Suspense fallback={<p>Loading...</p>}>
      <DispenseForm />
    </Suspense>
  );
}
