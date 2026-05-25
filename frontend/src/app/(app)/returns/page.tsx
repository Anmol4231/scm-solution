"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Tab = "ams" | "patient";

export default function ReturnsPage() {
  const [tab, setTab] = useState<Tab>("patient");
  const [msg, setMsg] = useState("");

  const [ams, setAms] = useState({ medicineId: "", batchNumber: "", expiryDate: "", quantity: 0, returnReason: "Near expiry", returnDestination: "AMS" });
  const [patient, setPatient] = useState({ patientId: "", medicineId: "", quantity: 0, condition: "UNOPENED", returnReason: "No longer needed", batchNumber: "" });

  const submitAms = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/returns/facility-to-ams", { method: "POST", body: JSON.stringify(ams) });
    setMsg("AMS return recorded");
  };

  const submitPatient = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/returns/patient", { method: "POST", body: JSON.stringify(patient) });
    setMsg("Patient return recorded");
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Medicine Returns</h1>
      {msg && <p className="text-green-600">{msg}</p>}
      <div className="flex gap-2">
        <Button variant={tab === "patient" ? "default" : "outline"} onClick={() => setTab("patient")}>Patient Return</Button>
        <Button variant={tab === "ams" ? "default" : "outline"} onClick={() => setTab("ams")}>Facility → AMS</Button>
      </div>

      {tab === "patient" ? (
        <Card>
          <CardHeader><CardTitle>Patient Return</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submitPatient} className="space-y-3">
              <div><Label>Patient ID (internal)</Label><Input value={patient.patientId} onChange={(e) => setPatient({ ...patient, patientId: e.target.value })} required /></div>
              <div><Label>Medicine ID</Label><Input value={patient.medicineId} onChange={(e) => setPatient({ ...patient, medicineId: e.target.value })} required /></div>
              <div><Label>Quantity</Label><Input type="number" value={patient.quantity || ""} onChange={(e) => setPatient({ ...patient, quantity: +e.target.value })} required /></div>
              <div>
                <Label>Condition</Label>
                <select className="h-11 w-full rounded-lg border px-3" value={patient.condition} onChange={(e) => setPatient({ ...patient, condition: e.target.value })}>
                  <option value="UNOPENED">Unopened package</option>
                  <option value="OPENED_UNDAMAGED">Opened but undamaged</option>
                  <option value="DAMAGED_CONTAMINATED">Damaged/contaminated</option>
                </select>
              </div>
              <div>
                <Label>Reason</Label>
                <select className="h-11 w-full rounded-lg border px-3" value={patient.returnReason} onChange={(e) => setPatient({ ...patient, returnReason: e.target.value })}>
                  <option>Patient expired</option>
                  <option>Adverse reaction</option>
                  <option>No longer needed</option>
                  <option>Other</option>
                </select>
              </div>
              <Button type="submit" size="lg" className="w-full">Submit Return</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader><CardTitle>Facility to AMS Return</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submitAms} className="space-y-3">
              <div><Label>Medicine ID</Label><Input value={ams.medicineId} onChange={(e) => setAms({ ...ams, medicineId: e.target.value })} required /></div>
              <div><Label>Batch</Label><Input value={ams.batchNumber} onChange={(e) => setAms({ ...ams, batchNumber: e.target.value })} required /></div>
              <div><Label>Expiry</Label><Input type="date" value={ams.expiryDate} onChange={(e) => setAms({ ...ams, expiryDate: e.target.value })} required /></div>
              <div><Label>Quantity</Label><Input type="number" value={ams.quantity || ""} onChange={(e) => setAms({ ...ams, quantity: +e.target.value })} required /></div>
              <div>
                <Label>Reason</Label>
                <select className="h-11 w-full rounded-lg border px-3" value={ams.returnReason} onChange={(e) => setAms({ ...ams, returnReason: e.target.value })}>
                  <option>Near expiry</option>
                  <option>Overstock</option>
                  <option>Damaged packaging</option>
                  <option>Other</option>
                </select>
              </div>
              <Button type="submit" size="lg" className="w-full">Submit AMS Return</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
