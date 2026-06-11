"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationsTabs } from "@/components/layout/operations-tabs";
import { sanitizePersonName, sanitizePhone, validators } from "@/lib/validation";

interface Patient {
  id: string;
  patientId: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number;
  phoneNumber?: string;
}

const EMPTY = { firstName: "", lastName: "", gender: "Female", age: "", phoneNumber: "", address: "", allergies: "" };

export default function PatientsPage() {
  const hasAccess = useRequirePermission("patients");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = () => api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`).then(setPatients);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const search = (e: React.FormEvent) => { e.preventDefault(); load(); };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const f = validators.personName(form.firstName, "First name"); if (f) return setError(f);
    const l = validators.personName(form.lastName, "Last name"); if (l) return setError(l);
    const a = validators.age(form.age); if (a) return setError(a);
    const p = validators.phone(form.phoneNumber); if (p) return setError(p);
    try {
      await api("/patients", { method: "POST", body: JSON.stringify({ ...form, age: Number(form.age), allergies: form.allergies.trim() || undefined }) });
      setSuccess(`Patient ${form.firstName} ${form.lastName} registered.`);
      setForm(EMPTY);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to register patient");
    }
  };

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      <OperationsTabs />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={search} className="flex flex-1 gap-2 sm:max-w-md">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search by name, patient ID, or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <Button onClick={() => { setShowForm((s) => !s); setError(""); }}>
          <Plus className="mr-2 h-4 w-4" /> Register Patient
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Patient</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={register} className="grid gap-3 md:grid-cols-2">
              <div><Label>First name *</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: sanitizePersonName(e.target.value) })} /></div>
              <div><Label>Last name *</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: sanitizePersonName(e.target.value) })} /></div>
              <div>
                <Label>Gender</Label>
                <select className="h-11 w-full rounded-lg border px-3 text-sm" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}>
                  <option>Female</option><option>Male</option><option>Other</option>
                </select>
              </div>
              <div><Label>Age *</Label><Input inputMode="numeric" value={form.age} onChange={(e) => setForm({ ...form, age: e.target.value.replace(/\D/g, "") })} /></div>
              <div><Label>Phone</Label><Input inputMode="tel" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: sanitizePhone(e.target.value) })} placeholder="Phone number" /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div className="md:col-span-2"><Label>Known allergies</Label><Input value={form.allergies} onChange={(e) => setForm({ ...form, allergies: e.target.value })} placeholder='e.g. "Penicillin" — leave blank if none known' /></div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">Save Patient</Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setForm(EMPTY); }}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {patients.map((p) => (
          <Link key={p.id} href={`/patients/${p.id}`}>
            <Card className="transition hover:border-medflow-300">
              <CardContent className="flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">{p.firstName} {p.lastName}</p>
                  <p className="text-sm text-muted-foreground">{p.patientId} · {p.gender}, {p.age}y{p.phoneNumber ? ` · ${p.phoneNumber}` : ""}</p>
                </div>
                <span className="text-medflow-600">View →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
        {patients.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No patients found.</p>}
      </div>
    </div>
  );
}
