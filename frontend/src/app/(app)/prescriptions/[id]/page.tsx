"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, Ban, FileText, Syringe } from "lucide-react";
import { api, resolveApiUrl } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { useAuth } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { OperationsTabs } from "@/components/layout/operations-tabs";

function apiBaseUrl() {
  return resolveApiUrl().replace(/\/api$/, "");
}

interface RxMedicineLine {
  id: string;
  medicineId: string;
  medicine: { medicineName: string; strengths?: { strength: string }[] };
  dosage?: string | null;
  form?: string | null;
  quantity?: number | null;
  notes?: string | null;
}

interface RxDispenseRecord {
  id: string;
  medicineId: string;
  medicine: { medicineName: string };
  quantity: number;
  batchNumber: string;
  expiryDate: string;
  dispensedAt: string;
  dispensedBy?: { firstName: string; lastName: string } | null;
}

interface RxDetail {
  id: string;
  prescriptionId: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  priority?: string | null;
  doctorName?: string | null;
  department?: string | null;
  diagnosisNotes?: string | null;
  symptoms?: string | null;
  allergies?: string | null;
  prescriptionNotes?: string | null;
  prescriptionDate: string;
  followUpDate?: string | null;
  uploadedPrescriptionUrl?: string | null;
  patientId: string;
  patient: { id: string; patientId: string; firstName: string; lastName: string; gender?: string; age?: number; allergies?: string | null };
  medicines: RxMedicineLine[];
  dispensingRecords: RxDispenseRecord[];
}

const STATUS_STYLE: Record<RxDetail["status"], string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  COMPLETED: "bg-blue-50 text-blue-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

