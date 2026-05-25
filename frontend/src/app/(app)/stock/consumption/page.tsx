"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ConsumptionPage() {
  const router = useRouter();
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);
  const [form, setForm] = useState({ medicineId: "", quantityUsed: 0, reportingPeriod: new Date().toISOString().slice(0, 7) });

  useEffect(() => { api("/medicines").then(setMedicines); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/stock/consumption", { method: "POST", body: JSON.stringify(form) });
    router.push("/stock");
  };

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-2 text-2xl font-bold">Monthly Usage Report</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Report total medicine used in a calendar month for AMS/provincial records. This is not patient dispensing — use{" "}
        <a href="/dispense" className="font-medium text-medflow-600 hover:underline">Dispense Medicine</a> to issue stock to patients or staff.
      </p>
      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Medicine</Label>
              <select className="h-11 w-full rounded-lg border px-3" value={form.medicineId} onChange={(e) => setForm({ ...form, medicineId: e.target.value })} required>
                <option value="">Select</option>
                {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
              </select>
            </div>
            <div><Label>Quantity used</Label><Input type="number" min={1} value={form.quantityUsed || ""} onChange={(e) => setForm({ ...form, quantityUsed: +e.target.value })} required /></div>
            <div><Label>Reporting period (YYYY-MM)</Label><Input value={form.reportingPeriod} onChange={(e) => setForm({ ...form, reportingPeriod: e.target.value })} required /></div>
            <Button type="submit" size="lg" className="w-full">Submit Report</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
