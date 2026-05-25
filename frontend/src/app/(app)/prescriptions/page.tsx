"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const API_BASE = process.env.NEXT_PUBLIC_API_URL?.replace("/api", "") || "http://localhost:4000";

export default function PrescriptionsPage() {
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const [patients, setPatients] = useState<{ id: string; firstName: string; lastName: string; patientId: string }[]>([]);
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [template, setTemplate] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState({
    patientId: "",
    doctorName: "",
    department: "",
    diagnosisNotes: "",
    symptoms: "",
    followUpDate: "",
    allergies: "",
    prescriptionNotes: "",
    priority: "ROUTINE",
    medicineId: "",
    dosage: "",
    quantity: 0,
  });

  useEffect(() => {
    api("/prescriptions").then(setList);
    api("/patients").then(setPatients);
    api("/medicines").then(setMedicines);
    api("/prescriptions/sample-template").then(setTemplate).catch(() => null);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => {
      if (v) fd.append(k, String(v));
    });
    if (form.medicineId) {
      fd.append("medicines", JSON.stringify([{ medicineId: form.medicineId, dosage: form.dosage, quantity: form.quantity }]));
    }
    if (file) fd.append("prescription", file);
    await api("/prescriptions", { method: "POST", body: fd });
    setShowForm(false);
    api("/prescriptions").then(setList);
  };

  const applyTemplate = () => {
    if (!template?.template) return;
    const t = template.template as Record<string, string>;
    setForm((f) => ({
      ...f,
      doctorName: t.doctorName || f.doctorName,
      department: t.department || f.department,
      diagnosisNotes: t.diagnosis || f.diagnosisNotes,
      symptoms: t.symptoms || f.symptoms,
      followUpDate: t.followUpDate || f.followUpDate,
      allergies: t.allergies || f.allergies,
      prescriptionNotes: t.notes || f.prescriptionNotes,
      priority: t.priority || f.priority,
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Prescriptions</h1>
          <p className="text-sm text-muted-foreground">Upload JPG, PNG, or PDF prescription scans</p>
        </div>
        <Button size="lg" onClick={() => setShowForm(!showForm)}>+ Upload Prescription</Button>
      </div>

      {template && (
        <Card className="border-dashed">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-sm">
              <p className="font-medium">Sample prescription template</p>
              <p className="text-muted-foreground">Use as a guide for demo uploads (doctor, diagnosis, medicines)</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={applyTemplate}>Fill form from template</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showForm && (
        <Card>
          <CardHeader><CardTitle>New Prescription</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Patient</Label>
                <select className="h-11 w-full rounded-lg border px-3" value={form.patientId} onChange={(e) => setForm({ ...form, patientId: e.target.value })} required>
                  <option value="">Select</option>
                  {patients.map((p) => <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.patientId})</option>)}
                </select>
              </div>
              <div><Label>Doctor name</Label><Input value={form.doctorName} onChange={(e) => setForm({ ...form, doctorName: e.target.value })} /></div>
              <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="OPD, Pediatrics" /></div>
              <div><Label>Diagnosis</Label><Input value={form.diagnosisNotes} onChange={(e) => setForm({ ...form, diagnosisNotes: e.target.value })} /></div>
              <div><Label>Symptoms</Label><Input value={form.symptoms} onChange={(e) => setForm({ ...form, symptoms: e.target.value })} /></div>
              <div><Label>Follow-up date</Label><Input type="date" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} /></div>
              <div><Label>Allergies</Label><Input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} /></div>
              <div>
                <Label>Priority</Label>
                <select className="h-11 w-full rounded-lg border px-3" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="ROUTINE">Routine</option>
                  <option value="URGENT">Urgent</option>
                  <option value="EMERGENCY">Emergency</option>
                </select>
              </div>
              <div className="md:col-span-2"><Label>Prescription notes</Label><Input value={form.prescriptionNotes} onChange={(e) => setForm({ ...form, prescriptionNotes: e.target.value })} /></div>
              <div>
                <Label>Medicine (optional)</Label>
                <select className="h-11 w-full rounded-lg border px-3" value={form.medicineId} onChange={(e) => setForm({ ...form, medicineId: e.target.value })}>
                  <option value="">None</option>
                  {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
                </select>
              </div>
              <div><Label>Dosage</Label><Input value={form.dosage} onChange={(e) => setForm({ ...form, dosage: e.target.value })} /></div>
              <div className="md:col-span-2">
                <Label>Upload prescription (JPG, PNG, PDF)</Label>
                <Input type="file" accept="image/jpeg,image/png,image/jpg,.pdf,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </div>
              <Button type="submit" className="md:col-span-2" size="lg">Save Prescription</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {list.map((rx) => {
        const r = rx as {
          id: string;
          prescriptionId: string;
          patient: { firstName: string; lastName: string };
          doctorName?: string;
          department?: string;
          diagnosisNotes?: string;
          priority?: string;
          status: string;
          prescriptionDate: string;
          uploadedPrescriptionUrl?: string;
        };
        return (
          <Card key={r.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{r.prescriptionId}</p>
                  <p className="text-sm">{r.patient?.firstName} {r.patient?.lastName} — {r.doctorName || "N/A"}</p>
                  <p className="text-xs text-muted-foreground">{r.department} · {r.diagnosisNotes}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.priority === "EMERGENCY" ? "bg-red-100 text-red-700" : r.priority === "URGENT" ? "bg-amber-100 text-amber-700" : "bg-slate-100"}`}>
                  {r.priority || "ROUTINE"}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{r.status} · {new Date(r.prescriptionDate).toLocaleDateString()}</p>
              {r.uploadedPrescriptionUrl && (
                <a href={`${API_BASE}${r.uploadedPrescriptionUrl}`} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-medflow-600 hover:underline">
                  View uploaded file →
                </a>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
