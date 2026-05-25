"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

export default function AdjustmentPage() {
  const router = useRouter();
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);
  const [systemBalance, setSystemBalance] = useState(0);
  const [form, setForm] = useState({ medicineId: "", physicalCount: 0, reason: "" });

  useEffect(() => { api("/medicines").then(setMedicines); }, []);

  useEffect(() => {
    if (form.medicineId) {
      api<{ balance: number }>(`/stock/balance?medicineId=${form.medicineId}`).then((r) => setSystemBalance(r.balance));
    }
  }, [form.medicineId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/stock/adjustment", { method: "POST", body: JSON.stringify(form) });
    router.push("/stock");
  };

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-2xl font-bold">Stock Adjustment</h1>
      <Card><CardContent className="pt-6">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Medicine</Label>
            <select className="h-11 w-full rounded-lg border px-3" value={form.medicineId} onChange={(e) => setForm({ ...form, medicineId: e.target.value })} required>
              <option value="">Select</option>
              {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
            </select>
          </div>
          {form.medicineId && <p className="rounded bg-slate-100 p-3 text-sm">System balance: <strong>{systemBalance}</strong></p>}
          <div><Label>Physical count</Label><Input type="number" min={0} value={form.physicalCount || ""} onChange={(e) => setForm({ ...form, physicalCount: +e.target.value })} required /></div>
          <div><Label>Discrepancy reason</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required /></div>
          <Button type="submit" size="lg" className="w-full">Save Adjustment</Button>
        </form>
      </CardContent></Card>
    </div>
  );
}
