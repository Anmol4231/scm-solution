"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function StockReceiptPage() {
  const router = useRouter();
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);
  const [form, setForm] = useState({
    medicineId: "",
    batchNumber: "",
    expiryDate: "",
    quantityReceived: 0,
    quantityRequested: 0,
    notes: "",
  });

  useEffect(() => { api("/medicines").then(setMedicines); }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/stock/receipt", { method: "POST", body: JSON.stringify(form) });
    router.push("/stock");
  };

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-4 text-2xl font-bold">Stock Receipt</h1>
      <Card>
        <CardHeader><CardTitle>Receive Stock</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Medicine</Label>
              <select className="h-11 w-full rounded-lg border px-3" value={form.medicineId} onChange={(e) => setForm({ ...form, medicineId: e.target.value })} required>
                <option value="">Select</option>
                {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
              </select>
            </div>
            <div><Label>Batch number</Label><Input value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} required /></div>
            <div><Label>Expiry date</Label><Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} required /></div>
            <div><Label>Quantity received</Label><Input type="number" min={1} value={form.quantityReceived || ""} onChange={(e) => setForm({ ...form, quantityReceived: +e.target.value })} required /></div>
            <div><Label>Qty on issue voucher (requested)</Label><Input type="number" min={0} value={form.quantityRequested || ""} onChange={(e) => setForm({ ...form, quantityRequested: +e.target.value })} /></div>
            <Button type="submit" size="lg" className="w-full">Save Receipt</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