const STATUS_LABEL: Record<RxDetail["status"], string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export default function PrescriptionDetailPage() {
  const hasAccess = useRequirePermission("prescriptions");
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [rx, setRx] = useState<RxDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<RxDetail>(`/prescriptions/${id}`)
      .then(setRx)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load prescription"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const cancelRx = async () => {
    setBusy(true); setError("");
    try {
      await api(`/prescriptions/${id}/status`, { method: "PATCH", body: JSON.stringify({ status: "CANCELLED" }) });
      setConfirmCancel(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel prescription");
    } finally { setBusy(false); }
  };

  if (!hasAccess) return null;

  if (loading) {
    return (
      <div className="space-y-4">
        <OperationsTabs />
        <PageSkeleton />
      </div>
    );
  }

  if (!rx) {
    return (
      <div className="space-y-4">
        <OperationsTabs />
        <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error || "Prescription not found."}</p>
        <Button variant="outline" onClick={() => router.push("/prescriptions")}><ArrowLeft className="mr-1.5 h-4 w-4" /> Back to prescriptions</Button>
      </div>
    );
  }

  // Dispensed per medicine, to show fulfillment against prescribed quantities.
  const dispensedByMed = new Map<string, number>();
  for (const d of rx.dispensingRecords) {
    dispensedByMed.set(d.medicineId, (dispensedByMed.get(d.medicineId) ?? 0) + d.quantity);
  }
  // Prescribed per medicine (lines can repeat a medicine).
  const prescribedByMed = new Map<string, number | null>();
  for (const m of rx.medicines) {
    if (m.quantity == null) { if (!prescribedByMed.has(m.medicineId)) prescribedByMed.set(m.medicineId, null); }
    else prescribedByMed.set(m.medicineId, (prescribedByMed.get(m.medicineId) ?? 0) + m.quantity);
  }

  const allergyTexts = [rx.patient.allergies, rx.allergies]
    .map((a) => (a ?? "").trim())
    .filter((a, i, arr) => a && !/^(nkda|none|nil)$/i.test(a) && arr.indexOf(a) === i);

  const canDispense = rx.status === "ACTIVE" && can(user?.permissions, "dispensing", "create");
  const canCancel = rx.status === "ACTIVE" && can(user?.permissions, "prescriptions", "edit");

  return (
    <div className="space-y-4">
      <OperationsTabs />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold">{rx.prescriptionId}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[rx.status]}`}>{STATUS_LABEL[rx.status]}</span>
            {rx.priority && rx.priority !== "ROUTINE" && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">{rx.priority}</span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            <Link href={`/patients/${rx.patient.id}`} className="font-medium text-medflow-600 hover:underline">
              {rx.patient.firstName} {rx.patient.lastName}
            </Link>
            {" · "}{rx.patient.patientId}
            {rx.patient.age ? ` · ${rx.patient.gender}, ${rx.patient.age}y` : ""}
          </p>
          <p className="text-sm text-slate-500">
            {rx.doctorName ? `Dr. ${rx.doctorName}` : "Prescriber not recorded"}
            {rx.department ? ` · ${rx.department}` : ""}
            {" · "}{new Date(rx.prescriptionDate).toLocaleDateString()}
            {rx.followUpDate ? ` · follow-up ${new Date(rx.followUpDate).toLocaleDateString()}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {canDispense && (
            <Link href={`/dispense?patientId=${rx.patient.id}&rxId=${rx.id}`}>
              <Button><Syringe className="mr-1.5 h-4 w-4" /> Dispense</Button>
            </Link>
          )}
          {canCancel && !confirmCancel && (
            <Button variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => setConfirmCancel(true)}>
              <Ban className="mr-1.5 h-4 w-4" /> Cancel Rx
            </Button>
          )}
        </div>
      </div>

      {confirmCancel && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <span>Cancel prescription {rx.prescriptionId}? It can no longer be dispensed afterwards.</span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setConfirmCancel(false)}>Keep</Button>
            <Button size="sm" className="bg-red-600 text-white hover:bg-red-700" disabled={busy} onClick={cancelRx}>
              {busy ? "Cancelling…" : "Cancel prescription"}
            </Button>
          </span>
        </div>
      )}

      {/* Allergy banner */}
      {allergyTexts.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span><strong>Allergies:</strong> {allergyTexts.join("; ")}</span>
        </div>
      )}

      {/* Clinical context */}
      {(rx.diagnosisNotes || rx.symptoms || rx.prescriptionNotes) && (
        <Card>
          <CardContent className="grid gap-2 p-4 text-sm sm:grid-cols-2">
            {rx.diagnosisNotes && (
              <div><p className="text-xs text-slate-500">Diagnosis</p><p className="font-medium">{rx.diagnosisNotes}</p></div>
            )}
            {rx.symptoms && (
              <div><p className="text-xs text-slate-500">Symptoms</p><p className="font-medium">{rx.symptoms}</p></div>
            )}
            {rx.prescriptionNotes && (
              <div className="sm:col-span-2"><p className="text-xs text-slate-500">Notes</p><p className="whitespace-pre-wrap">{rx.prescriptionNotes}</p></div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Medicine lines + fulfillment */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Prescribed Medicines</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {rx.medicines.length === 0 ? (
            <p className="text-sm text-slate-400">No medicine lines recorded on this prescription.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-2 pl-3">Medicine</th>
                    <th className="p-2">Dosage</th>
                    <th className="p-2 text-right">Prescribed</th>
                    <th className="p-2 text-right">Dispensed</th>
                    <th className="p-2 text-right">Remaining</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rx.medicines.map((m) => {
                    const prescribed = prescribedByMed.get(m.medicineId);
                    const dispensed = dispensedByMed.get(m.medicineId) ?? 0;
                    const remaining = prescribed == null ? null : Math.max(0, prescribed - dispensed);
                    return (
                      <tr key={m.id}>
                        <td className="p-2 pl-3 font-medium">{m.medicine.medicineName}</td>
                        <td className="p-2 text-slate-600">{m.dosage || m.medicine.strengths?.map((s) => s.strength).filter(Boolean).join(" / ") || "—"}</td>
                        <td className="p-2 text-right">{m.quantity ?? <span className="text-orange-600" title="No prescribed quantity set — dispensing is not limited">No limit</span>}</td>
                        <td className="p-2 text-right">{dispensed}</td>
                        <td className={`p-2 text-right font-medium ${remaining === 0 ? "text-emerald-600" : ""}`}>{remaining ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dispensing history */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Dispensing History</CardTitle></CardHeader>
        <CardContent className="p-4 pt-0">
          {rx.dispensingRecords.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing dispensed against this prescription yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-2 pl-3">Medicine</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2">Batch</th>
                    <th className="p-2">Expiry</th>
                    <th className="p-2">Dispensed at</th>
                    <th className="p-2">Dispensed by</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rx.dispensingRecords.map((d) => (
                    <tr key={d.id}>
                      <td className="p-2 pl-3 font-medium">{d.medicine.medicineName}</td>
                      <td className="p-2 text-right">{d.quantity}</td>
                      <td className="p-2 text-slate-600">{d.batchNumber}</td>
                      <td className="p-2 text-slate-600">{new Date(d.expiryDate).toLocaleDateString()}</td>
                      <td className="p-2 text-slate-600">{new Date(d.dispensedAt).toLocaleString()}</td>
                      <td className="p-2 text-slate-600">{d.dispensedBy ? `${d.dispensedBy.firstName} ${d.dispensedBy.lastName}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Attached scan */}
      {rx.uploadedPrescriptionUrl && (
        <a href={`${apiBaseUrl()}${rx.uploadedPrescriptionUrl}`} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-medflow-600 hover:underline">
          <FileText className="h-4 w-4" /> View attached prescription scan
        </a>
      )}
    </div>
  );
}
