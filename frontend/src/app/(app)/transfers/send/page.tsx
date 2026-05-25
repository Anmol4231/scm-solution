"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Facility {
  id: string;
  name: string;
  code: string;
}

interface Batch {
  id: string;
  medicineId: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  medicine: { medicineName: string };
  facility?: { id: string; name: string };
}

export default function SendTransferPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [form, setForm] = useState({
    toFacilityId: "",
    batchId: "",
    medicineId: "",
    quantity: 0,
    authorizationNotes: "",
  });
  const [result, setResult] = useState<{ transferCode: string; toFacility: { name: string } } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Facility[]>("/auth/facilities").then((all) => {
      const filtered = user?.facilityId
        ? all.filter((f) => f.id !== user.facilityId)
        : all;
      setFacilities(filtered);
    });
    loadBatches();
  }, [user?.facilityId]);

  const loadBatches = () => {
    const q = user?.facilityId ? `?facilityId=${user.facilityId}` : "";
    api<Batch[]>(`/stock/batches${q}`).then(setBatches).catch(console.error);
  };

  const selectedBatch = batches.find((b) => b.id === form.batchId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setResult(null);
    if (!selectedBatch) {
      setError("Select a batch");
      return;
    }
    if (form.quantity > selectedBatch.quantity) {
      setError(`Only ${selectedBatch.quantity} available in this batch`);
      return;
    }
    try {
      const transfer = await api<{
        transferCode: string;
        toFacility: { name: string };
      }>("/transfers", {
        method: "POST",
        body: JSON.stringify({
          toFacilityId: form.toFacilityId,
          batchId: form.batchId,
          medicineId: selectedBatch.medicineId,
          quantity: form.quantity,
          authorizationNotes: form.authorizationNotes || undefined,
        }),
      });
      setResult(transfer);
      loadBatches();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    }
  };

  if (user?.role === "PROVINCIAL_MANAGER" && !user.facilityId) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-bold">Send Transfer</h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">
              Select a sending facility first using the facility switcher on the dashboard, then return here to send stock from that facility.
            </p>
            <Link href="/dashboard" className="mt-4 inline-block">
              <Button>Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/transfers" className="text-sm text-medflow-600 hover:underline">
          ← Transfers
        </Link>
      </div>
      <h1 className="text-2xl font-bold">Send to Another Facility</h1>
      {user?.facility && (
        <p className="text-sm text-muted-foreground">
          Sending from: <strong>{user.facility.name}</strong>
        </p>
      )}

      {result && (
        <Card className="border-green-300 bg-green-50">
          <CardContent className="p-4">
            <p className="font-semibold text-green-800">Transfer created</p>
            <p className="mt-1 font-mono text-lg">{result.transferCode}</p>
            <p className="text-sm text-green-700">
              Share this code with {result.toFacility.name} so they can confirm receipt.
            </p>
            <Button className="mt-3" variant="outline" onClick={() => router.push("/transfers")}>
              View all transfers
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Transfer details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Receiving facility *</Label>
              <select
                className="h-11 w-full rounded-lg border px-3"
                value={form.toFacilityId}
                onChange={(e) => setForm({ ...form, toFacilityId: e.target.value })}
                required
              >
                <option value="">Select facility</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label>Medicine batch (from your stock) *</Label>
              <select
                className="h-11 w-full rounded-lg border px-3"
                value={form.batchId}
                onChange={(e) => {
                  const b = batches.find((x) => x.id === e.target.value);
                  setForm({
                    ...form,
                    batchId: e.target.value,
                    medicineId: b?.medicineId || "",
                    quantity: 0,
                  });
                }}
                required
              >
                <option value="">Select batch</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.medicine.medicineName} — {b.batchNumber} (qty {b.quantity}, exp{" "}
                    {new Date(b.expiryDate).toLocaleDateString()})
                  </option>
                ))}
              </select>
              {batches.length === 0 && (
                <p className="mt-1 text-xs text-amber-600">No stock batches available. Add stock via Receipt first.</p>
              )}
            </div>

            <div>
              <Label>Quantity to transfer *</Label>
              <Input
                type="number"
                min={1}
                max={selectedBatch?.quantity}
                value={form.quantity || ""}
                onChange={(e) => setForm({ ...form, quantity: +e.target.value })}
                required
                disabled={!form.batchId}
              />
              {selectedBatch && (
                <p className="mt-1 text-xs text-muted-foreground">Max available: {selectedBatch.quantity}</p>
              )}
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={form.authorizationNotes}
                onChange={(e) => setForm({ ...form, authorizationNotes: e.target.value })}
                placeholder="e.g. Near expiry redistribution"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button type="submit" size="lg" className="w-full" disabled={!form.toFacilityId || !form.batchId}>
              Generate Transfer Order
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
