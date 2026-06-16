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

interface Facility { id: string; name: string; code: string; facilityType: string }
interface Medicine { id: string; medicineName: string; genericName?: string; unitType: string }

interface Line { medicineId: string; quantityRequested: number }

export default function NewRequisitionPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);

  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [issuingFacilities, setIssuingFacilities] = useState<Facility[]>([]);
  const [medicines, setMedicines] = useState<Medicine[]>([]);

  const [requestingFacilityId, setRequestingFacilityId] = useState(user?.facilityId ?? "");
  const [issuingFacilityId, setIssuingFacilityId] = useState("");
  const [priority, setPriority] = useState("ROUTINE");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ medicineId: "", quantityRequested: 0 }]);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Medicine[]>("/medicines").then(setMedicines);
    api<Facility[]>("/requisitions/issuing-facilities").then(setIssuingFacilities);
    if (isAdmin) {
      api<Facility[]>("/auth/facilities").then(setAllFacilities);
    }
  }, [isAdmin]);

  const addLine = () => setLines((l) => [...l, { medicineId: "", quantityRequested: 0 }]);
  const removeLine = (i: number) => setLines((l) => l.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: keyof Line, value: string | number) =>
    setLines((l) => l.map((ln, idx) => idx === i ? { ...ln, [field]: value } : ln));

  const submit = async (asDraft: boolean) => {
    setError("");
    const effectiveRequestingId = isAdmin ? requestingFacilityId : (user?.facilityId ?? "");
    if (!effectiveRequestingId) return setError("Requesting facility required");
    if (!issuingFacilityId) return setError("Issuing store required");
    if (lines.some((l) => !l.medicineId || l.quantityRequested <= 0)) return setError("All lines need a medicine and quantity > 0");

    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        requestingFacilityId: effectiveRequestingId,
        issuingFacilityId,
        priority,
        notes: notes || undefined,
        lines: lines.map((l) => ({ medicineId: l.medicineId, quantityRequested: l.quantityRequested })),
      };
      const created = await api<{ id: string }>("/requisitions", { method: "POST", body: JSON.stringify(body) });
      if (!asDraft) {
        await api(`/requisitions/${created.id}/submit`, { method: "POST", body: JSON.stringify({}) });
      }
      router.push("/requisitions");
    } catch (e: any) {
      setError(e?.message ?? "Failed to create requisition");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/requisitions" className="text-sm text-medflow-600 hover:underline">← Requisitions</Link>
      <h1 className="text-2xl font-bold">New Requisition</h1>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card>
        <CardHeader><CardTitle>Header</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {isAdmin && (
            <div>
              <Label>Requesting Facility *</Label>
              <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={requestingFacilityId} onChange={(e) => setRequestingFacilityId(e.target.value)}>
                <option value="">Select facility…</option>
                {allFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
              </select>
            </div>
          )}
          <div>
            <Label>Issuing Store (AMS / Medical Store) *</Label>
            <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={issuingFacilityId} onChange={(e) => setIssuingFacilityId(e.target.value)}>
              <option value="">Select issuing store…</option>
              {issuingFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code}) — {f.facilityType}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Priority</Label>
              <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="ROUTINE">Routine</option>
                <option value="URGENT">Urgent</option>
                <option value="EMERGENCY">Emergency</option>
              </select>
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <textarea className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Medicine Lines</CardTitle>
            <Button variant="outline" size="sm" onClick={addLine}>+ Add Line</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="flex gap-3 items-end">
              <div className="flex-1">
                <Label>Medicine *</Label>
                <MedicineCombobox
                  medicines={medicines}
                  value={line.medicineId}
                  onChange={(id) => updateLine(i, "medicineId", id)}
                  className="mt-1"
                />
              </div>
              <div className="w-32">
                <Label>Qty Requested *</Label>
                <Input type="number" min={1} className="mt-1" value={line.quantityRequested || ""} onChange={(e) => updateLine(i, "quantityRequested", +e.target.value)} />
              </div>
              {lines.length > 1 && (
                <Button variant="outline" size="sm" className="text-red-600 mb-0.5" onClick={() => removeLine(i)}>Remove</Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="flex gap-3">
        <Button onClick={() => submit(true)} variant="outline" disabled={busy}>Save as Draft</Button>
        <Button onClick={() => submit(false)} disabled={busy}>Create & Submit</Button>
      </div>
    </div>
  );
}
