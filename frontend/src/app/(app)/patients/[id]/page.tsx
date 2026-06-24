"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PatientProfilePage() {
  const { id } = useParams();
  const [patient, setPatient] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api(`/patients/${id}`).then(setPatient);
    api(`/patients/${id}/history`).then(setHistory);
  }, [id]);

  if (!patient) return <p>Loading...</p>;

  const p = patient as {
    patientId: string;
    firstName: string;
    lastName: string;
    gender: string;
    age: number;
    phoneNumber?: string;
    allergies?: string | null;
    prescriptions?: { prescriptionId: string; doctorName?: string; prescriptionDate: string }[];
    dispensingRecords?: { medicine: { medicineName: string }; quantity: number; dispensedAt: string; dosage?: string }[];
    medicineReturns?: { medicine: { medicineName: string }; quantity: number; returnReason: string }[];
  };

  return (
    <div className="space-y-4">
      <Link href="/patients" className="text-sm text-medflow-600 hover:underline">← Patient Log</Link>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{p.firstName} {p.lastName}</h1>
          <p className="text-muted-foreground">{p.patientId} · {p.gender}, {p.age} years</p>
        </div>
        <Link href={`/dispense?patientId=${id}`}><Button size="lg">Dispense Medicine</Button></Link>
      </div>

      {p.allergies?.trim() && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>Allergies:</strong> {p.allergies}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Medicine Timeline</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <section>
            <h3 className="mb-2 font-semibold">Prescriptions</h3>
            {p.prescriptions?.map((rx, i) => (
              <div key={i} className="mb-2 rounded border p-2 text-sm">
                {rx.prescriptionId} — Dr. {rx.doctorName || "N/A"} — {new Date(rx.prescriptionDate).toLocaleDateString()}
              </div>
            ))}
          </section>
          <section>
            <h3 className="mb-2 font-semibold">Dispensed</h3>
            {p.dispensingRecords?.map((d, i) => (
              <div key={i} className="mb-2 rounded border p-2 text-sm">
                {d.medicine.medicineName} — {d.quantity} ({d.dosage}) — {new Date(d.dispensedAt).toLocaleDateString()}
              </div>
            ))}
          </section>
          <section>
            <h3 className="mb-2 font-semibold">Returns</h3>
            {p.medicineReturns?.length ? p.medicineReturns.map((r, i) => (
              <div key={i} className="mb-2 rounded border p-2 text-sm">
                {r.medicine.medicineName} — {r.quantity} — {r.returnReason}
              </div>
            )) : <p className="text-sm text-muted-foreground">No returns</p>}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
