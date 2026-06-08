"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function AdjustmentPage() {
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);
  const [systemBalance, setSystemBalance] = useState<number | null>(null);
  const [form, setForm] = useState({ medicineId: "", physicalCount: "", reason: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api("/medicines").then(setMedicines); }, []);

  useEffect(() => {
    setSystemBalance(null);
    if (form.medicineId) {
      api<{ balance: number }>(`/stock/balance?medicineId=${form.medicineId}`).then((r) => setSystemBalance(r.balance)).catch(() => setSystemBalance(null));
    }
  }, [form.medicineId]);

  const physical = form.physicalCount === "" ? null : Number(form.physicalCount);
  const discrepancy = systemBalance != null && physical != null ? physical - systemBalance : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.medicineId) return setError("Select a medicine");
    if (physical == null) return setError("Enter the physical count");
    if (!form.reason.trim()) return setError("A discrepancy reason is required");
    setBusy(true);
    try {
      await api("/stock/adjustment", {
        method: "POST",
        body: JSON.stringify({ medicineId: form.medicineId, physicalCount: physical, reason: form.reason.trim() }),
      });
      const name = medicines.find((m) => m.id === form.medicineId)?.medicineName ?? "medicine";
      setSuccess(`Adjusted ${name} to a balance of ${physical}.`);
      setForm({ medicineId: "", physicalCount: "", reason: "" });
      setSystemBalance(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save adjustment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
      <h1 className="text-2xl font-bold">Physical Adjustment</h1>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Medicine *</Label>
              <select className="h-11 w-full rounded-lg border px-3" value={form.medicineId} onChange={(e) => setForm({ ...form, medicineId: e.target.value })} required>
                <option value="">Select medicine</option>
                {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
              </select>
            </div>
            {systemBalance != null && (
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-lg bg-slate-100 px-3 py-4">
                  <p className="mb-1 text-sm text-slate-500">System balance</p>
                  <p className="text-xl font-bold tabular-nums text-slate-700">{systemBalance}</p>
                </div>
                <div className="rounded-lg bg-slate-100 px-3 py-4">
                  <p className="mb-1 text-sm text-slate-500">Physical count</p>
                  <p className="text-xl font-bold tabular-nums text-slate-700">{physical ?? "—"}</p>
                </div>
                <div className={`rounded-lg px-3 py-4 ${discrepancy == null ? "bg-slate-100" : discrepancy === 0 ? "bg-emerald-50" : "bg-amber-50"}`}>
                  <p className="mb-1 text-sm text-slate-500">Difference</p>
                  <p className={`text-xl font-bold tabular-nums ${discrepancy == null ? "text-slate-700" : discrepancy === 0 ? "text-emerald-700" : "text-amber-700"}`}>
                    {discrepancy == null ? "—" : discrepancy > 0 ? `+${discrepancy}` : discrepancy}
                  </p>
                </div>
              </div>
            )}
            <div><Label>Physical count *</Label><Input inputMode="numeric" value={form.physicalCount} onChange={(e) => setForm({ ...form, physicalCount: e.target.value.replace(/\D/g, "") })} placeholder="counted quantity" required /></div>
            <div><Label>Discrepancy reason *</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for adjustment" required /></div>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save Adjustment"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
