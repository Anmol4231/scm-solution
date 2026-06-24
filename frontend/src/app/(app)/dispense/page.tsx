"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  FileText, Search, UserPlus, Syringe, Upload, Loader2,
  Plus, Trash2, AlertCircle, CheckCircle2, ChevronDown, Building2, ShieldCheck,
  X, Maximize2, Minimize2, ClipboardList, Printer,
} from "lucide-react";
import { api, resolveApiUrl } from "@/lib/api";
import { useMedicines, CachedMedicine } from "@/lib/medicines-cache";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { sanitizePersonName, sanitizePhone, validators } from "@/lib/validation";
import { OperationsTabs } from "@/components/layout/operations-tabs";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";
import { levenshtein } from "@/lib/medicine-search";

interface Patient { id: string; patientId: string; firstName: string; lastName: string; gender?: string; age?: number; phoneNumber?: string | null; allergies?: string | null }
interface Medicine { id: string; medicineName: string; strengths?: { strength: string }[] }

type AvailStatus = "AVAILABLE" | "LOW_STOCK" | "OUT_OF_STOCK" | "EXPIRED_ONLY";
interface Availability { medicineId: string; availableQty: number; expiredQty: number; threshold: number; status: AvailStatus }

/** Inline real-time availability indicator shown next to each selected medicine. */
function AvailabilityBadge({ a }: { a?: Availability | null }) {
  if (a === undefined) return null; // not yet known (no medicine picked, or loading)
  if (a === null) return <span className="inline-flex items-center gap-1 text-xs text-slate-400">Checking…</span>;
  const styles: Record<AvailStatus, { cls: string; icon: string; label: string }> = {
    AVAILABLE:    { cls: "bg-emerald-50 text-emerald-700", icon: "✓", label: `Available · ${a.availableQty}` },
    LOW_STOCK:    { cls: "bg-amber-50 text-amber-700",     icon: "⚠", label: `Low Stock · ${a.availableQty}` },
    OUT_OF_STOCK: { cls: "bg-red-50 text-red-700",         icon: "✕", label: "Out of Stock" },
    EXPIRED_ONLY: { cls: "bg-red-50 text-red-700",         icon: "✕", label: `Only Expired Stock · ${a.expiredQty}` },
  };
  const s = styles[a.status];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.icon} {s.label}</span>;
}
interface PlanBatch { id: string; batchNumber: string; expiryDate: string; quantity: number }
interface PlanLine {
  medicineId: string; medicineName: string; dosage: string; form: string;
  requestedQuantity: number | null; onHand: number; recommendedBatchId: string | null; batches: PlanBatch[];
  requiresPrescription: boolean; controlled?: boolean; noQuantityWarning?: boolean;
  prescribedQuantity: number | null; alreadyDispensed: number; remainingQuantity: number | null; fulfilled: boolean;
  categoryName: string; strength: string;
}
interface DispLine {
  medicineId: string; medicineName: string; dosage: string; form: string;
  batchId: string; quantity: string; onHand: number; batches: PlanBatch[];
  enabled: boolean; requiresPrescription: boolean; controlled: boolean; noQuantityWarning: boolean;
  prescribedQuantity: number | null; alreadyDispensed: number; remainingQuantity: number | null; fulfilled: boolean;
  categoryName: string; strength: string;
}
interface AllergyInfo { patient: string | null; fromPrescriptions: string[] }
interface ActiveRx {
  id: string; prescriptionId: string; doctorName?: string | null;
  prescriptionDate: string; medicineCount: number; prescribedTotal: number; dispensedTotal: number;
}

function planLineToDispLine(pl: PlanLine): DispLine {
  return {
    medicineId: pl.medicineId, medicineName: pl.medicineName, dosage: pl.dosage,
    form: pl.form, batchId: pl.recommendedBatchId ?? "",
    quantity: String(pl.requestedQuantity ?? (pl.onHand > 0 ? 1 : 0)), onHand: pl.onHand,
    batches: pl.batches, enabled: !!pl.recommendedBatchId && !pl.fulfilled,
    requiresPrescription: pl.requiresPrescription, controlled: pl.controlled ?? false,
    noQuantityWarning: pl.noQuantityWarning ?? false, prescribedQuantity: pl.prescribedQuantity ?? null,
    alreadyDispensed: pl.alreadyDispensed ?? 0, remainingQuantity: pl.remainingQuantity ?? null,
    fulfilled: pl.fulfilled ?? false, categoryName: pl.categoryName ?? "", strength: pl.strength ?? "",
  };
}

function daysUntilExpiry(dateStr: string): number {
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - now.getTime()) / 86400000);
}

function medicineLabel(m: Medicine): string {
  if (m.strengths?.length) {
    const nameLower = m.medicineName.toLowerCase();
    const extra = m.strengths.filter((s) => { const sl = s.strength.toLowerCase(); return !nameLower.endsWith(sl) && !nameLower.includes(` ${sl}`); }).map((s) => s.strength).join(" / ");
    return extra ? `${m.medicineName} ${extra}` : m.medicineName;
  }
  return m.medicineName;
}

function matchMedicines(ocrName: string, medicines: Medicine[]): Medicine[] {
  const q = ocrName.toLowerCase().trim();
  if (!q) return [];
  const exact = medicines.filter((m) => medicineLabel(m).toLowerCase() === q);
  if (exact.length) return exact;
  const ci = medicines.filter((m) => m.medicineName.toLowerCase() === q);
  if (ci.length) return ci;
  const sw = medicines.filter((m) => m.medicineName.toLowerCase().startsWith(q) || medicineLabel(m).toLowerCase().startsWith(q));
  if (sw.length) return sw;
  const qStartsWithBase = medicines.filter((m) => q.startsWith(m.medicineName.toLowerCase()));
  if (qStartsWithBase.length) {
    return qStartsWithBase.map((m) => ({ m, dist: levenshtein(q, medicineLabel(m).toLowerCase()) })).sort((a, b) => a.dist - b.dist).slice(0, 3).map((x) => x.m);
  }
  const contains = medicines.filter((m) => medicineLabel(m).toLowerCase().includes(q) || m.medicineName.toLowerCase().includes(q));
  if (contains.length) return contains.slice(0, 10);
  const scored = medicines.map((m) => { const label = medicineLabel(m).toLowerCase(); const name = m.medicineName.toLowerCase(); const simLabel = 1 - levenshtein(q, label) / Math.max(q.length, label.length); const simName = 1 - levenshtein(q, name) / Math.max(q.length, name.length); return { medicine: m, similarity: Math.max(simLabel, simName) }; }).filter((x) => x.similarity > 0.5).sort((a, b) => b.similarity - a.similarity);
  if (!scored.length) return [];
  const top = scored[0]; const second = scored[1];
  if (top.similarity >= 0.8 && (!second || top.similarity - second.similarity >= 0.15)) return [top.medicine];
  return scored.slice(0, 5).map((x) => x.medicine);
}

