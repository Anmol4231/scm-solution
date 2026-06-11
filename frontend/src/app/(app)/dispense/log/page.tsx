"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ClipboardList, Loader2, ShieldAlert } from "lucide-react";
import { api } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { OperationsTabs } from "@/components/layout/operations-tabs";

interface LogRecord {
  id: string;
  quantity: number;
  batchNumber: string;
  expiryDate: string;
  dosage?: string | null;
  dispensedAt: string;
  patient?: { id: string; patientId: string; firstName: string; lastName: string } | null;
  medicine: { medicineName: string; category?: { controlledDrug: boolean } | null };
  prescription?: { prescriptionId: string } | null;
  dispensedBy?: { firstName: string; lastName: string } | null;
}

interface RegisterResponse {
  from: string;
  to: string | null;
  records: (Omit<LogRecord, "medicine"> & {
    medicine: { id: string; medicineName: string };
    prescription?: { prescriptionId: string; doctorName?: string | null } | null;
  })[];
  summary: { medicineId: string; medicineName: string; dispensedTotal: number; onHand: number }[];
}

const PAGE_SIZE = 50;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export default function DispensingLogPage() {
  const hasAccess = useRequirePermission("dispensing");
  const [tab, setTab] = useState<"log" | "controlled">("log");

  /* ── Log tab ── */
  const [from, setFrom] = useState(isoDaysAgo(0)); // default: today's register
  const [to, setTo] = useState(isoDaysAgo(0));
  const [patientQuery, setPatientQuery] = useState("");
  const [records, setRecords] = useState<LogRecord[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadLog = useCallback((pageIndex: number) => {
    setLoading(true); setError("");
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (patientQuery.trim()) params.set("patientId", patientQuery.trim());
    params.set("take", String(PAGE_SIZE));
    params.set("skip", String(pageIndex * PAGE_SIZE));
    api<LogRecord[]>(`/dispensing?${params.toString()}`)
      .then((rs) => { setRecords(rs); setPage(pageIndex); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dispensing log"))
      .finally(() => setLoading(false));
  }, [from, to, patientQuery]);

  useEffect(() => { if (tab === "log") loadLog(0); }, [tab, loadLog]);

  /* ── Controlled register tab ── */
  const [regFrom, setRegFrom] = useState(isoDaysAgo(30));
  const [regTo, setRegTo] = useState(isoDaysAgo(0));
  const [register, setRegister] = useState<RegisterResponse | null>(null);
  const [regLoading, setRegLoading] = useState(false);
  const [regError, setRegError] = useState("");

  const loadRegister = useCallback(() => {
    setRegLoading(true); setRegError("");
    const params = new URLSearchParams();
    if (regFrom) params.set("from", regFrom);
    if (regTo) params.set("to", regTo);
    api<RegisterResponse>(`/dispensing/controlled-register?${params.toString()}`)
      .then(setRegister)
      .catch((e) => setRegError(e instanceof Error ? e.message : "Failed to load controlled drug register"))
      .finally(() => setRegLoading(false));
  }, [regFrom, regTo]);

  useEffect(() => { if (tab === "controlled") loadRegister(); }, [tab, loadRegister]);

  if (!hasAccess) return null;

  const totalQty = records.reduce((s, r) => s + r.quantity, 0);

  return (
    <div className="space-y-4">
      <OperationsTabs />

      {/* Sub-tabs */}
      <div className="flex gap-2 text-sm">
        <button type="button" onClick={() => setTab("log")}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${tab === "log" ? "border-medflow-300 bg-medflow-50 text-medflow-700" : "border-slate-200 text-slate-500"}`}>
          <ClipboardList className="h-4 w-4" /> Dispensing Log
        </button>
        <button type="button" onClick={() => setTab("controlled")}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 font-medium ${tab === "controlled" ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 text-slate-500"}`}>
          <ShieldAlert className="h-4 w-4" /> Controlled Drug Register
        </button>
      </div>

      {tab === "log" && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-9" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-9" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="min-w-[180px] flex-1">
                <Label className="text-xs">Patient ID</Label>
                <Input className="h-9" placeholder="e.g. PAT00123" value={patientQuery} onChange={(e) => setPatientQuery(e.target.value)} />
              </div>
              <Button size="sm" onClick={() => loadLog(0)} disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => { setFrom(isoDaysAgo(0)); setTo(isoDaysAgo(0)); setPatientQuery(""); }}>
                Today
              </Button>
            </div>

            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-2 pl-3">Time</th>
                    <th className="p-2">Patient</th>
                    <th className="p-2">Medicine</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2">Batch</th>
                    <th className="p-2">Prescription</th>
                    <th className="p-2">Dispensed by</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {records.length === 0 && !loading && (
                    <tr><td colSpan={7} className="p-4 text-center text-slate-400">No dispensing records for this period.</td></tr>
                  )}
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="p-2 pl-3 whitespace-nowrap text-slate-600">{new Date(r.dispensedAt).toLocaleString()}</td>
                      <td className="p-2">
                        {r.patient ? (
                          <Link href={`/patients/${r.patient.id}`} className="text-medflow-600 hover:underline">
                            {r.patient.firstName} {r.patient.lastName}
                          </Link>
                        ) : "—"}
                      </td>
                      <td className="p-2 font-medium">
                        {r.medicine.medicineName}
                        {r.medicine.category?.controlledDrug && (
                          <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Controlled</span>
                        )}
                      </td>
                      <td className="p-2 text-right font-semibold">{r.quantity}</td>
                      <td className="p-2 text-slate-600">{r.batchNumber}</td>
                      <td className="p-2 text-slate-600">{r.prescription?.prescriptionId ?? "—"}</td>
                      <td className="p-2 text-slate-600">{r.dispensedBy ? `${r.dispensedBy.firstName} ${r.dispensedBy.lastName}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm text-slate-500">
              <span>{records.length} record(s) shown · {totalQty} units</span>
              <span className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => loadLog(page - 1)}>← Prev</Button>
                <Button size="sm" variant="outline" disabled={records.length < PAGE_SIZE || loading} onClick={() => loadLog(page + 1)}>Next →</Button>
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === "controlled" && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-9" value={regFrom} onChange={(e) => setRegFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-9" value={regTo} onChange={(e) => setRegTo(e.target.value)} />
              </div>
              <Button size="sm" onClick={loadRegister} disabled={regLoading}>
                {regLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
              </Button>
            </div>

            {regError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{regError}</p>}

            {register && register.summary.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-red-50/60 text-left text-xs text-red-800">
                    <tr>
                      <th className="p-2 pl-3">Controlled medicine</th>
                      <th className="p-2 text-right">Dispensed (period)</th>
                      <th className="p-2 text-right">Current on hand</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {register.summary.map((s) => (
                      <tr key={s.medicineId}>
                        <td className="p-2 pl-3 font-medium">{s.medicineName}</td>
                        <td className="p-2 text-right">{s.dispensedTotal}</td>
                        <td className="p-2 text-right">{s.onHand}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-2 pl-3">Time</th>
                    <th className="p-2">Medicine</th>
                    <th className="p-2 text-right">Qty</th>
                    <th className="p-2">Batch</th>
                    <th className="p-2">Patient</th>
                    <th className="p-2">Prescription / Prescriber</th>
                    <th className="p-2">Dispensed by</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(!register || register.records.length === 0) && !regLoading && (
                    <tr><td colSpan={7} className="p-4 text-center text-slate-400">No controlled medicines dispensed in this period.</td></tr>
                  )}
                  {register?.records.map((r) => (
                    <tr key={r.id}>
                      <td className="p-2 pl-3 whitespace-nowrap text-slate-600">{new Date(r.dispensedAt).toLocaleString()}</td>
                      <td className="p-2 font-medium">{r.medicine.medicineName}</td>
                      <td className="p-2 text-right font-semibold">{r.quantity}</td>
                      <td className="p-2 text-slate-600">{r.batchNumber}</td>
                      <td className="p-2 text-slate-600">
                        {r.patient ? `${r.patient.firstName} ${r.patient.lastName} (${r.patient.patientId})` : "—"}
                      </td>
                      <td className="p-2 text-slate-600">
                        {r.prescription?.prescriptionId ?? "—"}
                        {r.prescription?.doctorName ? ` · Dr. ${r.prescription.doctorName}` : ""}
                      </td>
                      <td className="p-2 text-slate-600">{r.dispensedBy ? `${r.dispensedBy.firstName} ${r.dispensedBy.lastName}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="flex items-start gap-1.5 text-xs text-slate-400">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The register lists every dispensing of a controlled-category medicine with patient, prescription, and dispenser identity.
              Reconcile the period total against physical stock counts.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
