"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Worker {
  id: string;
  workerId: string;
  firstName: string;
  lastName: string;
  department: string;
  role: string;
  phone?: string;
  status: string;
}

const ROLES = ["Nurse", "Doctor", "Lab Technician", "Pharmacist", "Community Health Worker"];

export default function HealthcareWorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    workerId: "",
    firstName: "",
    lastName: "",
    department: "",
    role: "Nurse",
    phone: "",
  });
  const [success, setSuccess] = useState("");

  const load = (search = q) => {
    const params = search ? `?q=${encodeURIComponent(search)}` : "";
    api<Worker[]>(`/healthcare-workers${params}`).then(setWorkers);
  };

  useEffect(() => {
    load();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/healthcare-workers", { method: "POST", body: JSON.stringify(form) });
    setSuccess(`Registered ${form.firstName} ${form.lastName}`);
    setShowForm(false);
    setForm({ workerId: "", firstName: "", lastName: "", department: "", role: "Nurse", phone: "" });
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Healthcare Workers</h1>
          <p className="text-sm text-muted-foreground">Staff eligible for internal medicine dispensing</p>
        </div>
        <Button size="lg" onClick={() => setShowForm(!showForm)}>+ Register Worker</Button>
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
        className="flex gap-2"
      >
        <Input placeholder="Search by name, ID, department..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-md" />
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>Register Healthcare Worker</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
              <div><Label>Worker ID</Label><Input value={form.workerId} onChange={(e) => setForm({ ...form, workerId: e.target.value })} placeholder="HW-001" required /></div>
              <div><Label>Department</Label><Input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder="Maternity" required /></div>
              <div><Label>First name</Label><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required /></div>
              <div><Label>Last name</Label><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required /></div>
              <div>
                <Label>Role / designation</Label>
                <select className="h-11 w-full rounded-lg border px-3" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <Button type="submit" className="md:col-span-2">Register</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left">
              <th className="p-3">Worker ID</th>
              <th className="p-3">Name</th>
              <th className="p-3">Department</th>
              <th className="p-3">Role</th>
              <th className="p-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {workers.map((w) => (
              <tr key={w.id} className="border-b hover:bg-slate-50">
                <td className="p-3 font-mono text-xs">{w.workerId}</td>
                <td className="p-3 font-medium">{w.firstName} {w.lastName}</td>
                <td className="p-3">{w.department}</td>
                <td className="p-3">{w.role}</td>
                <td className="p-3">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${w.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                    {w.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
