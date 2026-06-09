"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Check, FileText, Search, UserPlus, ClipboardList, Syringe, Upload, Loader2, Plus, Trash2, AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import { api } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { sanitizePersonName, sanitizePhone, validators } from "@/lib/validation";
import { OperationsTabs } from "@/components/layout/operations-tabs";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";

interface Patient { id: string; patientId: string; firstName: string; lastName: string; gender?: string; age?: number; phoneNumber?: string | null }
interface RxOption { id: string; prescriptionId: string; status: string; doctorName?: string | null; diagnosisNotes?: string | null; medicines?: { medicineId: string }[] }
interface Medicine { id: string; medicineName: string }
interface PlanBatch { id: string; batchNumber: string; expiryDate: string; quantity: number }
interface PlanLine {
  medicineId: string; medicineName: string; dosage: string; form: string; duration: string;
  requestedQuantity: number | null; onHand: number; recommendedBatchId: string | null; batches: PlanBatch[];
  requiresPrescription: boolean;
}
interface DispLine {
  medicineId: string; medicineName: string; dosage: string; form: string; duration: string;
  batchId: string; quantity: string; onHand: number; batches: PlanBatch[];
  enabled: boolean; requiresPrescription: boolean;
}

type Step = 1 | 2 | 3;

const STEPS = [
  { n: 1, label: "Patient",                  icon: Search },
  { n: 2, label: "Prescription & Medicines", icon: ClipboardList },
  { n: 3, label: "Confirm",                  icon: Syringe },
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

function planLineToDispLine(pl: PlanLine): DispLine {
  return {
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
  };
}

// ── OCR medicine matching ──────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  const curr = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = [...curr];
  }
  return prev[b.length];
}

function matchMedicines(ocrName: string, medicines: Medicine[]): Medicine[] {
  const q = ocrName.toLowerCase().trim();
  if (!q) return [];

  // 1. Exact
  const exact = medicines.filter((m) => m.medicineName === ocrName);
  if (exact.length) return exact;

  // 2. Case-insensitive exact
  const ci = medicines.filter((m) => m.medicineName.toLowerCase() === q);
  if (ci.length) return ci;

  // 3. Starts-with (medicine name starts with OCR query — most common: "Paracetamol" → "Paracetamol 500mg")
  const sw = medicines.filter((m) => m.medicineName.toLowerCase().startsWith(q));
  if (sw.length) return sw;

  // 4. Contains
  const contains = medicines.filter((m) => m.medicineName.toLowerCase().includes(q));
  if (contains.length) return contains;

  // 5. Fuzzy (Levenshtein similarity > 0.5)
  return medicines
    .map((m) => {
      const name = m.medicineName.toLowerCase();
      const dist = levenshtein(q, name);
      return { medicine: m, similarity: 1 - dist / Math.max(q.length, name.length) };
    })
    .filter((x) => x.similarity > 0.5)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5)
    .map((x) => x.medicine);
}