function DispenseWorkflow() {
  const hasAccess = useRequirePermission("dispensing");
  const searchParams = useSearchParams();
  const { user } = useAuth();

  /* ── Facility ── */
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [facilityPickId, setFacilityPickId] = useState("");
  const [localFacilityId, setLocalFacilityId] = useState("");
  const facId = user?.facilityId ?? localFacilityId;
  const facName = user?.facility?.name ?? facilities.find((f) => f.id === facId)?.name ?? "";

  useEffect(() => {
    if (!user?.facilityId) api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
  }, [user?.facilityId]);

  /* ── Global state ── */
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  /* ── Patient ── */
  const [pq, setPq] = useState("");
  const [results, setResults] = useState<Patient[]>([]);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [registerMode, setRegisterMode] = useState(false);
  const [reg, setReg] = useState({ firstName: "", lastName: "", gender: "", age: "", phoneNumber: "", allergies: "" });

  /* ── Active Rxs for selected patient ── */
  const [activeRxs, setActiveRxs] = useState<ActiveRx[]>([]);
  const [activeRxsLoading, setActiveRxsLoading] = useState(false);
  const [rxSection, setRxSection] = useState<"select" | "create">("select");

  /* ── Prescription ── */
  const [selectedRxId, setSelectedRxId] = useState("");
  const { data: medicines = [] } = useMedicines();
  const [newRx, setNewRx] = useState({ doctorName: "", diagnosisNotes: "" });
  const [newRxLines, setNewRxLines] = useState<{ medicineId: string; dosage: string; quantity: string }[]>([{ medicineId: "", dosage: "", quantity: "" }]);
  const [file, setFile] = useState<File | null>(null);

  /* ── Real-time availability for the medicine-entry screen (pre-plan) ── */
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, Availability>>({});
  const availKnownRef = useRef<Set<string>>(new Set()); // medicineIds already fetched/in-flight for the current facility

  type OcrState = "idle" | "scanning" | "done" | "failed";
  interface OcrResult { rawText: string; confidence?: number; doctorName?: string | null; diagnosisNotes?: string | null; medicines?: { medicineName: string; strength?: string | null; dosage?: string | null; quantity?: number | null; medicineId?: string | null; matchedName?: string | null; matchConfidence?: number; candidates?: { id: string; medicineName: string }[] }[]; fieldsDetected?: string[]; warnings?: string[]; error?: string; details?: string }
  const [ocrState, setOcrState] = useState<OcrState>("idle");
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [rawTextOpen, setRawTextOpen] = useState(false);
  interface OcrLineMatch { lineIndex: number; ocrName: string; candidates: Medicine[] }
  const [ocrAmbiguous, setOcrAmbiguous] = useState<OcrLineMatch[]>([]);
  const [rxSummary, setRxSummary] = useState({ doctorName: "", diagnosisNotes: "" });
  const [planLoaded, setPlanLoaded] = useState(false);

  /* ── Dispense lines ── */
  const [lines, setLines] = useState<DispLine[]>([]);
  const [allergyInfo, setAllergyInfo] = useState<AllergyInfo | null>(null);
  const [rxNumber, setRxNumber] = useState("");
  const [rxPrescriptionDate, setRxPrescriptionDate] = useState("");

  /* ── Rx image preview ── */
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [rxImageUrl, setRxImageUrl] = useState<string | null>(null);
  const [rxImageLoaded, setRxImageLoaded] = useState(false);
  const [rxImageError, setRxImageError] = useState(false);
  const [imageScale, setImageScale] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement>(null);

  /* ── Post-dispense state ── */
  const [dispensed, setDispensed] = useState(false);
  interface DispenseSlipLine { medicineName: string; batchNumber: string; quantity: number }
  interface DispenseSlip { facilityName: string; patientName: string; patientId: string; prescriptionRef: string; dispensedAt: string; dispensedBy: string; lines: DispenseSlipLine[] }
  const [dispenseSlip, setDispenseSlip] = useState<DispenseSlip | null>(null);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  useEffect(() => { setRxImageLoaded(false); setRxImageError(false); }, [rxImageUrl]);

  // Availability is per-facility: clear the cache whenever the facility changes.
  useEffect(() => { availKnownRef.current = new Set(); setAvailabilityMap({}); }, [facId]);

  // Distinct medicines currently chosen on the entry form.
  const selectedMedIds = useMemo(
    () => Array.from(new Set(newRxLines.map((l) => l.medicineId).filter(Boolean))),
    [newRxLines]
  );

  // One debounced BULK availability request for any newly-selected medicines
  // (already-known ones stay cached). Never a request-per-row.
  useEffect(() => {
    if (!facId) return;
    const missing = selectedMedIds.filter((id) => !availKnownRef.current.has(id));
    if (missing.length === 0) return;
    const t = setTimeout(() => {
      missing.forEach((id) => availKnownRef.current.add(id));
      api<{ items: Availability[] }>(`/dispensing/availability?facilityId=${facId}&medicineIds=${missing.join(",")}`)
        .then(({ items }) =>
          setAvailabilityMap((prev) => {
            const next = { ...prev };
            for (const it of items) next[it.medicineId] = it;
            return next;
          })
        )
        .catch(() => { missing.forEach((id) => availKnownRef.current.delete(id)); }); // allow retry on failure
    }, 250);
    return () => clearTimeout(t);
  }, [selectedMedIds, facId]);

  // Per-line requested-vs-available check (only blocks when availability is known).
  const lineOverAvailable = (l: { medicineId: string; quantity: string }) => {
    const a = l.medicineId ? availabilityMap[l.medicineId] : undefined;
    return !!a && Number(l.quantity) > 0 && Number(l.quantity) > a.availableQty;
  };
  const availabilityBlocked = useMemo(
    () => newRxLines.some(lineOverAvailable),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newRxLines, availabilityMap]
  );

  useEffect(() => {
    if (registerMode) return;
    const t = setTimeout(() => {
      if (pq.trim().length < 2) { setResults([]); return; }
      api<Patient[]>(`/patients?q=${encodeURIComponent(pq.trim())}${facId ? `&facilityId=${facId}` : ""}`).then(setResults).catch(() => setResults([]));
    }, 300);
    return () => clearTimeout(t);
  }, [pq, registerMode, facId]);

  useEffect(() => {
    const pid = searchParams.get("patientId");
    if (pid) api<Patient>(`/patients/${pid}`).then(selectPatient).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadActiveRxs = (patientInternalId: string, fId: string) => {
    setActiveRxsLoading(true);
    const params = new URLSearchParams({ patientId: patientInternalId, status: "ACTIVE", facilityId: fId });
    api<ActiveRx[]>(`/prescriptions?${params}`)
      .then((rxs) => { setActiveRxs(rxs); if (rxs.length === 0) setRxSection("create"); else setRxSection("select"); })
      .catch(() => { setActiveRxs([]); setRxSection("create"); })
      .finally(() => setActiveRxsLoading(false));
  };

  const planFrom = (rxId: string) => {
    setBusy(true); setError("");
    api<{ lines: PlanLine[]; allergies?: AllergyInfo; prescription?: { prescriptionId: string; doctorName?: string | null; prescriptionDate?: string; uploadedPrescriptionUrl?: string | null } }>(
      `/dispensing/prescription/${rxId}/plan${facId ? `?facilityId=${facId}` : ""}`
    )
      .then(({ lines: pl, allergies, prescription }) => {
        setLines(pl.map(planLineToDispLine));
        setAllergyInfo(allergies ?? null);
        setRxNumber(prescription?.prescriptionId ?? "");
        if (prescription?.doctorName) setRxSummary((prev) => ({ ...prev, doctorName: prescription.doctorName! }));
        setRxPrescriptionDate(prescription?.prescriptionDate ? new Date(prescription.prescriptionDate).toLocaleDateString() : "");
        setRxImageUrl(prescription?.uploadedPrescriptionUrl ?? null);
        setPlanLoaded(true);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dispensing plan"))
      .finally(() => setBusy(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  function selectPatient(p: Patient) {
    setError(""); setPatient(p); setPlanLoaded(false); setLines([]); setSelectedRxId("");
    setActiveRxs([]); setRxSection("select");
    if (facId) loadActiveRxs(p.id, facId);
    const wanted = searchParams.get("rxId");
    if (wanted && facId) { setSelectedRxId(wanted); planFrom(wanted); }
  }

  const registerPatient = async () => {
    setError("");
    const f = validators.personName(reg.firstName, "First name"); if (f) return setError(f);
    if (reg.lastName.trim()) { const l = validators.personName(reg.lastName, "Last name"); if (l) return setError(l); }
    const ph = validators.phone(reg.phoneNumber, true); if (ph) return setError(ph);
    setBusy(true);
    try {
      const created = await api<Patient>("/patients", { method: "POST", body: JSON.stringify({ ...reg, age: reg.age ? Number(reg.age) : undefined, allergies: reg.allergies.trim() || undefined, facilityId: facId || undefined }) });
      setRegisterMode(false); selectPatient(created);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to register patient"); }
    finally { setBusy(false); }
  };

  const handleOcr = async () => {
    if (!file) return;
    setOcrState("scanning"); setOcrResult(null); setRawTextOpen(false); setOcrAmbiguous([]);
    try {
      const fd = new FormData(); fd.append("file", file);
      const result = await api<OcrResult>(`/prescriptions/ocr${facId ? `?facilityId=${facId}` : ""}`, { method: "POST", body: fd });
      setOcrResult(result); setOcrState("done");
      if (result.doctorName) setNewRx((r) => ({ ...r, doctorName: result.doctorName! }));
      if (result.diagnosisNotes) setNewRx((r) => ({ ...r, diagnosisNotes: result.diagnosisNotes! }));
      if (result.medicines?.length) {
        const mapped: { medicineId: string; dosage: string; quantity: string }[] = [];
        const ambiguous: OcrLineMatch[] = [];
        const byId = new Map(medicines.map((m) => [m.id, m]));
        result.medicines.forEach((m, idx) => {
          let medicineId = m.medicineId ?? "";
          let candidates: Medicine[] = [];
          if (!medicineId) {
            candidates = (m.candidates ?? []).map((c) => byId.get(c.id)).filter((c): c is CachedMedicine => !!c);
            if (!candidates.length && m.matchConfidence === undefined) candidates = matchMedicines(m.medicineName, medicines);
            if (candidates.length === 1) { medicineId = candidates[0].id; candidates = []; }
          }
          mapped.push({ medicineId, dosage: m.dosage ?? m.strength ?? "", quantity: m.quantity ? String(m.quantity) : "" });
          if (!medicineId) ambiguous.push({ lineIndex: idx, ocrName: m.medicineName, candidates });
        });
        setNewRxLines(mapped.length ? mapped : [{ medicineId: "", dosage: "", quantity: "" }]);
        setOcrAmbiguous(ambiguous);
      }
    } catch (e) { const msg = e instanceof Error ? e.message : String(e); setOcrState("failed"); setOcrResult({ rawText: "", error: msg }); }
  };

  const selectOcrMedicine = (lineIndex: number, medicineId: string) => {
    setNewRxLines((ls) => ls.map((l, idx) => (idx === lineIndex ? { ...l, medicineId } : l)));
    setOcrAmbiguous((prev) => prev.filter((x) => x.lineIndex !== lineIndex));
  };

  const continueToDispense = async () => {
    setError("");
    const filledLines = newRxLines.filter((l) => l.medicineId || l.quantity.trim());
    if (!filledLines.length) return setError("Add at least one medicine.");
    if (filledLines.find((l) => !l.medicineId)) return setError("Please select a medicine from the Medicine Master.");
    if (filledLines.find((l) => !l.quantity.trim() || Number(l.quantity) <= 0)) return setError("Every medicine needs a quantity.");
    const over = filledLines.find(lineOverAvailable);
    if (over) {
      const a = availabilityMap[over.medicineId]!;
      const med = medicines.find((m) => m.id === over.medicineId);
      return setError(
        a.availableQty === 0
          ? `${med?.medicineName ?? "Medicine"} is not available to dispense at this facility (requested ${over.quantity}).`
          : `${med?.medicineName ?? "Medicine"}: requested ${over.quantity} exceeds available ${a.availableQty}. Reduce the quantity to continue.`
      );
    }
    setBusy(true);
    try {
      if (file) {
        // Image uploaded — create a Prescription record so it appears in the Prescription Log.
        const fd = new FormData();
        fd.append("patientId", patient!.id);
        if (facId) fd.append("facilityId", facId);
        if (newRx.doctorName) fd.append("doctorName", newRx.doctorName);
        if (newRx.diagnosisNotes) fd.append("diagnosisNotes", newRx.diagnosisNotes);
        fd.append("medicines", JSON.stringify(filledLines.map((l) => ({ medicineId: l.medicineId, dosage: l.dosage, quantity: Number(l.quantity) }))));
        fd.append("prescription", file);
        const created = await api<{ id: string }>("/prescriptions", { method: "POST", body: fd });
        setSelectedRxId(created.id);
        setRxSummary({ doctorName: newRx.doctorName, diagnosisNotes: newRx.diagnosisNotes });
        planFrom(created.id);
      } else {
        // No image — direct dispense plan (no Prescription DB record).
        // Only general-sale medicines may be dispensed this way; Rx-required/controlled
        // medicines need an uploaded prescription to appear in the Prescription Log.
        const result = await api<{
          lines: PlanLine[];
          allergies?: AllergyInfo;
          prescription: null;
        }>("/dispensing/direct-plan", {
          method: "POST",
          body: JSON.stringify({
            patientId: patient!.id,
            facilityId: facId || undefined,
            lines: filledLines.map((l) => ({ medicineId: l.medicineId, quantity: Number(l.quantity), dosage: l.dosage || undefined })),
          }),
        });
        setLines(result.lines.map(planLineToDispLine));
        setAllergyInfo(result.allergies ?? null);
        setRxNumber("");
        setRxSummary({ doctorName: newRx.doctorName, diagnosisNotes: newRx.diagnosisNotes });
        setRxPrescriptionDate("");
        setRxImageUrl(null);
        // selectedRxId stays empty — batch dispense will send no prescriptionId
        setPlanLoaded(true);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load dispensing plan"); }
    finally { setBusy(false); }
  };

  const setLine = (i: number, patch: Partial<DispLine>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const confirmLines = useMemo(() => lines.filter((l) => l.enabled && l.batchId && Number(l.quantity) > 0), [lines]);
  const lineError = (l: DispLine): string => {
    if (!l.enabled) return "";
    if (!l.batchId) return "No stock";
    if (Number(l.quantity) <= 0) return "Enter qty";
    const batch = l.batches.find((b) => b.id === l.batchId);
    if (batch && Number(l.quantity) > batch.quantity) return `Max ${batch.quantity} in batch`;
    if (l.remainingQuantity != null && Number(l.quantity) > l.remainingQuantity) return `Max ${l.remainingQuantity} on Rx`;
    return "";
  };

  const resetWorkflow = () => {
    setPatient(null); setPq(""); setResults([]);
    setSelectedRxId(""); setLines([]); setPlanLoaded(false); setActiveRxs([]); setRxSection("select");
    setNewRxLines([{ medicineId: "", dosage: "", quantity: "" }]); setNewRx({ doctorName: "", diagnosisNotes: "" }); setFile(null);
    setOcrState("idle"); setOcrResult(null); setRawTextOpen(false); setOcrAmbiguous([]);
    setRxSummary({ doctorName: "", diagnosisNotes: "" }); setAllergyInfo(null); setDispensed(false);
    setRxPrescriptionDate("");
    setRxImageUrl(null); setPreviewModalOpen(false); setImageScale(1); setError(""); setSuccess("");
    setRegisterMode(false); setDispenseSlip(null);
  };

  const hasControlledLines = useMemo(() => confirmLines.some((l) => l.controlled), [confirmLines]);

  const toggleFullscreen = () => {
    const el = imageContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(console.error);
    else el.requestFullscreen().catch(console.error);
  };

  const dispense = async () => {
    setError(""); setSuccess("");
    if (!confirmLines.length) return setError("No dispensable lines selected");
    for (const l of confirmLines) { const le = lineError(l); if (le) return setError(`${l.medicineName}: ${le}`); }
    setBusy(true);
    try {
      const res = await api<{ count: number }>("/dispensing/batch", {
        method: "POST",
        body: JSON.stringify({ patientId: patient!.id, prescriptionId: selectedRxId || undefined, facilityId: facId || undefined, lines: confirmLines.map((l) => ({ medicineId: l.medicineId, batchId: l.batchId, quantity: Number(l.quantity), dosage: l.dosage || undefined, form: l.form || undefined })) }),
      });
      setDispensed(true);
      setSuccess(`Dispensed ${res.count} medicine line(s) to ${patient!.firstName} ${patient!.lastName}.`);
      setDispenseSlip({
        facilityName: facName,
        patientName: `${patient!.firstName} ${patient!.lastName}`,
        patientId: patient!.patientId,
        prescriptionRef: rxNumber || selectedRxId || "—",
        dispensedAt: new Date().toISOString(),
        dispensedBy: user ? `${user.firstName} ${user.lastName}` : "—",
        lines: confirmLines.map((l) => ({
          medicineName: l.medicineName,
          batchNumber: l.batches.find((b) => b.id === l.batchId)?.batchNumber ?? l.batchId,
          quantity: Number(l.quantity),
        })),
      });
    } catch (e) { setError(e instanceof Error ? e.message : "Dispensing failed"); }
    finally { setBusy(false); }
  };

  if (!hasAccess) return null;

  const allergyTexts = (() => {
    const list: string[] = [];
    const push = (v?: string | null) => { const t = (v ?? "").trim(); if (t && !/^(nkda|none|nil)$/i.test(t) && !list.some((x) => x.toLowerCase() === t.toLowerCase())) list.push(t); };
    push(patient?.allergies); push(allergyInfo?.patient);
    for (const a of allergyInfo?.fromPrescriptions ?? []) push(a);
    return list;
  })();

  const backendBase = resolveApiUrl().replace(/\/api$/, "");
  const imgSrc = rxImageUrl ? `${backendBase}${rxImageUrl}` : null;

  return (
    <div className="mx-auto max-w-4xl space-y-4">

      {/* ═══════════════════════════════════════════════
          POST-DISPENSE CONFIRMATION
      ═══════════════════════════════════════════════ */}
      {dispensed && (
        <>
          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <div>
                <p className="text-base font-semibold text-slate-800">{success || "Dispensing complete."}</p>
                {facName && <p className="mt-0.5 text-sm text-slate-500">{facName}</p>}
              </div>
              <div className="flex gap-2">
                <Button onClick={resetWorkflow} variant="outline">New dispensing</Button>
                {dispenseSlip && (
                  <Button
                    onClick={() => {
                      const slip = dispenseSlip;
                      const linesHtml = slip.lines.map((l) => `
                        <tr>
                          <td style="border:1px solid #ddd;padding:6px 8px">${l.medicineName}</td>
                          <td style="border:1px solid #ddd;padding:6px 8px;font-family:monospace;font-size:11px">${l.batchNumber || "—"}</td>
                          <td style="border:1px solid #ddd;padding:6px 8px;text-align:right;font-weight:600">${l.quantity}</td>
                        </tr>`).join("");
                      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Dispense Slip</title>
                        <style>body{font-family:Arial,sans-serif;font-size:13px;margin:0;padding:24px}h1{font-size:18px;margin:0 0 4px}.sub{color:#555;font-size:12px;margin:0 0 16px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;margin-bottom:16px;font-size:12px}.lb{font-weight:600}table{width:100%;border-collapse:collapse;font-size:12px}th{border:1px solid #ddd;padding:6px 8px;background:#f5f5f5;text-align:left;font-weight:600}hr{border:none;border-top:1px solid #ddd;margin:12px 0}.footer{margin-top:24px;font-size:10px;color:#999;text-align:center}</style>
                      </head><body>
                        <h1>Dispense Slip</h1><p class="sub">${slip.facilityName}</p><hr/>
                        <div class="fields">
                          <div><span class="lb">Patient Name:</span> ${slip.patientName}</div>
                          <div><span class="lb">Patient ID:</span> ${slip.patientId}</div>
                          <div><span class="lb">Prescription Ref:</span> ${slip.prescriptionRef}</div>
                          <div><span class="lb">Dispensing Date/Time:</span> ${new Date(slip.dispensedAt).toLocaleString()}</div>
                          <div><span class="lb">Dispensed By:</span> ${slip.dispensedBy}</div>
                          <div><span class="lb">Facility:</span> ${slip.facilityName}</div>
                        </div>
                        <table><thead><tr><th>Medicine Name</th><th>Batch Number</th><th style="text-align:right">Qty Dispensed</th></tr></thead><tbody>${linesHtml}</tbody></table>
                        <p class="footer">Generated by StockTrackRx &middot; ${new Date().toLocaleString()}</p>
                      </body></html>`;
                      const win = window.open("", "_blank", "width=794,height=1123");
                      if (!win) return;
                      win.document.write(html);
                      win.document.close();
                      win.focus();
                      win.print();
                    }}
                    className="bg-slate-700 text-white hover:bg-slate-800"
                  >
                    <Printer className="mr-1.5 h-4 w-4" /> Print Dispense Slip
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {!dispensed && (
        <>
          {/* ═══════════════════════════════════════════════
              SECTION 1 — PATIENT (+ inline facility)
          ═══════════════════════════════════════════════ */}
          <Card>
            <CardContent className="space-y-3 p-4">

              {/* Facility row (cross-facility users only) */}
              {!user?.facilityId && (
                <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${facId ? "border-slate-200 bg-slate-50" : "border-amber-200 bg-amber-50"}`}>
                  <Building2 className={`h-4 w-4 shrink-0 ${facId ? "text-medflow-600" : "text-amber-600"}`} />
                  {facId ? (
                    <>
                      <span className="flex-1 font-medium text-slate-700">Dispensing from: {facName}</span>
                      <button type="button" className="text-xs text-medflow-600 hover:underline" onClick={() => setLocalFacilityId("")}>Change</button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-amber-700">Select a facility to continue</span>
                      <select className="h-8 rounded border bg-white px-2 text-xs" value={facilityPickId} onChange={(e) => setFacilityPickId(e.target.value)}>
                        <option value="">— Facility —</option>
                        {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                      </select>
                      <Button size="sm" onClick={() => { if (facilityPickId) setLocalFacilityId(facilityPickId); }} disabled={!facilityPickId} className="h-8 px-3 text-xs">Select</Button>
                    </>
                  )}
                </div>
              )}

              {/* Patient search / selected banner */}
              {!patient ? (
                !registerMode ? (
                  <>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input className="pl-9" placeholder="Search patient by name, ID, or phone…" value={pq} onChange={(e) => setPq(e.target.value)} autoFocus disabled={!facId && !user?.facilityId} />
                      </div>
                      <Button variant="outline" onClick={() => { setRegisterMode(true); setError(""); }} disabled={!facId && !user?.facilityId}>
                        <UserPlus className="mr-1.5 h-4 w-4" /> Register
                      </Button>
                    </div>
                    {pq.trim().length >= 2 && (
                      <div className="divide-y rounded-lg border">
                        {results.length === 0
                          ? <div className="px-3 py-3 text-sm text-slate-500">No patient found. <button type="button" className="text-medflow-600 underline" onClick={() => setRegisterMode(true)}>Register a new patient</button>.</div>
                          : results.map((p) => (
                            <button key={p.id} type="button" onClick={() => selectPatient(p)} className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-slate-50">
                              <span><strong>{p.firstName} {p.lastName}</strong> · {p.patientId}{p.age ? ` · ${p.gender}, ${p.age}y` : ""}{p.phoneNumber ? ` · ${p.phoneNumber}` : ""}</span>
                              <span className="text-medflow-600">Select →</span>
                            </button>
                          ))}
                      </div>
                    )}
                    {pq.trim().length < 2 && <p className="text-xs text-slate-400">Type at least 2 characters to search.</p>}
                  </>
                ) : (
                  <div className="space-y-3">
                    <p className="font-medium">Register new patient</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><Label>First name *</Label><Input value={reg.firstName} onChange={(e) => setReg({ ...reg, firstName: sanitizePersonName(e.target.value) })} /></div>
                      <div><Label>Last name</Label><Input value={reg.lastName} onChange={(e) => setReg({ ...reg, lastName: sanitizePersonName(e.target.value) })} /></div>
                      <div><Label>Gender</Label><select className="h-11 w-full rounded-lg border bg-white px-3 text-sm" value={reg.gender} onChange={(e) => setReg({ ...reg, gender: e.target.value })}><option value="">— Select —</option><option>Female</option><option>Male</option><option>Other</option></select></div>
                      <div><Label>Age</Label><Input inputMode="numeric" value={reg.age} onChange={(e) => setReg({ ...reg, age: e.target.value.replace(/\D/g, "") })} /></div>
                      <div className="sm:col-span-2"><Label>Phone *</Label><Input inputMode="tel" value={reg.phoneNumber} onChange={(e) => setReg({ ...reg, phoneNumber: sanitizePhone(e.target.value) })} /></div>
                      <div className="sm:col-span-2"><Label>Known allergies</Label><Input value={reg.allergies} onChange={(e) => setReg({ ...reg, allergies: e.target.value })} placeholder='e.g. "Penicillin" — leave blank if none known' /></div>
                    </div>
                    <div className="flex gap-2">
                      <Button onClick={registerPatient} disabled={busy}>{busy ? "Saving…" : "Save & continue"}</Button>
                      <Button variant="outline" onClick={() => setRegisterMode(false)}>Back to search</Button>
                    </div>
                  </div>
                )
              ) : (
                /* Patient selected — compact banner */
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                      <span className="font-semibold text-slate-800">{patient.firstName} {patient.lastName}</span>
                      <span className="text-sm text-slate-500">{patient.patientId}</span>
                      {patient.age ? <span className="text-sm text-slate-400">{patient.gender}, {patient.age}y</span> : null}
                    </div>
                    {allergyTexts.length > 0 && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-red-700">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        <span><strong>Allergies:</strong> {allergyTexts.join("; ")}</span>
                      </div>
                    )}
                  </div>
                  {!planLoaded && (
                    <Button size="sm" variant="ghost" onClick={() => { setPatient(null); setPq(""); setPlanLoaded(false); setLines([]); setActiveRxs([]); setError(""); }}>
                      Change
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Error / success */}
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

          {/* ═══════════════════════════════════════════════
              SECTION 2 — PRESCRIPTION
          ═══════════════════════════════════════════════ */}
          {patient && !planLoaded && (
            <Card>
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-medflow-600" />
                  <span className="font-medium text-slate-800">Prescription</span>
                </div>
                {activeRxs.length > 0 && (
                  <div className="flex gap-1 text-xs">
                    <button type="button" onClick={() => setRxSection("select")} className={`rounded-full px-3 py-1 font-medium ${rxSection === "select" ? "bg-medflow-50 text-medflow-700" : "text-slate-500 hover:text-slate-700"}`}>
                      Select existing ({activeRxs.length})
                    </button>
                    <button type="button" onClick={() => setRxSection("create")} className={`rounded-full px-3 py-1 font-medium ${rxSection === "create" ? "bg-medflow-50 text-medflow-700" : "text-slate-500 hover:text-slate-700"}`}>
                      New
                    </button>
                  </div>
                )}
              </div>

              <CardContent className="space-y-3 p-4">
                {activeRxsLoading && (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading prescriptions…
                  </div>
                )}

                {/* Select existing Rx */}
                {!activeRxsLoading && rxSection === "select" && activeRxs.length > 0 && (
                  <div className="space-y-1">
                    {activeRxs.map((rx) => {
                      const pct = rx.prescribedTotal > 0 ? Math.min(100, Math.round((rx.dispensedTotal / rx.prescribedTotal) * 100)) : 0;
                      return (
                        <button key={rx.id} type="button" disabled={busy}
                          onClick={() => { setSelectedRxId(rx.id); planFrom(rx.id); }}
                          className="flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm hover:border-medflow-300 hover:bg-medflow-50 disabled:opacity-60">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-medflow-700">{rx.prescriptionId}</span>
                              {rx.doctorName && <span className="text-slate-500">· Dr. {rx.doctorName}</span>}
                              <span className="ml-auto text-xs text-slate-400">{new Date(rx.prescriptionDate).toLocaleDateString()}</span>
                            </div>
                            <div className="mt-1 flex items-center gap-3">
                              <span className="text-xs text-slate-500">{rx.medicineCount} medicine{rx.medicineCount !== 1 ? "s" : ""}</span>
                              {rx.prescribedTotal > 0 && (
                                <div className="flex items-center gap-1.5">
                                  <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200">
                                    <div className={`h-full rounded-full ${pct >= 100 ? "bg-emerald-500" : "bg-medflow-500"}`} style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-xs text-slate-400">{rx.dispensedTotal}/{rx.prescribedTotal} dispensed</span>
                                </div>
                              )}
                            </div>
                          </div>
                          {busy && selectedRxId === rx.id
                            ? <Loader2 className="h-4 w-4 animate-spin text-medflow-400 shrink-0" />
                            : <span className="text-xs font-medium text-medflow-600 shrink-0">Load →</span>}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Create new Rx */}
                {!activeRxsLoading && rxSection === "create" && (
                  <div className="space-y-3">
                    {/* OCR upload */}
                    <div className="space-y-2 rounded-lg border border-dashed p-3">
                      <p className="text-sm font-medium text-slate-600">Upload prescription scan (optional — OCR auto-fills fields)</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Input type="file" accept="image/jpeg,image/png,image/jpg" className="flex-1 min-w-0"
                          onChange={(e) => { setFile(e.target.files?.[0] || null); setOcrState("idle"); setOcrResult(null); setOcrAmbiguous([]); }} />
                        <Button type="button" variant="outline" size="sm" disabled={!file || ocrState === "scanning"} onClick={handleOcr}>
                          {ocrState === "scanning" ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Scanning…</> : <><Upload className="mr-1.5 h-4 w-4" /> Scan & Auto-fill</>}
                        </Button>
                      </div>
                      {ocrState === "done" && ocrResult && (
                        <div className="space-y-1.5 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
                          <div className="flex items-center gap-2 font-medium text-green-700">
                            <CheckCircle2 className="h-4 w-4 shrink-0" /> OCR Complete
                            {ocrResult.confidence !== undefined && <span className="ml-auto text-xs font-normal text-green-600">{ocrResult.confidence}% confidence</span>}
                          </div>
                          {(ocrResult.fieldsDetected?.length ?? 0) > 0
                            ? <p className="text-xs text-green-700">Fields detected: <strong>{ocrResult.fieldsDetected!.join(", ")}</strong></p>
                            : <p className="text-xs font-medium text-orange-600">No prescription fields detected. Fill in manually.</p>}
                          {(ocrResult.warnings?.length ?? 0) > 0 && <ul className="space-y-0.5">{ocrResult.warnings!.map((w, i) => <li key={i} className="text-xs text-amber-700">⚠ {w}</li>)}</ul>}
                          <button type="button" className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700" onClick={() => setRawTextOpen((v) => !v)}>
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rawTextOpen ? "rotate-180" : ""}`} />{rawTextOpen ? "Hide" : "Show"} raw OCR text
                          </button>
                          {rawTextOpen && <pre className="mt-1 max-h-40 overflow-auto rounded bg-white p-2 text-xs text-slate-700 whitespace-pre-wrap border">{ocrResult.rawText || "(empty)"}</pre>}
                          {ocrAmbiguous.length > 0 && (
                            <div className="mt-2 space-y-1.5 border-t border-green-200 pt-2">
                              {ocrAmbiguous.map((item) => (
                                <div key={item.lineIndex} className={`rounded border p-2 text-xs ${item.candidates.length ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                                  <p className={item.candidates.length ? "text-amber-800" : "text-red-700"}>OCR: <strong>&ldquo;{item.ocrName}&rdquo;</strong>{item.candidates.length === 0 ? " — not found" : " — select match:"}</p>
                                  {item.candidates.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{item.candidates.map((c) => (<button key={c.id} type="button" className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-amber-100" onClick={() => selectOcrMedicine(item.lineIndex, c.id)}>{c.medicineName}</button>))}</div>}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {ocrState === "failed" && ocrResult && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                          <div className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4 shrink-0" /> OCR Failed — fill in manually</div>
                          <p className="mt-0.5 text-xs">{ocrResult.error}</p>
                        </div>
                      )}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><Label>Doctor</Label><Input value={newRx.doctorName} onChange={(e) => setNewRx({ ...newRx, doctorName: e.target.value.replace(/[^A-Za-z .'-]/g, "") })} placeholder="Doctor name" /></div>
                      <div><Label>Diagnosis</Label><Input value={newRx.diagnosisNotes} onChange={(e) => setNewRx({ ...newRx, diagnosisNotes: e.target.value })} placeholder="Diagnosis / notes" /></div>
                    </div>

                    <div>
                      <Label className="mb-1.5 block">Medicines *</Label>
                      <div className="rounded-lg border">
                        <table className="w-full min-w-[480px] text-sm">
                          <thead className="bg-slate-50 text-left text-xs text-slate-500"><tr><th className="p-2 pl-3">Medicine</th><th className="p-2 w-24 text-right">Qty</th><th className="p-2 w-10"></th></tr></thead>
                          <tbody className="divide-y">
                            {newRxLines.map((ln, i) => {
                              const avail = ln.medicineId ? (availabilityMap[ln.medicineId] ?? null) : undefined;
                              const requested = Number(ln.quantity);
                              const over = lineOverAvailable(ln);
                              return (
                              <tr key={i}>
                                <td className="p-2 pl-3 align-top">
                                  <MedicineCombobox medicines={medicines} value={ln.medicineId} onChange={(id) => setNewRxLines((ls) => ls.map((x, idx) => idx === i ? { ...x, medicineId: id } : x))} className="h-9" />
                                  {ln.medicineId && <div className="mt-1"><AvailabilityBadge a={avail} /></div>}
                                </td>
                                <td className="p-2 align-top">
                                  <Input className={`text-right ${over ? "border-red-400 focus-visible:ring-red-400" : ""}`} inputMode="numeric" placeholder="Qty" value={ln.quantity} onChange={(e) => setNewRxLines((ls) => ls.map((x, idx) => idx === i ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x))} />
                                  {ln.medicineId && avail && requested > 0 && (
                                    <p className={`mt-1 text-right text-xs ${over ? "font-medium text-red-600" : "text-slate-400"}`}>
                                      Req {requested} · Avail {avail.availableQty}
                                    </p>
                                  )}
                                </td>
                                <td className="p-2 align-top">{newRxLines.length > 1 && <button type="button" className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500" onClick={() => setNewRxLines((ls) => ls.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></button>}</td>
                              </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <button type="button" className="mt-2 flex items-center gap-1 text-sm text-medflow-600 hover:text-medflow-700" onClick={() => setNewRxLines((ls) => [...ls, { medicineId: "", dosage: "", quantity: "" }])}>
                        <Plus className="h-4 w-4" /> Add medicine
                      </button>
                    </div>

                    {availabilityBlocked && <p className="text-xs text-red-600">⚠ One or more quantities exceed available stock — reduce them to continue.</p>}
                    {!file && <p className="text-xs text-slate-400">No prescription image — this dispense will appear in the Dispense Report only (not the Prescription Log).</p>}
                    <Button onClick={continueToDispense} disabled={busy || availabilityBlocked}>{busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Loading…</> : "Continue"}</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ═══════════════════════════════════════════════
              SECTION 3 — MEDICINES & SAFETY REVIEW
          ═══════════════════════════════════════════════ */}
          {patient && planLoaded && (
            <Card>
              {/* Rx context strip */}
              <div className="flex items-center justify-between border-b px-4 py-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-medflow-600" />
                  <div>
                    <p className="font-semibold text-slate-800">
                      {rxNumber
                        ? <><span className="mr-1.5">Rx {rxNumber}</span>{rxSummary.doctorName && <span className="text-slate-500 font-normal">· Dr. {rxSummary.doctorName}</span>}</>
                        : <span className="text-slate-500 font-normal text-sm">Walk-in dispense{rxSummary.doctorName ? ` · Dr. ${rxSummary.doctorName}` : ""}</span>
                      }
                    </p>
                    {rxPrescriptionDate && <p className="text-xs text-slate-400">{rxPrescriptionDate}</p>}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setPlanLoaded(false); setLines([]); setSelectedRxId(""); setRxImageUrl(null); setRxSection(activeRxs.length > 0 ? "select" : "create"); setError(""); }}>
                  ← Change Rx
                </Button>
              </div>

              <CardContent className="space-y-4 p-4">
                {/* Allergy warning */}
                {allergyTexts.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><strong>Allergy alert:</strong> {allergyTexts.join("; ")} — verify before dispensing</span>
                  </div>
                )}
                {hasControlledLines && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><strong>Controlled medicine(s)</strong> — verify against the controlled drug register before dispensing.</span>
                  </div>
                )}

                <p className="text-sm text-slate-500">The batch expiring soonest is selected automatically. Uncheck a line to skip it, or adjust the quantity.</p>

                {/* Medicine lines */}
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500">
                      <tr><th className="p-2 pl-3 w-8"></th><th className="p-2">Medicine</th><th className="p-2 w-24 text-center">Prescribed</th><th className="p-2">Batch (earliest expiry)</th><th className="p-2 w-24 text-right">Qty</th><th className="p-2 w-20 text-right">On Hand</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {lines.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-slate-400">No medicine lines.</td></tr>}
                      {lines.map((l, i) => {
                        const le = lineError(l);
                        const selBatch = l.batches.find((b) => b.id === l.batchId);
                        const batchDays = selBatch ? daysUntilExpiry(selBatch.expiryDate) : 999;
                        return (
                          <tr key={l.medicineId} className={!l.enabled ? "bg-slate-50/60 opacity-50" : ""}>
                            <td className="p-2 pl-3"><input type="checkbox" className="h-4 w-4 accent-medflow-600" checked={l.enabled} disabled={l.batches.length === 0 || l.fulfilled} onChange={(e) => setLine(i, { enabled: e.target.checked })} /></td>
                            <td className="p-2">
                              <span className="font-medium">{l.medicineName}</span>
                              {l.requiresPrescription && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700"><FileText className="h-3 w-3" /> Rx</span>}
                              {l.controlled && <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700"><AlertCircle className="h-3 w-3" /> Controlled</span>}
                              {l.fulfilled && <span className="ml-1.5 rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">Fully dispensed</span>}
                              {!l.fulfilled && l.batches.length === 0 && <span className="ml-2 text-xs text-red-500">Out of stock</span>}
                            </td>
                            <td className="p-2 text-center">
                              {l.prescribedQuantity != null ? (l.alreadyDispensed > 0 ? <div className="text-xs text-slate-500 leading-tight"><div>{l.alreadyDispensed}/{l.prescribedQuantity} disp</div><div className="font-semibold text-slate-700">{l.remainingQuantity} rem</div></div> : <span className="font-medium text-slate-700">{l.prescribedQuantity}</span>) : <span className="text-xs text-slate-400">Open</span>}
                            </td>
                            <td className="p-2">
                              {l.batches.length > 0 ? (
                                <div>
                                  <select className="h-8 rounded border bg-white px-2 text-xs" value={l.batchId} disabled={!l.enabled} onChange={(e) => setLine(i, { batchId: e.target.value })}>
                                    {l.batches.map((b) => <option key={b.id} value={b.id}>{b.batchNumber} · exp {new Date(b.expiryDate).toLocaleDateString()} · {b.quantity}</option>)}
                                  </select>
                                  {selBatch && <p className={`mt-0.5 text-xs ${batchDays < 30 ? "font-semibold text-red-500" : batchDays < 90 ? "text-amber-600" : "text-slate-400"}`}>Exp {new Date(selBatch.expiryDate).toLocaleDateString()} · Stock {selBatch.quantity}{batchDays < 90 && <span className="ml-1">⚠ {batchDays < 30 ? "expires very soon" : "expires soon"}</span>}</p>}
                                </div>
                              ) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="p-2">
                              <div className="flex items-center justify-end gap-1">
                                <Input className="w-20 text-right" inputMode="numeric" disabled={!l.enabled || l.batches.length === 0} value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, "") })} />
                                {le && <span className="text-xs text-red-500 whitespace-nowrap">{le}</span>}
                              </div>
                            </td>
                            <td className="p-2 text-right text-slate-500">{l.onHand}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Prescription image — shown inline only when one was uploaded */}
                {imgSrc && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-800">Prescription</p>
                      <Button variant="outline" size="sm" onClick={() => setPreviewModalOpen(true)} className="shrink-0">
                        <Maximize2 className="mr-1.5 h-3.5 w-3.5" /> Enlarge
                      </Button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewModalOpen(true)}
                      title="Click to enlarge"
                      className="block w-full overflow-hidden rounded-lg border bg-slate-950"
                    >
                      {!rxImageLoaded && !rxImageError && (
                        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                      )}
                      {rxImageError && (
                        <div className="flex h-40 items-center justify-center text-sm text-red-300">Prescription image failed to load</div>
                      )}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgSrc}
                        alt="Prescription"
                        className="mx-auto max-h-72 w-auto object-contain"
                        style={{ display: rxImageLoaded ? "block" : "none" }}
                        onLoad={() => setRxImageLoaded(true)}
                        onError={() => setRxImageError(true)}
                      />
                    </button>
                  </div>
                )}

                <Button
                  onClick={dispense}
                  disabled={busy || confirmLines.length === 0}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  {busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Dispensing…</> : "Confirm & Dispense"}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── Rx preview fullscreen styles ── */}
      <style jsx global>{`
        .rx-img-panel:fullscreen { background: #0f172a; display: flex; align-items: flex-start; justify-content: center; overflow: auto; padding: 16px; }
      `}</style>

      {/* ── Prescription image viewer (zoom / fullscreen) ── */}
      {previewModalOpen && imgSrc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3">
          <div className="flex w-full max-w-4xl flex-col rounded-xl bg-white shadow-2xl" style={{ height: "min(92vh, 760px)" }}>
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
              <p className="font-semibold text-slate-800">{rxNumber ? `Prescription · Rx ${rxNumber}` : "Prescription"}</p>
              <div className="flex items-center gap-1">
                <button type="button" disabled={imageScale <= 0.5} onClick={() => setImageScale((s) => Math.max(0.5, Math.round((s - 0.25) * 100) / 100))} className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 text-sm font-bold">−</button>
                <span className="min-w-[40px] text-center text-xs text-slate-500">{Math.round(imageScale * 100)}%</span>
                <button type="button" disabled={imageScale >= 4} onClick={() => setImageScale((s) => Math.min(4, Math.round((s + 0.25) * 100) / 100))} className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30 text-sm font-bold">+</button>
                <button type="button" onClick={() => setImageScale(1)} className="ml-1 rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">Reset</button>
                <button type="button" onClick={toggleFullscreen} className="ml-1 flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100">{isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}</button>
                <button type="button" onClick={() => setPreviewModalOpen(false)} className="ml-1 flex h-7 w-7 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div ref={imageContainerRef} className="rx-img-panel relative flex-1 overflow-auto bg-slate-950">
              {!rxImageLoaded && !rxImageError && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>}
              {rxImageError && <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center"><AlertCircle className="h-8 w-8 text-red-400" /><p className="font-semibold text-red-300 text-sm">Image failed to load</p><button type="button" className="text-xs text-red-300 underline hover:text-red-200" onClick={() => { setRxImageError(false); setRxImageLoaded(false); }}>Retry</button></div>}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imgSrc} alt="Uploaded prescription" style={{ transform: `scale(${imageScale})`, transformOrigin: "top left", transition: "transform 0.15s ease", display: rxImageLoaded ? "block" : "none", maxWidth: "none" }} onLoad={() => setRxImageLoaded(true)} onError={() => setRxImageError(true)} />
            </div>
          </div>
        </div>
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
