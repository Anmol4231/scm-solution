"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminTransfersPage() {
  const [recommendations, setRecommendations] = useState<Record<string, unknown>[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [batches, setBatches] = useState<{ id: string; medicineId: string; batchNumber: string; medicine: { medicineName: string }; facility: { name: string }; quantity: number }[]>([]);
  const [form, setForm] = useState({ toFacilityId: "", batchId: "", medicineId: "", quantity: 0, authorizationNotes: "" });

  useEffect(() => {
    api<Record<string, unknown>[]>("/expiry/redistribution").then(setRecommendations);
    api<{ id: string; name: string }[]>("/auth/facilities").then(setFacilities);
    api<{ id: string; medicineId: string; batchNumber: string; medicine: { medicineName: string }; facility: { name: string }; quantity: number }[]>("/stock/batches").then(setBatches);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const batch = batches.find((b) => b.id === form.batchId);
    if (!batch) return;
    await api("/transfers", {
      method: "POST",
      body: JSON.stringify({ ...form, medicineId: batch.medicineId }),
    });
    alert("Transfer authorization created");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Redistribution (Manager)</h1>
        <Link href="/transfers/send">
          <Button>Send transfer</Button>
        </Link>
      </div>

      <Card>
        <CardHeader><CardTitle>Surplus Near-Expiry Recommendations</CardTitle></CardHeader>
        <CardContent>
          {recommendations.map((r, i) => {
            const rec = r as { recommendation: string; batch: { batchNumber: string; medicine: { medicineName: string } }; daysUntilExpiry: number };
            return (
              <p key={i} className="mb-2 text-sm border-b pb-2">
                {rec.recommendation} ({rec.daysUntilExpiry}d)
              </p>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Create Transfer Authorization</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-3">
            <div>
              <Label>Source batch</Label>
              <select className="h-11 w-full rounded-lg border px-3" value={form.batchId} onChange={(e) => {
                const b = batches.find((x) => x.id === e.target.value);
                setForm({ ...form, batchId: e.target.value, medicineId: b?.medicineId || "" });
              }} required>
                <option value="">Select batch</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.medicine.medicineName} — {b.batchNumber} @ {b.facility.name} (qty {b.quantity})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Receiving facility</Label>
              <select className="h-11 w-full rounded-lg border px-3" value={form.toFacilityId} onChange={(e) => setForm({ ...form, toFacilityId: e.target.value })} required>
                <option value="">Select</option>
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div><Label>Quantity</Label><Input type="number" min={1} value={form.quantity || ""} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} required /></div>
            <div><Label>Authorization notes</Label><Input value={form.authorizationNotes} onChange={(e) => setForm({ ...form, authorizationNotes: e.target.value })} /></div>
            <Button type="submit" size="lg" className="w-full">Generate Transfer</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