function DispenseWorkflow() {
  const hasAccess = useRequirePermission("dispensing");
  const searchParams = useSearchParams();

  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  /* ── Step 1 — patient ── */
  const [pq, setPq] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [registerMode, setRegisterMode] = useState(false);
  const [reg, setReg] = useState({ firstName: "", lastName: "", gender: "Female", age: "", phoneNumber: "" });

  /* ── Step 2 — prescription ── */
  const [rxList, setRxList] = useState<RxOption[]>([]);
  const [rxMode, setRxMode] = useState<"existing" | "new">("existing");
  const [selectedRxId, setSelectedRxId] = useState("");
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [newRx, setNewRx] = useState({ doctorName: "", diagnosisNotes: "" });
  const [newRxLines, setNewRxLines] = useState<{ medicineId: string; dosage: string; quantity: string }[]>([
    { medicineId: "", dosage: "", quantity: "" },
  ]);
  const [file, setFile] = useState<File | null>(null);

  type OcrState = "idle" | "scanning" | "done" | "failed";
  interface OcrResult {
    rawText: string;
    confidence?: number;
    doctorName?: string | null;
    diagnosisNotes?: string | null;
    medicines?: { medicineName: string; dosage?: string; quantity?: number }[];
    fieldsDetected?: string[];
    warnings?: string[];
    error?: string;
    details?: string;
  }
  const [ocrState, setOcrState] = useState<OcrState>("idle");
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [rawTextOpen, setRawTextOpen] = useState(false);
  interface OcrLineMatch { lineIndex: number; ocrName: string; candidates: Medicine[] }
  const [ocrAmbiguous, setOcrAmbiguous] = useState<OcrLineMatch[]>([]);

  /* prescription summary carried to confirm screen */
  const [rxSummary, setRxSummary] = useState({ doctorName: "", diagnosisNotes: "" });

  /* whether the dispensing plan has been loaded within step 2 */
  const [planLoaded, setPlanLoaded] = useState(false);

  /* ── Step 2/3 — dispense lines ── */
  const [lines, setLines] = useState<DispLine[]>([]);

  useEffect(() => { api<Medicine[]>("/medicines").then(setMedicines).catch(() => {}); }, []);

  /* patient search (debounced) */
  useEffect(() => {
    if (registerMode) return;
    const t = setTimeout(() => {
      if (pq.trim().length < 2) { setResults([]); return; }
      api<Patient[]>(`/patients?q=${encodeURIComponent(pq.trim())}`).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [pq, registerMode]);

  /* preselect patient from ?patientId */
  useEffect(() => {
    const pid = searchParams.get("patientId");
    if (pid) api<Patient>(`/patients/${pid}`).then(selectPatient).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPrescriptions = (patientId: string) => {
    api<RxOption[]>(`/prescriptions?patientId=${patientId}`)
      .then((list) => {
        const active = list.filter((r) => r.status === "ACTIVE");
        setRxList(active);
        setRxMode(active.length ? "existing" : "new");
        if (active.length === 1) setSelectedRxId(active[0].id);
      })
      .catch(() => setRxList([]));
  };

  function selectPatient(p: Patient) {
    setError("");
    setPatient(p);
    setPlanLoaded(false);
    setLines([]);
    setSelectedRxId("");
    loadPrescriptions(p.id);
    setStep(2);
  }

  const registerPatient = async () => {
    setError("");
    const f = validators.personName(reg.firstName, "First name"); if (f) return setError(f);
    const l = validators.personName(reg.lastName, "Last name"); if (l) return setError(l);
    const a = validators.age(reg.age); if (a) return setError(a);
    const ph = validators.phone(reg.phoneNumber); if (ph) return setError(ph);
    setBusy(true);
    try {
      const created = await api<Patient>("/patients", { method: "POST", body: JSON.stringify({ ...reg, age: Number(reg.age) }) });
      setRegisterMode(false);
      selectPatient(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to register patient");
    } finally { setBusy(false); }
  };

  const planFrom = (rxId: string) => {
    setBusy(true); setError("");
    api<{ lines: PlanLine[] }>(`/dispensing/prescription/${rxId}/plan`)
      .then(({ lines: pl }) => { setLines(pl.map(planLineToDispLine)); setPlanLoaded(true); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dispensing plan"))
      .finally(() => setBusy(false));
  };

  /* auto-load plan when an existing prescription is selected */
  useEffect(() => {
    if (rxMode !== "existing" || !selectedRxId) return;
    const rx = rxList.find((r) => r.id === selectedRxId);
    if (rx) setRxSummary({ doctorName: rx.doctorName ?? "", diagnosisNotes: rx.diagnosisNotes ?? "" });
    planFrom(selectedRxId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRxId, rxMode]);

  const switchRxMode = (mode: "existing" | "new") => {
    setRxMode(mode);
    setPlanLoaded(false);
    setLines([]);
    setOcrAmbiguous([]);
  };

  /* OCR: upload image → extract fields → auto-populate form */
  const handleOcr = async () => {
    if (!file) return;
    setOcrState("scanning");
    setOcrResult(null);
    setRawTextOpen(false);
    setOcrAmbiguous([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await api<OcrResult>("/prescriptions/ocr", { method: "POST", body: fd });
      setOcrResult(result);
      setOcrState("done");

      // Auto-populate editable form fields
      if (result.doctorName) setNewRx((r) => ({ ...r, doctorName: result.doctorName! }));
      if (result.diagnosisNotes) setNewRx((r) => ({ ...r, diagnosisNotes: result.diagnosisNotes! }));

      // Priority-based medicine matching (exact → case-insensitive → starts-with → contains → fuzzy)
      if (result.medicines?.length) {
        const mapped: { medicineId: string; dosage: string; quantity: string }[] = [];
        const ambiguous: OcrLineMatch[] = [];

        result.medicines.forEach((m, idx) => {
          const candidates = matchMedicines(m.medicineName, medicines);
          mapped.push({
            medicineId: candidates.length === 1 ? candidates[0].id : "",
            dosage: m.dosage ?? "",
            quantity: m.quantity ? String(m.quantity) : "",
          });
          if (candidates.length !== 1) {
            ambiguous.push({ lineIndex: idx, ocrName: m.medicineName, candidates });
          }
        });

        setNewRxLines(mapped.length ? mapped : [{ medicineId: "", dosage: "", quantity: "" }]);
        setOcrAmbiguous(ambiguous);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setOcrState("failed");
      setOcrResult({ rawText: "", error: msg });
    }
  };

  const selectOcrMedicine = (lineIndex: number, medicineId: string) => {
    setNewRxLines((ls) => ls.map((l, idx) => (idx === lineIndex ? { ...l, medicineId } : l)));
    setOcrAmbiguous((prev) => prev.filter((x) => x.lineIndex !== lineIndex));
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
      if (newRx.diagnosisNotes) fd.append("diagnosisNotes", newRx.diagnosisNotes);
      fd.append("medicines", JSON.stringify(validLines.map((l) => ({
        medicineId: l.medicineId, dosage: l.dosage, quantity: l.quantity ? Number(l.quantity) : undefined,
      }))));
      if (file) fd.append("prescription", file);
      const created = await api<{ id: string }>("/prescriptions", { method: "POST", body: fd });
      setSelectedRxId(created.id);
      setRxSummary({ doctorName: newRx.doctorName, diagnosisNotes: newRx.diagnosisNotes });
      planFrom(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create prescription");
    } finally { setBusy(false); }
  };

  const setLine = (i: number, patch: Partial<DispLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const confirmLines = useMemo(() => lines.filter((l) => l.enabled && l.batchId && Number(l.quantity) > 0), [lines]);

  const lineError = (l: DispLine): string => {
    if (!l.enabled) return "";
    if (!l.batchId) return "No stock";
    if (Number(l.quantity) <= 0) return "Enter qty";
    const batch = l.batches.find((b) => b.id === l.batchId);
    if (batch && Number(l.quantity) > batch.quantity) return `Max ${batch.quantity}`;
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
          lines: confirmLines.map((l) => ({
            medicineId: l.medicineId, batchId: l.batchId, quantity: Number(l.quantity),
            dosage: l.dosage || undefined, form: l.form || undefined, duration: l.duration || undefined,
          })),
        }),
      });
      setSuccess(`Dispensed ${res.count} medicine line(s) to ${patient!.firstName} ${patient!.lastName}.`);
      setStep(1); setPatient(null); setPq(""); setResults([]); setRxList([]);
      setSelectedRxId(""); setLines([]); setPlanLoaded(false);
      setNewRxLines([{ medicineId: "", dosage: "", quantity: "" }]);
      setNewRx({ doctorName: "", diagnosisNotes: "" }); setFile(null);
      setOcrState("idle"); setOcrResult(null); setRawTextOpen(false); setOcrAmbiguous([]);
      setRxSummary({ doctorName: "", diagnosisNotes: "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Dispensing failed");
    } finally { setBusy(false); }
  };

  if (!hasAccess) return null;

  /* ── render ── */
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <Stepper step={step} />
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      {patient && step > 1 && (
        <div className="flex items-center justify-between rounded-lg border bg-slate-50 px-3 py-2 text-sm">
          <span>
            <Check className="mr-1 inline h-4 w-4 text-emerald-600" />
            <strong>{patient.firstName} {patient.lastName}</strong> · {patient.patientId}
            {patient.age ? ` · ${patient.gender}, ${patient.age}y` : ""}
          </span>
          <Button size="sm" variant="ghost" onClick={() => { setStep(1); setPatient(null); }}>Change</Button>
        </div>
      )}

      {/* ── STEP 1: Patient (unchanged) ── */}
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
                    <button key={p.id} type="button" onClick={() => selectPatient(p)}
                      className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                      <span>
                        <strong>{p.firstName} {p.lastName}</strong> · {p.patientId}
                        {p.age ? ` · ${p.gender}, ${p.age}y` : ""}
                        {p.phoneNumber ? ` · ${p.phoneNumber}` : ""}
                      </span>
                      <span className="text-medflow-600">Select →</span>
                    </button>
                  ))}
                  {pq.trim().length >= 2 && results.length === 0 && (
                    <div className="px-3 py-3 text-sm text-slate-500">
                      No patient found.{" "}
                      <button type="button" className="text-medflow-600 underline" onClick={() => setRegisterMode(true)}>
                        Register a new patient
                      </button>.
                    </div>
                  )}
                  {pq.trim().length < 2 && (
                    <div className="px-3 py-3 text-sm text-slate-400">Type at least 2 characters to search.</div>
                  )}
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
                  <div className="sm:col-span-2">
                    <Label>Phone</Label>
                    <Input inputMode="tel" value={reg.phoneNumber} onChange={(e) => setReg({ ...reg, phoneNumber: sanitizePhone(e.target.value) })} placeholder="Phone number" />
                  </div>
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

      {/* ── STEP 2: Prescription & Medicines ── */}
      {step === 2 && patient && (
        <Card>
          <CardContent className="space-y-4 p-4">

            {planLoaded ? (
              /* ── Plan loaded: show dispense adjustment table ── */
              <>
                {(rxSummary.doctorName || rxSummary.diagnosisNotes) && (
                  <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {rxSummary.doctorName && <span className="font-medium">Dr. {rxSummary.doctorName}</span>}
                    {rxSummary.doctorName && rxSummary.diagnosisNotes && " · "}
                    {rxSummary.diagnosisNotes && <span>{rxSummary.diagnosisNotes}</span>}
                  </div>
                )}

                <p className="text-sm text-slate-500">
                  FEFO batch auto-selected. Uncheck lines to skip, or adjust qty before continuing.
                </p>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr>
                        <th className="p-2 pl-3 w-8"></th>
                        <th className="p-2">Medicine</th>
                        <th className="p-2 w-28">Dosage</th>
                        <th className="p-2">Batch (FEFO)</th>
                        <th className="p-2 w-24 text-right">Qty</th>
                        <th className="p-2 w-24 text-right">On Hand</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {lines.length === 0 && (
                        <tr><td colSpan={6} className="p-4 text-center text-slate-400">No medicine lines.</td></tr>
                      )}
                      {lines.map((l, i) => {
                        const le = lineError(l);
                        return (
                          <tr key={l.medicineId} className={!l.enabled ? "bg-slate-50/60 opacity-50" : ""}>
                            <td className="p-2 pl-3">
                              <input type="checkbox" className="h-4 w-4 accent-medflow-600"
                                checked={l.enabled} disabled={l.batches.length === 0}
                                onChange={(e) => setLine(i, { enabled: e.target.checked })} />
                            </td>
                            <td className="p-2">
                              <span className="font-medium">{l.medicineName}</span>
                              {l.requiresPrescription && (
                                <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                                  <FileText className="h-3 w-3" /> Rx
                                </span>
                              )}
                              {l.batches.length === 0 && <span className="ml-2 text-xs text-red-500">Out of stock</span>}
                            </td>
                            <td className="p-2 text-slate-500">{l.dosage || "—"}</td>
                            <td className="p-2">
                              {l.batches.length > 0 ? (
                                <select className="h-8 rounded border px-2 text-xs" value={l.batchId}
                                  disabled={!l.enabled}
                                  onChange={(e) => setLine(i, { batchId: e.target.value })}>
                                  {l.batches.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.batchNumber} · exp {new Date(b.expiryDate).toLocaleDateString()} · {b.quantity}
                                    </option>
                                  ))}
                                </select>
                              ) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="p-2">
                              <div className="flex items-center justify-end gap-1">
                                <Input className="w-20 text-right" inputMode="numeric"
                                  disabled={!l.enabled || l.batches.length === 0}
                                  value={l.quantity}
                                  onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, "") })} />
                                {le && <span className="text-[11px] text-red-500 whitespace-nowrap">{le}</span>}
                              </div>
                            </td>
                            <td className="p-2 text-right text-slate-500">{l.onHand}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="flex gap-2">
                  <Button onClick={() => setStep(3)} disabled={confirmLines.length === 0}>
                    Continue to Confirm
                  </Button>
                  <Button variant="outline"
                    onClick={() => { setPlanLoaded(false); setLines([]); setSelectedRxId(""); }}>
                    ← Change Prescription
                  </Button>
                </div>
              </>
            ) : (
              /* ── Prescription form ── */
              <>
                <div className="flex gap-2 text-sm">
                  <button type="button"
                    onClick={() => switchRxMode("existing")}
                    className={`rounded-full border px-3 py-1 font-medium ${rxMode === "existing" ? "border-medflow-300 bg-medflow-50 text-medflow-700" : "border-slate-200 text-slate-500"}`}>
                    Existing prescription
                  </button>
                  <button type="button"
                    onClick={() => switchRxMode("new")}
                    className={`rounded-full border px-3 py-1 font-medium ${rxMode === "new" ? "border-medflow-300 bg-medflow-50 text-medflow-700" : "border-slate-200 text-slate-500"}`}>
                    New prescription
                  </button>
                </div>

                {rxMode === "existing" ? (
                  <div className="space-y-3">
                    {rxList.length === 0 ? (
                      <p className="text-sm text-amber-600">No active prescriptions. Switch to "New prescription".</p>
                    ) : (
                      <div className="divide-y rounded-lg border">
                        {rxList.map((rx) => (
                          <label key={rx.id} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                            <input type="radio" name="rx" className="accent-medflow-600"
                              checked={selectedRxId === rx.id} onChange={() => setSelectedRxId(rx.id)} />
                            <span>
                              <strong>{rx.prescriptionId}</strong>
                              {rx.doctorName ? ` · Dr. ${rx.doctorName}` : ""}
                              {rx.diagnosisNotes ? ` · ${rx.diagnosisNotes}` : ""}
                              {rx.medicines ? ` · ${rx.medicines.length} med(s)` : ""}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    {busy && <p className="text-sm text-slate-400">Loading plan…</p>}
                    <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                  </div>
                ) : (
                  /* New prescription form */
                  <div className="space-y-4">
                    {/* OCR upload + status */}
                    <div className="space-y-2 rounded-lg border border-dashed p-3">
                      <p className="text-sm font-medium text-slate-600">Upload prescription scan (optional — OCR auto-fills fields)</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="file"
                          accept="image/jpeg,image/png,image/jpg"
                          className="flex-1 min-w-0"
                          onChange={(e) => {
                            setFile(e.target.files?.[0] || null);
                            setOcrState("idle");
                            setOcrResult(null);
                            setOcrAmbiguous([]);
                          }}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!file || ocrState === "scanning"}
                          onClick={handleOcr}
                        >
                          {ocrState === "scanning"
                            ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Running OCR…</>
                            : <><Upload className="mr-1.5 h-4 w-4" /> Scan & Auto-fill</>}
                        </Button>
                      </div>

                      {/* Idle hint */}
                      {ocrState === "idle" && file && (
                        <p className="text-xs text-slate-400">JPG/PNG only. Click "Scan & Auto-fill" to extract Doctor, Diagnosis, and Medicines.</p>
                      )}

                      {/* Scanning */}
                      {ocrState === "scanning" && (
                        <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                          <span>Running OCR on the image — this may take a few seconds on first run…</span>
                        </div>
                      )}

                      {/* Done */}
                      {ocrState === "done" && ocrResult && (
                        <div className="space-y-1.5 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                          <div className="flex items-center gap-2 font-medium text-green-700">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            OCR Complete
                            {ocrResult.confidence !== undefined && (
                              <span className="ml-auto text-xs font-normal text-green-600">
                                {ocrResult.confidence}% confidence
                              </span>
                            )}
                          </div>

                          {(ocrResult.fieldsDetected?.length ?? 0) > 0 ? (
                            <p className="text-xs text-green-700">
                              Fields detected: <strong>{ocrResult.fieldsDetected!.join(", ")}</strong>
                            </p>
                          ) : (
                            <p className="text-xs font-medium text-orange-600">
                              No prescription fields detected. Check the raw text below and fill in manually.
                            </p>
                          )}

                          {(ocrResult.warnings?.length ?? 0) > 0 && (
                            <ul className="space-y-0.5">
                              {ocrResult.warnings!.map((w, i) => (
                                <li key={i} className="text-xs text-amber-700">⚠ {w}</li>
                              ))}
                            </ul>
                          )}

                          {/* Raw text toggle */}
                          <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                            onClick={() => setRawTextOpen((v) => !v)}
                          >
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rawTextOpen ? "rotate-180" : ""}`} />
                            {rawTextOpen ? "Hide" : "Show"} raw OCR text
                          </button>
                          {rawTextOpen && (
                            <pre className="mt-1 max-h-40 overflow-auto rounded bg-white p-2 text-xs text-slate-700 whitespace-pre-wrap border">
                              {ocrResult.rawText || "(empty — image may be blank or unreadable)"}
                            </pre>
                          )}

                          {/* Ambiguous / unmatched medicine resolution */}
                          {ocrAmbiguous.length > 0 && (
                            <div className="mt-2 space-y-1.5 border-t border-green-200 pt-2">
                              {ocrAmbiguous.map((item) => (
                                <div
                                  key={item.lineIndex}
                                  className={`rounded border p-2 text-xs ${item.candidates.length ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}
                                >
                                  <p className={item.candidates.length ? "text-amber-800" : "text-red-700"}>
                                    OCR: <strong>&ldquo;{item.ocrName}&rdquo;</strong>
                                    {item.candidates.length === 0
                                      ? " — not found in medicine master"
                                      : " — select the correct match:"}
                                  </p>
                                  {item.candidates.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {item.candidates.map((c) => (
                                        <button
                                          key={c.id}
                                          type="button"
                                          className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-amber-100"
                                          onClick={() => selectOcrMedicine(item.lineIndex, c.id)}
                                        >
                                          {c.medicineName}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  {item.candidates.length === 0 && (
                                    <p className="mt-0.5 text-red-600">Search manually in the table below.</p>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Failed */}
                      {ocrState === "failed" && ocrResult && (
                        <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                          <div className="flex items-center gap-2 font-medium text-red-700">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            OCR Failed — fill in fields manually
                          </div>
                          <p className="text-xs text-red-600">{ocrResult.error ?? "Unknown error"}</p>
                          {ocrResult.details && (
                            <p className="text-xs text-red-500 font-mono">{ocrResult.details}</p>
                          )}
                          {ocrResult.rawText && (
                            <>
                              <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                                onClick={() => setRawTextOpen((v) => !v)}
                              >
                                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rawTextOpen ? "rotate-180" : ""}`} />
                                {rawTextOpen ? "Hide" : "Show"} partial OCR text
                              </button>
                              {rawTextOpen && (
                                <pre className="mt-1 max-h-40 overflow-auto rounded bg-white p-2 text-xs text-slate-700 whitespace-pre-wrap border">
                                  {ocrResult.rawText}
                                </pre>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Doctor + Diagnosis */}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label>Doctor</Label>
                        <Input value={newRx.doctorName}
                          onChange={(e) => setNewRx({ ...newRx, doctorName: e.target.value.replace(/[^A-Za-z .'-]/g, "") })}
                          placeholder="Doctor name" />
                      </div>
                      <div>
                        <Label>Diagnosis</Label>
                        <Input value={newRx.diagnosisNotes}
                          onChange={(e) => setNewRx({ ...newRx, diagnosisNotes: e.target.value })}
                          placeholder="Diagnosis / notes" />
                      </div>
                    </div>

                    {/* Medicine table */}
                    <div>
                      <Label className="mb-1.5 block">Medicines</Label>
                      <div className="rounded-lg border">
                        <table className="w-full min-w-[480px] text-sm">
                          <thead className="bg-slate-50 text-left text-xs text-slate-500">
                            <tr>
                              <th className="p-2 pl-3">Medicine</th>
                              <th className="p-2 w-32">Dosage</th>
                              <th className="p-2 w-24 text-right">Qty</th>
                              <th className="p-2 w-10"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {newRxLines.map((ln, i) => (
                              <tr key={i}>
                                <td className="p-2 pl-3">
                                  <MedicineCombobox
                                    medicines={medicines}
                                    value={ln.medicineId}
                                    onChange={(id) => setNewRxLines((ls) => ls.map((x, idx) => idx === i ? { ...x, medicineId: id } : x))}
                                    className="h-9"
                                  />
                                </td>
                                <td className="p-2">
                                  <Input placeholder="e.g. 500mg" value={ln.dosage}
                                    onChange={(e) => setNewRxLines((ls) => ls.map((x, idx) => idx === i ? { ...x, dosage: e.target.value } : x))} />
                                </td>
                                <td className="p-2">
                                  <Input className="text-right" inputMode="numeric" placeholder="Qty" value={ln.quantity}
                                    onChange={(e) => setNewRxLines((ls) => ls.map((x, idx) => idx === i ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x))} />
                                </td>
                                <td className="p-2">
                                  {newRxLines.length > 1 && (
                                    <button type="button"
                                      className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500"
                                      onClick={() => setNewRxLines((ls) => ls.filter((_, idx) => idx !== i))}>
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <button type="button"
                        className="mt-2 flex items-center gap-1 text-sm text-medflow-600 hover:text-medflow-700"
                        onClick={() => setNewRxLines((ls) => [...ls, { medicineId: "", dosage: "", quantity: "" }])}>
                        <Plus className="h-4 w-4" /> Add medicine
                      </button>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={createRxThenPlan} disabled={busy}>{busy ? "Creating…" : "Create & Review"}</Button>
                      <Button variant="outline" onClick={() => setStep(1)}>← Back</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── STEP 3: Confirm ── */}
      {step === 3 && patient && (
        <Card>
          <CardContent className="space-y-4 p-4">
            <p className="font-semibold text-slate-800">Confirm Dispensing</p>

            {/* Summary */}
            <div className="grid gap-2 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-slate-500">Patient</p>
                <p className="font-medium">{patient.firstName} {patient.lastName} · {patient.patientId}</p>
              </div>
              {rxSummary.doctorName && (
                <div>
                  <p className="text-xs text-slate-500">Doctor</p>
                  <p className="font-medium">{rxSummary.doctorName}</p>
                </div>
              )}
              {rxSummary.diagnosisNotes && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-slate-500">Diagnosis</p>
                  <p className="font-medium">{rxSummary.diagnosisNotes}</p>
                </div>
              )}
            </div>

            {/* Medicines */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500">
                  <tr>
                    <th className="p-2 pl-3">Medicine</th>
                    <th className="p-2 w-32">Dosage</th>
                    <th className="p-2 w-20 text-right">Qty</th>
                    <th className="p-2 w-32 text-right">Available Stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {confirmLines.map((l) => (
                    <tr key={l.medicineId}>
                      <td className="p-2 pl-3 font-medium">{l.medicineName}</td>
                      <td className="p-2 text-slate-500">{l.dosage || "—"}</td>
                      <td className="p-2 text-right font-semibold">{l.quantity}</td>
                      <td className={`p-2 text-right font-medium ${Number(l.quantity) > l.onHand ? "text-red-600" : "text-emerald-600"}`}>
                        {l.onHand}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2">
              <Button onClick={dispense} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy ? "Dispensing…" : "Confirm & Dispense"}
              </Button>
              <Button variant="outline" onClick={() => setStep(2)}>← Back</Button>
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
