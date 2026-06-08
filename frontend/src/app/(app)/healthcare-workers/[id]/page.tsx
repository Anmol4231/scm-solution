"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizePersonName, sanitizePhone } from "@/lib/validation";

interface Worker {
  id: string;
  workerId: string;
  firstName: string;
  lastName: string;
  department: string;
  role: string;
  phone?: string | null;
  status: string;
}

const ROLES = ["Nurse", "Doctor", "Lab Technician", "Pharmacist", "Community Health Worker", "Clinical Officer", "Midwife"];

const EMPTY_FORM = { workerId: "", firstName: "", lastName: "", department: "", role: "Nurse", phone: "" };

export default function HealthcareWorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  const load = (search = q) => {
    const params = search ? `?q=${encodeURIComponent(search)}` : "";
    api<Worker[]>(`/healthcare-workers${params}`).then(setWorkers).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const startAdd = () => {
    setError(""); setSuccess("");
    setEditingId(null); setForm(EMPTY_FORM); setShowForm(true);
  };

  const startEdit = (w: Worker) => {
    setError(""); setSuccess("");
    setEditingId(w.id);
    setForm({ workerId: w.workerId, firstName: w.firstName, lastName: w.lastName, department: w.department, role: w.role, phone: w.phone ?? "" });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancel = () => { setEditingId(null); setForm(EMPTY_FORM); setShowForm(false); };

  const validate = (): string => {
    if (!form.workerId.trim()) return "Worker ID is required";
    if (!form.firstName.trim()) return "First name is required";
    if (!/[A-Za-z]/.test(form.firstName)) return "First name must contain letters";
    if (!form.lastName.trim()) return "Last name is required";
    if (!/[A-Za-z]/.test(form.lastName)) return "Last name must contain letters";
    if (!form.department.trim()) return "Department is required";
    return "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) return setError(err);
    setError(""); setSuccess(""); setBusy(true);
    try {
      const payload = {
        ...form,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        department: form.department.trim(),
        phone: form.phone.trim() || undefined,
      };
      if (editingId) {
        await api(`/healthcare-workers/${editingId}`, { method: "PATCH", body: JSON.stringify(payload) });
        setSuccess(`${form.firstName} ${form.lastName} updated`);
      } else {
        await api("/healthcare-workers", { method: "POST", body: JSON.stringify(payload) });
        setSuccess(`${form.firstName} ${form.lastName} registered`);
      }
      cancel(); load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save staff member");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w: Worker) => {
    if (!window.confirm(`Delete "${w.firstName} ${w.lastName}"? This cannot be undone.`)) return;
    setError(""); setSuccess("");
    try {
      await api(`/healthcare-workers/${w.id}`, { method: "DELETE" });
      setSuccess(`${w.firstName} ${w.lastName} deleted`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete staff member");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Staff</h1>
        <Button onClick={startAdd}><Plus className="mr-2 h-4 w-4" /> Register Staff</Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">{editingId ? "Edit Staff Member" : "Register Staff Member"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Worker ID *</Label>
                <Input
                  value={form.workerId}
                  placeholder="Worker ID"
                  disabled={!!editingId}
                  onChange={(e) => setForm({ ...form, workerId: e.target.value })}
                  required
                />
                {editingId && <p className="mt-1 text-sm text-slate-400">Worker ID cannot be changed.</p>}
              </div>
              <div>
                <Label>Role / Designation *</Label>
                <select className="h-11 w-full rounded-lg border px-3 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <Label>First name *</Label>
                <Input
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: sanitizePersonName(e.target.value) })}
                  required
                />
              </div>
              <div>
                <Label>Last name *</Label>
                <Input
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: sanitizePersonName(e.target.value) })}
                  required
                />
              </div>
              <div>
                <Label>Department *</Label>
                <Input value={form.department} placeholder="Department" onChange={(e) => setForm({ ...form, department: e.target.value })} required />
              </div>
              <div>
                <Label>Phone</Label>
                <Input
                  value={form.phone}
                  inputMode="tel"
                  placeholder="Phone number"
                  onChange={(e) => setForm({ ...form, phone: sanitizePhone(e.target.value) })}
                />
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" disabled={busy}>{busy ? "Saving…" : (editingId ? "Update" : "Register")}</Button>
                <Button type="button" variant="outline" onClick={cancel}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <form onSubmit={(e) => { e.preventDefault(); load(q); }} className="flex max-w-md gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input className="pl-9" placeholder="" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3 font-medium">Worker ID</th>
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Department</th>
                <th className="p-3 font-medium">Role</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="p-3 font-mono text-sm text-slate-600">{w.workerId}</td>
                  <td className="p-3 font-medium">{w.firstName} {w.lastName}</td>
                  <td className="p-3 text-slate-600">{w.department}</td>
                  <td className="p-3 text-slate-600">{w.role}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${w.status === "ACTIVE" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-600"}`}>
                      {w.status}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => startEdit(w)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => remove(w)}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {workers.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No staff members found.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
