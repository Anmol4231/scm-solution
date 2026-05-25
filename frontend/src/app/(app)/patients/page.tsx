"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Patient {
  id: string;
  patientId: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number;
  phoneNumber?: string;
}

export default function PatientsPage() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", gender: "Female", age: 30, phoneNumber: "", address: "" });

  const load = () => api<Patient[]>(`/patients?q=${encodeURIComponent(q)}`).then(setPatients);
  useEffect(() => { load(); }, []);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/patients", { method: "POST", body: JSON.stringify(form) });
    setShowForm(false);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Patients</h1>
        <Button size="lg" onClick={() => setShowForm(!showForm)}>+ Register Patient</Button>
      </div>

      <form onSubmit={search} className="flex gap-2">
        <Input placeholder="Search name, ID, phone..." value={q} onChange={(e) => setQ(e.target.value)} className="flex-1" />
        <Button type="submit">Search</Button>
      </form>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>New Patient</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={register} className="grid gap-3 md:grid-cols-2">
              <div><Label>First name</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required /></div>
              <div><Label>Last name</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required /></div>
              <div><Label>Gender</Label><select className="h-11 w-full rounded-lg border px-3" value={form.gender} onChange={(e) => setForm({ ...form, gender: e.target.value })}><option>Female</option><option>Male</option><option>Other</option></select></div>
              <div><Label>Age</Label><Input type="number" value={form.age} onChange={(e) => setForm({ ...form, age: +e.target.value })} required /></div>
              <div><Label>Phone</Label><Input value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} /></div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <Button type="submit" size="lg" className="md:col-span-2">Save Patient</Button>
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
                  <p className="text-sm text-muted-foreground">{p.patientId} · {p.gender}, {p.age}y</p>
                </div>
                <span className="text-medflow-600">View →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
