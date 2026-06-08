"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function RecordConsumptionPage() {
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [form, setForm] = useState({ medicineId: "", quantityUsed: "", reportingPeriod: new Date().toISOString().slice(0, 7) });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api("/medicines").then(setMedicines); }, []);

  useEffect(() => {
    setBalance(null);
    if (form.medicineId) {
      api<{ balance: number }>(`/stock/balance?medicineId=${form.medicineId}`).then((r) => setBalance(r.balance)).catch(() => setBalance(null));
    }
  }, [form.medicineId]);

  const qty = Number(form.quantityUsed) || 0;
  const resultingBalance = balance != null ? balance - qty : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!form.medicineId) return setError("Select a medicine");
    if (qty <= 0) return setError("Enter a quantity greater than zero");
    if (balance != null && qty > balance) return setError(`Only ${balance} in stock — cannot record more than is available`);
    setBusy(true);
    try {
      await api("/stock/consumption", {
        method: "POST",
        body: JSON.stringify({ medicineId: form.medicineId, quantityUsed: qty, reportingPeriod: form.reportingPeriod }),
      });
      const name = medicines.find((m) => m.id === form.medicineId)?.medicineName ?? "medicine";
      setSuccess(`Recorded ${qty} unit(s) of ${name} as consumed for ${form.reportingPeriod}. Stock updated.`);
      setForm((f) => ({ ...f, medicineId: "", quantityUsed: "" }));
      setBalance(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record consumption");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
      <h1 className="text-2xl font-bold">Record Consumption</h1>

      <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-3 text-sm text-slate-700">
        Use this to deduct stock <strong>used in bulk</strong> — ward stock, clinic/internal use, or training — that is{" "}
        <strong>not dispensed to an individual patient</strong>. The quantity is removed from stock, earliest-expiry batch
        first (FEFO). To issue medicine to a patient, use{" "}
        <Link href="/dispense" className="font-medium text-medflow-600 hover:underline">Dispense Medicine</Link> instead.
      </div>

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
              {balance != null && (
                <p className="mt-1 text-sm text-muted-foreground">In stock now: <strong>{balance}</strong> unit(s)</p>
              )}
            </div>
            <div>
              <Label>Quantity consumed *</Label>
              <Input
                inputMode="numeric"
                value={form.quantityUsed}
                onChange={(e) => setForm({ ...form, quantityUsed: e.target.value.replace(/\D/g, "") })}
                placeholder="Quantity"
                required
              />
              {resultingBalance != null && qty > 0 && (
                <p className={`mt-1 text-sm ${resultingBalance < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                  Stock after recording: <strong>{resultingBalance}</strong>
                </p>
              )}
            </div>
            <div>
              <Label>Reporting month *</Label>
              <Input type="month" value={form.reportingPeriod} onChange={(e) => setForm({ ...form, reportingPeriod: e.target.value })} required />
            </div>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Recording…" : "Record Consumption"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
