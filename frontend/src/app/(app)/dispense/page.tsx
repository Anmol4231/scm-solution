"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Check, FileText, Search, UserPlus, Pill, ClipboardList, Syringe } from "lucide-react";
import { api } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { sanitizePersonName, sanitizePhone, validators } from "@/lib/validation";
import { OperationsTabs } from "@/components/layout/operations-tabs";

interface Patient { id: string; patientId: string; firstName: string; lastName: string; gender?: string; age?: number; phoneNumber?: string | null }
interface RxOption { id: string; prescriptionId: string; status: string; doctorName?: string | null; medicines?: { medicineId: string }[] }
interface Medicine { id: string; medicineName: string }
interface PlanBatch { id: string; batchNumber: string; expiryDate: string; quantity: number }
interface PlanLine {
  medicineId: string; medicineName: string; dosage: string; form: string; duration: string;
  requestedQuantity: number | null; onHand: number; recommendedBatchId: string | null; batches: PlanBatch[];
  requiresPrescription: boolean;
}

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { n: 1, label: "Patient", icon: Search },
  { n: 2, label: "Prescription", icon: ClipboardList },
  { n: 3, label: "Medicines", icon: Pill },
  { n: 4, label: "Confirm", icon: Syringe },
] as const;

function Stepper({ step }: { step: Step }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto rounded-lg border bg-white p-2 text-sm">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = step > s.n;
        const active = step === s.n;
        return (
          <div key={s.n} className="flex items-center gap-1">
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
              active ? "bg-medflow-50 text-medflow-700" : done ? "text-emerald-600" : "text-slate-400"
            }`}>
              {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className={`h-px w-6 ${done ? "bg-emerald-300" : "bg-slate-200"}`} />}
          </div>
        );
      })}
    </div>
  );
}

interface DispLine { medicineId: string; medicineName: string; dosage: string; form: string; duration: string; batchId: string; quantity: string; onHand: number; batches: PlanBatch[]; enabled: boolean; requiresPrescription: boolean; }

function DispenseWorkflow() {
  const hasAccess = useRequirePermission("dispensing");
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // Step 1 — patient
  const [pq, setPq] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [registerMode, setRegisterMode] = useState(false);
  const [reg, setReg] = useState({ firstName: "", lastName: "", gender: "Female", age: "", phoneNumber: "" });

  // Step 2 — prescription
  const [rxList, setRxList] = useState<RxOption[]>([]);
  const [rxMode, setRxMode] = useState<"existing" | "new">("existing");
  const [selectedRxId, setSelectedRxId] = useState("");
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [newRx, setNewRx] = useState({ doctorName: "", department: "", diagnosisNotes: "" });
  const [newRxLines, setNewRxLines] = useState<{ medicineId: string; dosage: string; quantity: string }[]>([{ medicineId: "", dosage: "", quantity: "" }]);
  const [file, setFile] = useState<File | null>(null);

  // Step 3 — dispense lines
  const [lines, setLines] = useState<DispLine[]>([]);
  const [purpose, setPurpose] = useState("");
  const [department, setDepartment] = useState("");

  useEffect(() => { api<Medicine[]>("/medicines").then(setMedicines).catch(() => {}); }, []);

  // Patient search (debounced)
  useEffect(() => {
    if (registerMode) return;
    const t = setTimeout(() => {
      if (pq.trim().length < 2) { setResults([]); return; }
      api<Patient[]>(`/patients?q=${encodeURIComponent(pq.trim())}`).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [pq, registerMode]);

  // Preselect patient from ?patientId
  useEffect(() => {
    const pid = searchParams.get("patientId");
    if (pid) api<Patient>(`/patients/${pid}`).then((p) => selectPatient(p)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPrescriptions = (patientId: string) => {
    api<RxOption[]>(`/prescriptions?patientId=${patientId}`)
      .then((list) => {
        const active = list.filter((r) => r.status === "ACTIVE");
        setRxList(active);
        setRxMode(active.length ? "existing" : "new");
      })
      .catch(() => setRxList([]));
  };

  const selectPatient = (p: Patient) => {
    setError("");
    setPatient(p);
    loadPrescriptions(p.id);
    setStep(2);
  };

  const registerPatient = async () => {
    setError("");
    const f = validators.personName(reg.firstName, "First name"); if (f) return setError(f);
    const l = validators.personName(reg.lastName, "Last name"); if (l) return setError(l);
    const a = validators.age(reg.age); if (a) return setError(a);
    const ph = validators.phone(reg.phoneNumber); if (ph) return setError(ph);
    setBusy(true);
    try {
      const created = await api<Patient>("/patients", {
        method: "POST",
        body: JSON.stringify({ ...reg, age: Number(reg.age) }),
      });
      setRegisterMode(false);
      selectPatient(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to register patient");
    } finally { setBusy(false); }
  };

  const planFrom = (rxId: string) => {
    setBusy(true); setError("");
    api<{ lines: PlanLine[] }>(`/dispensing/prescription/${rxId}/plan`)
      .then(({ lines: planLines }) => {
        setLines(planLines.map((pl) => ({
          medicineId: pl.medicineId,
          medicineName: pl.medicineName,
          dosage: pl.dosage,
          form: pl.form,
          duration: pl.duration,
          batchId: pl.recommendedBatchId ?? "",
          quantity: String(pl.requestedQuantity ?? (pl.onHand > 0 ? 1 : 0)),
          onHand: pl.onHand,
          batches: pl.batches,
          enabled: !!pl.recommendedBatchId,
          requiresPrescription: pl.requiresPrescription,
        })));
        setStep(3);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load prescription"))
      .finally(() => setBusy(false));
  };

  const useExisting = () => {
    if (!selectedRxId) return setError("Select an active prescription");
    setSelectedRxId(selectedRxId);
    planFrom(selectedRxId);
  };

  const createRxThenPlan = async () => {
    setError("");
    const validLines = newRxLines.filter((l) => l.medicineId);
    if (!validLines.length) return setError("Add at least one medicine to the prescription");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("patientId", patient!.id);
      if (newRx.doctorName) fd.append("doctorName", newRx.doctorName);
      if (newRx.department) fd.append("department", newRx.department);
      if (newRx.diagnosisNotes) fd.append("diagnosisNotes", newRx.diagnosisNotes);
      fd.append("medicines", JSON.stringify(validLines.map((l) => ({
        medicineId: l.medicineId, dosage: l.dosage, quantity: l.quantity ? Number(l.quantity) : undefined,
      }))));
      if (file) fd.append("prescription", file);
      const created = await api<{ id: string }>("/prescriptions", { method: "POST", body: fd });
      planFrom(created.id);
      setSelectedRxId(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create prescription");
    } finally { setBusy(false); }
  };

  const setLine = (i: number, patch: Partial<DispLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const confirmLines = useMemo(() => lines.filter((l) => l.enabled && l.batchId && Number(l.quantity) > 0), [lines]);

  const lineError = (l: DispLine): string => {
    if (!l.enabled) return "";
    const qty = Number(l.quantity);
    if (!l.batchId) return "No stock available";
    if (qty <= 0) return "Enter a quantity";
    const batch = l.batches.find((b) => b.id === l.batchId);
    if (batch && qty > batch.quantity) return `Only ${batch.quantity} in batch`;
    return "";
  };

  const dispense = async () => {
    setError(""); setSuccess("");
    if (!confirmLines.length) return setError("No dispensable lines selected");
    for (const l of confirmLines) {
      const le = lineError(l);
      if (le) return setError(`${l.medicineName}: ${le}`);
    }
    setBusy(true);
    try {
      const res = await api<{ count: number }>("/dispensing/batch", {
        method: "POST",
        body: JSON.stringify({
          patientId: patient!.id,
          prescriptionId: selectedRxId,
          dispensingPurpose: purpose || undefined,
          prescribingDepartment: department || undefined,
          lines: confirmLines.map((l) => ({
            medicineId: l.medicineId,
            batchId: l.batchId,
            quantity: Number(l.quantity),
            dosage: l.dosage || undefined,
            form: l.form || undefined,
            duration: l.duration || undefined,
          })),
        }),
      });
      setSuccess(`Dispensed ${res.count} medicine line(s) to ${patient!.firstName} ${patient!.lastName}.`);
      // Reset for next patient
      setStep(1); setPatient(null); setPq(""); setResults([]); setRxList([]);
      setSelectedRxId(""); setLines([]); setPurpose(""); setDepartment("");
      setNewRxLines([{ medicineId: "", dosage: "", quantity: "" }]); setNewRx({ doctorName: "", department: "", diagnosisNotes: "" }); setFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dispensing failed");
    } finally { setBusy(false); }
  };

  if (!hasAccess) return null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Stepper step={step} />
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      {/* Selected patient chip */}
      {patient && step > 1 && (
        <div className="flex items-center justify-between rounded-lg border bg-slate-50 px-3 py-2 text-sm">
          <span><Check className="mr-1 inline h-4 w-4 text-emerald-600" /><strong>{patient.firstName} {patient.lastName}</strong> · {patient.patientId}{patient.age ? ` · ${patient.gender}, ${patient.age}y` : ""}</span>
          <Button size="sm" variant="ghost" onClick={() => { setStep(1); setPatient(null); }}>Change</Button>
        </div>
      )}

      {/* STEP 1 — Patient */}
      {step === 1 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            {!registerMode ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input className="pl-9" placeholder="" value={pq} onChange={(e) => setPq(e.target.value)} autoFocus />
                  </div>
                  <Button variant="outline" onClick={() => { setRegisterMode(true); setError(""); }}>
                    <UserPlus className="mr-1.5 h-4 w-4" /> Register
                  </Button>
                </div>
                <div className="divide-y rounded-lg border">
                  {results.map((p) => (
                    <button key={p.id} type="button" onClick={() => selectPatient(p)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                      <span><strong>{p.firstName} {p.lastName}</strong> · {p.patientId}{p.age ? ` · ${p.gender}, ${p.age}y` : ""}{p.phoneNumber ? ` · ${p.phoneNumber}` : ""}</span>
                      <span className="text-medflow-600">Select →</span>
                    </button>
                  ))}
                  {pq.trim().length >= 2 && results.length === 0 && (
                    <div className="px-3 py-3 text-sm text-slate-500">
                      No patient found. <button type="button" className="text-medflow-600 underline" onClick={() => setRegisterMode(true)}>Register a new patient</button>.
                    </div>
                  )}
                  {pq.trim().length < 2 && <div className="px-3 py-3 text-sm text-slate-400">Type at least 2 characters to search.</div>}
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <p className="font-medium">Register new patient</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>First name *</Label><Input value={reg.firstName} onChange={(e) => setReg({ ...reg, firstName: sanitizePersonName(e.target.value) })} /></div>
                  <div><Label>Last name *</Label><Input value={reg.lastName} onChange={(e) => setReg({ ...reg, lastName: sanitizePersonName(e.target.value) })} /></div>
                  <div>
                    <Label>Gender</Label>
                    <select className="h-11 w-full rounded-lg border px-3 text-sm" value={reg.gender} onChange={(e) => setReg({ ...reg, gender: e.target.value })}>
                      <option>Female</option><option>Male</option><option>Other</option>
                    </select>
                  </div>
                  <div><Label>Age *</Label><Input inputMode="numeric" value={reg.age} onChange={(e) => setReg({ ...reg, age: e.target.value.replace(/\D/g, "") })} /></div>
                  <div className="sm:col-span-2"><Label>Phone</Label><Input inputMode="tel" value={reg.phoneNumber} onChange={(e) => setReg({ ...reg, phoneNumber: sanitizePhone(e.target.value) })} placeholder="Phone number" /></div>
                </div>
                <div className="flex gap-2">
                  <Button onClick={registerPatient} disabled={busy}>{busy ? "Saving…" : "Save & continue"}</Button>
                  <Button variant="outline" onClick={() => setRegisterMode(false)}>Back to search</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 2 — Prescription */}
      {step === 2 && patient && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex gap-2 text-sm">
              <button type="button" onClick={() => setRxMode("existing")} className={`rounded-full border px-3 py-1 font-medium ${rxMode === "existing" ? "border-medflow-300 bg-medflow-50 text-medflow-700" : "border-slate-200 text-slate-500"}`}>Existing prescription</button>
              <button type="button" onClick={() => setRxMode("new")} className={`rounded-full border px-3 py-1 font-medium ${rxMode === "new" ? "border-medflow-300 bg-medflow-50 text-medflow-700" : "border-slate-200 text-slate-500"}`}>Create new</button>
            </div>

            {rxMode === "existing" ? (
              <div className="space-y-3">
                {rxList.length === 0 ? (
                  <p className="text-sm text-amber-600">No active prescriptions for this patient. Switch to “Create new”.</p>
                ) : (
                  <div className="divide-y rounded-lg border">
                    {rxList.map((rx) => (
                      <label key={rx.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                        <input type="radio" name="rx" className="accent-medflow-600" checked={selectedRxId === rx.id} onChange={() => setSelectedRxId(rx.id)} />
                        <span><strong>{rx.prescriptionId}</strong>{rx.doctorName ? ` · ${rx.doctorName}` : ""}{rx.medicines ? ` · ${rx.medicines.length} med(s)` : ""}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Button onClick={useExisting} disabled={busy || !selectedRxId}>Continue</Button>
                  <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Doctor</Label><Input value={newRx.doctorName} onChange={(e) => setNewRx({ ...newRx, doctorName: e.target.value.replace(/[^A-Za-z .'-]/g, "") })} /></div>
                  <div><Label>Department</Label><Input value={newRx.department} onChange={(e) => setNewRx({ ...newRx, department: e.target.value })} placeholder="Department" /></div>
                  <div className="sm:col-span-2"><Label>Diagnosis</Label><Input value={newRx.diagnosisNotes} onChange={(e) => setNewRx({ ...newRx, diagnosisNotes: e.target.value })} /></div>
                  <div><Label>Upload scan (optional)</Label><Input type="file" accept="image/jpeg,image/png,image/jpg,.pdf,application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} /></div>
                </div>
                <div>
                  <Label>Medicines</Label>
                  <div className="space-y-2">
                    {newRxLines.map((ln, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select className="h-10 flex-1 rounded-lg border px-2 text-sm" value={ln.medicineId} onChange={(e) => setNewRxLines((ls) => ls.map((x, idx) => idx === i ? { ...x, medicineId: e.target.value } : x))}>
                          <option value="">Select medicine</option>
                          {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
                        </select>
                        <Input className="w-24" placeholder="Dosage" value={ln.dosage} onChange={(e) => setNewRxLines((ls) => ls.map((x, idx) => idx === i ? { ...x, dosage: e.target.value } : x))} />
                        <Input className="w-20" inputMode="numeric" placeholder="Qty" value={ln.quantity} onChange={(e) => setNewRxLines((ls) => ls.map((x, idx) => idx === i ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x))} />
                        {newRxLines.length > 1 && <button type="button" className="text-sm text-red-500" onClick={() => setNewRxLines((ls) => ls.filter((_, idx) => idx !== i))}>Remove</button>}
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => setNewRxLines((ls) => [...ls, { medicineId: "", dosage: "", quantity: "" }])}>+ Add medicine</Button>
                </div>
                <div className="flex gap-2">
                  <Button onClick={createRxThenPlan} disabled={busy}>{busy ? "Saving…" : "Create & continue"}</Button>
                  <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 3 — Medicines */}
      {step === 3 && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">FEFO batch auto-selected per line. Adjust quantity or batch, then continue.</p>
            <div className="space-y-2">
              {lines.map((l, i) => {
                const le = lineError(l);
                return (
                  <div key={l.medicineId} className={`rounded-lg border p-3 ${!l.enabled ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <label className="flex items-center gap-2 font-medium">
                        <input type="checkbox" className="h-4 w-4 accent-medflow-600" checked={l.enabled} disabled={!l.batches.length} onChange={(e) => setLine(i, { enabled: e.target.checked })} />
                        {l.medicineName}{l.dosage ? ` · ${l.dosage}` : ""}
                        {l.requiresPrescription && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                            <FileText className="h-3 w-3" /> Rx Required
                          </span>
                        )}
                      </label>
                      <span className="text-sm text-slate-500">On hand: {l.onHand}</span>
                    </div>
                    {l.batches.length === 0 ? (
                      <p className="mt-1 text-sm text-red-600">Out of stock — line disabled.</p>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-end gap-2">
                        <div>
                          <Label className="text-sm">Batch (FEFO)</Label>
                          <select className="h-9 rounded-lg border px-2 text-sm" value={l.batchId} disabled={!l.enabled} onChange={(e) => setLine(i, { batchId: e.target.value })}>
                            {l.batches.map((b) => <option key={b.id} value={b.id}>{b.batchNumber} · exp {new Date(b.expiryDate).toLocaleDateString()} · {b.quantity} left</option>)}
                          </select>
                        </div>
                        <div>
                          <Label className="text-sm">Quantity</Label>
                          <Input className="w-24" inputMode="numeric" disabled={!l.enabled} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, "") })} />
                        </div>
                        {le && <span className="pb-2 text-sm text-red-600">{le}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
              {lines.length === 0 && <p className="text-sm text-muted-foreground">This prescription has no medicine lines.</p>}
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setStep(4)} disabled={confirmLines.length === 0}>Continue</Button>
              <Button variant="outline" onClick={() => setStep(2)}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* STEP 4 — Confirm */}
      {step === 4 && patient && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="font-medium">Confirm dispensing</p>
            <ul className="space-y-1 rounded-lg border p-3 text-sm">
              {confirmLines.map((l) => {
                const batch = l.batches.find((b) => b.id === l.batchId);
                return <li key={l.medicineId}>• {l.medicineName} — <strong>{l.quantity}</strong>{l.dosage ? ` (${l.dosage})` : ""} from batch {batch?.batchNumber}</li>;
              })}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Dispensing purpose</Label><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Dispensing purpose" /></div>
              <div><Label>Prescribing department</Label><Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Department" /></div>
            </div>
            <div className="flex gap-2">
              <Button onClick={dispense} disabled={busy}>{busy ? "Dispensing…" : "Confirm & Dispense"}</Button>
              <Button variant="outline" onClick={() => setStep(3)}>Back</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DispensePage() {
  return (
    <div className="space-y-4">
      <OperationsTabs />
      <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading…</p>}>
        <DispenseWorkflow />
      </Suspense>
    </div>
  );
}
