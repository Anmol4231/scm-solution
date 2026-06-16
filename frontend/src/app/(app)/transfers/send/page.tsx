"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";

interface Facility { id: string; name: string; code: string }
interface Batch { id: string; batchNumber: string; expiryDate: string; quantity: number; medicine: { id: string; medicineName: string } }

interface Line { medicineId: string; batchId: string; quantityTransferred: number }

// A batch is transferable only if it has stock and has not expired.
function isExpired(b: Batch): boolean {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return new Date(b.expiryDate) < start;
}

export default function SendTransferPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);

  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [fromFacilityId, setFromFacilityId] = useState(user?.facilityId ?? "");
  const [toFacilityId, setToFacilityId] = useState("");
  const [authorizationNotes, setAuthorizationNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ medicineId: "", batchId: "", quantityTransferred: 0 }]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Facility[]>("/auth/facilities").then(setAllFacilities).catch(console.error);
  }, []);

  useEffect(() => {
    const facId = fromFacilityId || user?.facilityId;
    if (!facId) return;
    api<Batch[]>(`/stock/batches?facilityId=${facId}`).then(setBatches).catch(console.error);
  }, [fromFacilityId, user?.facilityId]);

  const toFacilities = allFacilities.filter((f) => f.id !== (fromFacilityId || user?.facilityId));
  // Only in-stock, non-expired batches can be transferred.
  const availableBatches = batches.filter((b) => b.quantity > 0 && !isExpired(b));
  // Distinct medicines that have at least one transferable batch, for the search box.
  const medicineOptions = Array.from(
    new Map(availableBatches.map((b) => [b.medicine.id, { id: b.medicine.id, medicineName: b.medicine.medicineName }])).values()
  ).sort((a, b) => a.medicineName.localeCompare(b.medicineName));

  const addLine = () => setLines((l) => [...l, { medicineId: "", batchId: "", quantityTransferred: 0 }]);
  const removeLine = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, patch: Partial<Line>) =>
    setLines((l) => l.map((ln, idx) => idx === i ? { ...ln, ...patch } : ln));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!toFacilityId) return setError("Destination facility required");
    if (lines.some((l) => !l.batchId || l.quantityTransferred <= 0)) return setError("All lines need a batch and quantity > 0");

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        toFacilityId,
        authorizationNotes: authorizationNotes || undefined,
        lines: lines.map((l) => ({ batchId: l.batchId, quantityTransferred: l.quantityTransferred })),
      };
      if (isAdmin && fromFacilityId) body.fromFacilityId = fromFacilityId;
      const created = await api<{ id: string; transferCode: string }>("/transfers/new", { method: "POST", body: JSON.stringify(body) });
      router.push(`/transfers/${created.id}`);
    } catch (e: any) {
      setError(e?.message ?? "Failed to create transfer");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/transfers" className="text-sm text-medflow-600 hover:underline">← Transfers</Link>
      <h1 className="text-2xl font-bold">New Transfer</h1>
      <p className="text-sm text-slate-500">
        Sending from: {isAdmin ? (allFacilities.find((f) => f.id === fromFacilityId)?.name || "Select source facility") : (user?.facility?.name ?? "Assigned facility")}
      </p>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <form onSubmit={submit} className="space-y-4">
        <Card>
          <CardHeader><CardTitle>Transfer Details</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {isAdmin && (
              <div>
                <Label>Source Facility *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={fromFacilityId} onChange={(e) => setFromFacilityId(e.target.value)} required>
                  <option value="">Select sending facility…</option>
                  {allFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                </select>
              </div>
            )}
            {!isAdmin && user?.facility && (
              <div>
                <Label>Source Facility</Label>
                <p className="mt-1 text-sm font-medium text-slate-700">{user.facility.name}</p>
              </div>
            )}
            <div>
              <Label>Destination Facility *</Label>
              <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={toFacilityId} onChange={(e) => setToFacilityId(e.target.value)} required>
                <option value="">Select destination…</option>
                {toFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
              </select>
            </div>
            <div>
              <Label>Notes</Label>
              <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} value={authorizationNotes} onChange={(e) => setAuthorizationNotes(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Medicine Lines</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add Medicine</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {lines.map((line, i) => {
              const selectedBatch = availableBatches.find((b) => b.id === line.batchId);
              const batchesForMedicine = availableBatches.filter((b) => b.medicine.id === line.medicineId);
              return (
                <div key={i} className="flex flex-wrap gap-3 items-end">
                  <div className="min-w-[200px] flex-1">
                    <Label>Medicine *</Label>
                    <MedicineCombobox
                      medicines={medicineOptions}
                      value={line.medicineId}
                      onChange={(id) => updateLine(i, { medicineId: id, batchId: "" })}
                      placeholder="Search medicine to transfer…"
                      className="mt-1 h-10"
                    />
                  </div>
                  <div className="min-w-[200px] flex-1">
                    <Label>Batch *</Label>
                    <select
                      className="mt-1 h-10 w-full rounded-lg border px-3 text-sm disabled:bg-slate-50"
                      value={line.batchId}
                      onChange={(e) => updateLine(i, { batchId: e.target.value })}
                      disabled={!line.medicineId}
                      required
                    >
                      <option value="">{line.medicineId ? "Select batch…" : "Select a medicine first"}</option>
                      {batchesForMedicine.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.batchNumber} (qty: {b.quantity}, exp: {new Date(b.expiryDate).toLocaleDateString()})
                        </option>
                      ))}
                    </select>
                    {selectedBatch && <p className="mt-0.5 text-sm text-slate-400">Available: {selectedBatch.quantity}</p>}
                  </div>
                  <div className="w-28">
                    <Label>Quantity *</Label>
                    <Input type="number" min={1} max={selectedBatch?.quantity} className="mt-1" value={line.quantityTransferred || ""} onChange={(e) => updateLine(i, { quantityTransferred: +e.target.value })} required />
                  </div>
                  {lines.length > 1 && (
                    <Button type="button" variant="outline" size="sm" className="text-red-600 mb-0.5" onClick={() => removeLine(i)}>Remove</Button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send Transfer"}</Button>
      </form>
    </div>
  );
}
