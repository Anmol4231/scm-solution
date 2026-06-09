"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";

type Tab = "patient" | "ams" | "inter";

interface Facility { id: string; name: string; code: string; facilityType: string }
interface Medicine { id: string; medicineName: string }
interface DispenseRecord { id: string; medicineId: string; batchNumber: string; quantity: number; dispensedAt: string; medicine: { medicineName: string } }

const STORE_TYPES = ["AMS_CENTRAL", "MEDICAL_STORE", "WAREHOUSE", "REGIONAL_STORE"];

export default function ReturnsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("patient");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [dispenseRecords, setDispenseRecords] = useState<DispenseRecord[]>([]);

  const [patient, setPatient] = useState({ patientId: "", dispensingRecordId: "", medicineId: "", quantity: 0, condition: "UNOPENED", returnReason: "No longer needed", batchNumber: "" });
  const [ams, setAms] = useState({ receivingFacilityId: "", medicineId: "", batchNumber: "", expiryDate: "", quantity: 0, returnReason: "Near expiry" });
  const [inter, setInter] = useState({ receivingFacilityId: "", medicineId: "", batchNumber: "", expiryDate: "", quantity: 0, returnReason: "Surplus" });

  useEffect(() => {
    api<Medicine[]>("/medicines").then(setMedicines).catch(() => {});
    api<Facility[]>("/auth/facilities").then(setAllFacilities).catch(() => {});
  }, []);

  const loadDispenseRecords = (patientId: string) => {
    if (!patientId) return;
    api<DispenseRecord[]>(`/dispensing?patientId=${patientId}`).then(setDispenseRecords).catch(() => {});
  };

  const amsFacilities = allFacilities.filter((f) => STORE_TYPES.includes(f.facilityType));
  const peerFacilities = allFacilities.filter((f) => f.id !== user?.facilityId);

  const submit = async (endpoint: string, body: object) => {
    setError(""); setMsg(""); setBusy(true);
    try {
      await api(endpoint, { method: "POST", body: JSON.stringify(body) });
      setMsg("Return processed successfully.");
    } catch (e: any) {
      setError(e?.message ?? "Failed to process return");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
      <h1 className="text-2xl font-bold">Medicine Returns</h1>

      {msg && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <Button variant={tab === "patient" ? "default" : "outline"} onClick={() => setTab("patient")}>Patient Return</Button>
        <Button variant={tab === "ams" ? "default" : "outline"} onClick={() => setTab("ams")}>Facility → AMS</Button>
        <Button variant={tab === "inter" ? "default" : "outline"} onClick={() => setTab("inter")}>Inter-Facility</Button>
      </div>

      {/* Patient Return */}
      {tab === "patient" && (
        <Card>
          <CardHeader><CardTitle>Patient Return</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); submit("/returns/patient", { ...patient, quantity: +patient.quantity }); }} className="space-y-3">
              <div>
                <Label>Patient ID</Label>
                <Input value={patient.patientId} onChange={(e) => { setPatient({ ...patient, patientId: e.target.value }); loadDispenseRecords(e.target.value); }} required />
              </div>
              {dispenseRecords.length > 0 && (
                <div>
                  <Label>Original Dispensing Record (optional)</Label>
                  <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={patient.dispensingRecordId} onChange={(e) => {
                    const rec = dispenseRecords.find((r) => r.id === e.target.value);
                    setPatient({ ...patient, dispensingRecordId: e.target.value, medicineId: rec?.medicineId ?? patient.medicineId, batchNumber: rec?.batchNumber ?? patient.batchNumber, quantity: rec?.quantity ?? patient.quantity });
                  }}>
                    <option value="">Select dispensing record…</option>
                    {dispenseRecords.map((r) => <option key={r.id} value={r.id}>{r.medicine.medicineName} — {r.quantity} units — {new Date(r.dispensedAt).toLocaleDateString()}</option>)}
                  </select>
                </div>
              )}
              <div>
                <Label>Medicine</Label>
                <MedicineCombobox
                  medicines={medicines}
                  value={patient.medicineId}
                  onChange={(id) => setPatient({ ...patient, medicineId: id })}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Quantity</Label><Input type="number" min={1} value={patient.quantity || ""} onChange={(e) => setPatient({ ...patient, quantity: +e.target.value })} required /></div>
                <div><Label>Batch Number</Label><Input value={patient.batchNumber} onChange={(e) => setPatient({ ...patient, batchNumber: e.target.value })} /></div>
              </div>
              <div>
                <Label>Condition</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={patient.condition} onChange={(e) => setPatient({ ...patient, condition: e.target.value })}>
                  <option value="UNOPENED">Unopened</option>
                  <option value="OPENED_UNDAMAGED">Opened but undamaged</option>
                  <option value="DAMAGED_CONTAMINATED">Damaged / Contaminated</option>
                </select>
              </div>
              <div>
                <Label>Reason</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={patient.returnReason} onChange={(e) => setPatient({ ...patient, returnReason: e.target.value })}>
                  <option>No longer needed</option>
                  <option>Wrong medication dispensed</option>
                  <option>Patient refused medication</option>
                  <option>Other</option>
                </select>
              </div>
              <Button type="submit" disabled={busy}>Process Patient Return</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Facility → AMS Return */}
      {tab === "ams" && (
        <Card>
          <CardHeader><CardTitle>Return to AMS / Medical Store</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); submit("/returns/facility", { returnType: "FACILITY_TO_AMS", ...ams, quantity: +ams.quantity }); }} className="space-y-3">
              <div>
                <Label>Receiving AMS / Medical Store *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={ams.receivingFacilityId} onChange={(e) => setAms({ ...ams, receivingFacilityId: e.target.value })} required>
                  <option value="">Select AMS…</option>
                  {amsFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.facilityType})</option>)}
                </select>
              </div>
              <div>
                <Label>Medicine *</Label>
                <MedicineCombobox
                  medicines={medicines}
                  value={ams.medicineId}
                  onChange={(id) => setAms({ ...ams, medicineId: id })}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Batch Number *</Label><Input value={ams.batchNumber} onChange={(e) => setAms({ ...ams, batchNumber: e.target.value })} required /></div>
                <div><Label>Expiry Date *</Label><Input type="date" value={ams.expiryDate} onChange={(e) => setAms({ ...ams, expiryDate: e.target.value })} required /></div>
                <div><Label>Quantity *</Label><Input type="number" min={1} value={ams.quantity || ""} onChange={(e) => setAms({ ...ams, quantity: +e.target.value })} required /></div>
              </div>
              <div>
                <Label>Return Reason *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={ams.returnReason} onChange={(e) => setAms({ ...ams, returnReason: e.target.value })}>
                  <option>Near expiry</option>
                  <option>Surplus stock</option>
                  <option>Product recall</option>
                  <option>Damaged</option>
                  <option>Other</option>
                </select>
              </div>
              <p className="text-sm text-slate-500">Stock will be immediately decremented from your facility and credited to the AMS.</p>
              <Button type="submit" disabled={busy}>Process Return to AMS</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Inter-Facility Return */}
      {tab === "inter" && (
        <Card>
          <CardHeader><CardTitle>Return to Peer Facility</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={(e) => { e.preventDefault(); submit("/returns/facility", { returnType: "INTER_FACILITY", ...inter, quantity: +inter.quantity }); }} className="space-y-3">
              <div>
                <Label>Receiving Facility *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={inter.receivingFacilityId} onChange={(e) => setInter({ ...inter, receivingFacilityId: e.target.value })} required>
                  <option value="">Select facility…</option>
                  {peerFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                </select>
              </div>
              <div>
                <Label>Medicine *</Label>
                <MedicineCombobox
                  medicines={medicines}
                  value={inter.medicineId}
                  onChange={(id) => setInter({ ...inter, medicineId: id })}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Batch Number *</Label><Input value={inter.batchNumber} onChange={(e) => setInter({ ...inter, batchNumber: e.target.value })} required /></div>
                <div><Label>Expiry Date *</Label><Input type="date" value={inter.expiryDate} onChange={(e) => setInter({ ...inter, expiryDate: e.target.value })} required /></div>
                <div><Label>Quantity *</Label><Input type="number" min={1} value={inter.quantity || ""} onChange={(e) => setInter({ ...inter, quantity: +e.target.value })} required /></div>
              </div>
              <div>
                <Label>Return Reason *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={inter.returnReason} onChange={(e) => setInter({ ...inter, returnReason: e.target.value })}>
                  <option>Surplus stock</option>
                  <option>Borrowed stock return</option>
                  <option>Emergency lending return</option>
                  <option>Other</option>
                </select>
              </div>
              <p className="text-sm text-slate-500">Stock will be decremented from your facility and credited to the receiving facility atomically.</p>
              <Button type="submit" disabled={busy}>Process Inter-Facility Return</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
