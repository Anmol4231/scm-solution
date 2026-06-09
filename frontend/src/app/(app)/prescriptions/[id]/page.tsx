"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Upload, FileText, X, CheckCircle2, Loader2, ScanLine } from "lucide-react";
import { api, resolveApiUrl } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationsTabs } from "@/components/layout/operations-tabs";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";

function apiBaseUrl() {
  return resolveApiUrl().replace(/\/api$/, "");
}

// ─── OCR ─────────────────────────────────────────────────────────────────────
interface TesseractGlobal {
  recognize: (
    image: File | string,
    lang: string,
    opts?: { logger?: (m: { status: string; progress: number }) => void }
  ) => Promise<{ data: { text: string } }>;
}

function loadTesseract(): Promise<TesseractGlobal> {
  return new Promise((resolve, reject) => {
    const SRC = "https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js";
    const existing = (window as unknown as Record<string, unknown>).Tesseract as TesseractGlobal | undefined;
    if (existing?.recognize) return resolve(existing);
    if (document.querySelector(`script[src="${SRC}"]`)) {
      const wait = setInterval(() => {
        const T = (window as unknown as Record<string, unknown>).Tesseract as TesseractGlobal | undefined;
        if (T?.recognize) { clearInterval(wait); resolve(T); }
      }, 100);
      setTimeout(() => { clearInterval(wait); reject(new Error("OCR engine timed out")); }, 15000);
      return;
    }
    const s = document.createElement("script");
    s.src = SRC;
    s.onload = () => {
      const T = (window as unknown as Record<string, unknown>).Tesseract as TesseractGlobal | undefined;
      T?.recognize ? resolve(T) : reject(new Error("OCR engine loaded but unavailable"));
    };
    s.onerror = () => reject(new Error("Could not load OCR engine — check your internet connection"));
    document.head.appendChild(s);
  });
}

async function runOcr(file: File, onProgress: (pct: number) => void): Promise<string> {
  const T = await loadTesseract();
  const { data } = await T.recognize(file, "eng", {
    logger: (m) => { if (m.status === "recognizing text") onProgress(Math.round(m.progress * 100)); },
  });
  return data.text.trim();
}

// ─── Prescription text parser ─────────────────────────────────────────────────
interface MedicineOpt { id: string; medicineName: string }

interface ParseResult {
  doctorName?: string;
  department?: string;
  diagnosisNotes?: string;
  symptoms?: string;
  allergies?: string;
  followUpDate?: string;
  medicineId?: string;
  dosage?: string;
  quantity?: string;
  filledFields: string[];
}

function parsePrescriptionText(raw: string, medicineList: MedicineOpt[]): ParseResult {
  const result: ParseResult = { filledFields: [] };
  const lower = raw.toLowerCase();

  const firstMatch = (patterns: RegExp[]): string | undefined => {
    for (const p of patterns) {
      const m = raw.match(p);
      if (m?.[1]) return m[1].trim().replace(/\s+/g, " ").replace(/[,;]+$/, "");
    }
    return undefined;
  };

  // Doctor
  const doctor = firstMatch([
    /Dr\.?\s+([A-Za-z][A-Za-z .'-]{2,40}?)(?:\s*[\n,\r|]|$)/m,
    /Doctor[:\s]+([A-Za-z][A-Za-z .'-]{2,40}?)(?:\s*[\n,\r|]|$)/mi,
    /Physician[:\s]+([A-Za-z][A-Za-z .'-]{2,40}?)(?:\s*[\n,\r|]|$)/mi,
    /Prescribed\s+by[:\s]+([A-Za-z][A-Za-z .'-]{2,40}?)(?:\s*[\n,\r|]|$)/mi,
  ]);
  if (doctor) { result.doctorName = doctor; result.filledFields.push("Doctor"); }

  // Department
  const dept = firstMatch([
    /Dept\.?\s*[:\-]?\s*([A-Za-z][A-Za-z /()-]{2,40}?)(?:\s*[\n,\r|]|$)/mi,
    /Department[:\s]+([A-Za-z][A-Za-z /()-]{2,40}?)(?:\s*[\n,\r|]|$)/mi,
    /Ward[:\s]+([A-Za-z][A-Za-z /()-]{2,30}?)(?:\s*[\n,\r|]|$)/mi,
    /Clinic[:\s]+([A-Za-z][A-Za-z /()-]{2,30}?)(?:\s*[\n,\r|]|$)/mi,
  ]);
  if (dept) {
    result.department = dept; result.filledFields.push("Department");
  } else {
    const hit = ["OPD", "ICU", "Paediatrics", "Pediatrics", "Maternity", "Surgical",
      "Gynecology", "Obstetrics", "Orthopedics", "Cardiology", "Neurology", "Emergency"].find(
      k => lower.includes(k.toLowerCase())
    );
    if (hit) { result.department = hit; result.filledFields.push("Department"); }
  }

  // Diagnosis
  const diag = firstMatch([
    /Diagno(?:sis|se)[:\s]+([^\n\r]{3,150})/mi,
    /\bDx[:\s]+([^\n\r]{3,150})/mi,
    /Impression[:\s]+([^\n\r]{3,150})/mi,
    /Assessment[:\s]+([^\n\r]{3,150})/mi,
  ]);
  if (diag) { result.diagnosisNotes = diag; result.filledFields.push("Diagnosis"); }

  // Symptoms
  const sympt = firstMatch([
    /Chief\s+Complaints?[:\s]+([^\n\r]{3,200})/mi,
    /C\/?O[:\s]+([^\n\r]{3,200})/mi,
    /Complaints?[:\s]+([^\n\r]{3,200})/mi,
    /Symptoms?[:\s]+([^\n\r]{3,200})/mi,
  ]);
  if (sympt) { result.symptoms = sympt; result.filledFields.push("Symptoms"); }

  // Allergies
  if (/\bNKDA\b|\bno\s+known\s+(?:drug\s+)?allerg/i.test(raw)) {
    result.allergies = "NKDA"; result.filledFields.push("Allergies");
  } else {
    const allergy = firstMatch([
      /Allergi(?:es?|c\s+to)[:\s]+([^\n\r]{2,100})/mi,
      /Drug\s+allergy[:\s]+([^\n\r]{2,100})/mi,
    ]);
    if (allergy) { result.allergies = allergy; result.filledFields.push("Allergies"); }
  }

  // Follow-up date
  const fuRaw = firstMatch([
    /(?:Follow[- ]?up|Review|Return)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/mi,
    /(?:Follow[- ]?up|Review)\s*[:\-]?\s*(\d{4}[\/\-]\d{2}[\/\-]\d{2})/mi,
  ]);
  if (fuRaw) {
    const parts = fuRaw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (parts) {
      const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
      const d = new Date(`${year}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`);
      if (!isNaN(d.getTime())) { result.followUpDate = d.toISOString().slice(0, 10); result.filledFields.push("Follow-up date"); }
    }
  }

  // Medicine — longest full-name match wins
  let bestMed: MedicineOpt | undefined;
  let bestScore = 0;
  for (const med of medicineList) {
    const name = med.medicineName.toLowerCase();
    if (lower.includes(name) && name.length > bestScore) {
      bestScore = name.length; bestMed = med;
    } else {
      const word = name.split(/\s+/)[0];
      if (word.length >= 5 && lower.includes(word) && word.length * 0.5 > bestScore) {
        bestScore = word.length * 0.5; bestMed = med;
      }
    }
  }
  if (bestMed) { result.medicineId = bestMed.id; result.filledFields.push(`Medicine: ${bestMed.medicineName}`); }

  // Dosage
  const dosage = firstMatch([
    /Dosage[:\s]+([^\n\r]{2,50})/mi,
    /Dose[:\s]+([^\n\r]{2,50})/mi,
    /(\d+\s*(?:mg|mcg|g|ml|IU)\s*(?:twice\s+daily|once\s+daily|TDS|BD|OD|QID|PRN|daily)?)/i,
    /((?:once|twice|thrice)\s+(?:a\s+)?(?:daily|day)|TDS|BD|OD|QID|PRN)/i,
  ]);
  if (dosage) { result.dosage = dosage; result.filledFields.push("Dosage"); }

  // Quantity
  const qty = firstMatch([
    /Qty\.?[:\s]+(\d+)/mi,
    /Quantity[:\s]+(\d+)/mi,
    /#\s*(\d+)/,
    /(\d+)\s*(?:tablets?|tab\.?|caps?\.?|capsules?)/i,
  ]);
  if (qty && /^\d+$/.test(qty.trim())) { result.quantity = qty.trim(); result.filledFields.push("Quantity"); }

  return result;
}

function validatePersonName(v: string, label: string): string {
  const t = v.trim();
  if (!t) return "";
  if (/\d/.test(t)) return `${label} must not contain numbers`;
  if (/[^A-Za-z .'-]/.test(t)) return `${label} must not contain special characters`;
  if (!/[A-Za-z]/.test(t)) return `${label} must contain at least one letter`;
  return "";
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface PatientOpt { id: string; firstName: string; lastName: string; patientId: string }

const EMPTY = {
  patientId: "", doctorName: "", department: "", diagnosisNotes: "", symptoms: "",
  followUpDate: "", allergies: "", prescriptionNotes: "",
  medicineId: "", dosage: "", quantity: "",
};

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PrescriptionsPage() {
  const hasAccess = useRequirePermission("prescriptions");
  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const [patients, setPatients] = useState<PatientOpt[]>([]);
  const [medicines, setMedicines] = useState<MedicineOpt[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // Scan state
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [capturedText, setCapturedText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanPct, setScanPct] = useState(0);
  const [scanStatus, setScanStatus] = useState(""); // e.g. "Loading OCR engine…" / "Reading…"
  const [scanError, setScanError] = useState("");
  const [filledFields, setFilledFields] = useState<string[]>([]);
  const previewRef = useRef("");

  useEffect(() => {
    api("/prescriptions").then(setList).catch(() => {});
    api<PatientOpt[]>("/patients").then(setPatients).catch(() => {});
    api<MedicineOpt[]>("/medicines").then(setMedicines).catch(() => {});
  }, []);

  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const isImage = !!file && file.type.startsWith("image/");
  const isPdf = !!file && file.type === "application/pdf";

  const onPickFile = (f: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    setScanError(""); setCapturedText(""); setScanPct(0); setFilledFields([]);
    if (!f) { setFile(null); setPreviewUrl(""); previewRef.current = ""; return; }
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    setFile(f);
    setPreviewUrl(url);
  };

  const scanAndFill = async () => {
    if (!file || !isImage) return;
    setScanning(true); setScanError(""); setScanPct(0); setFilledFields([]);
    setScanStatus("Loading OCR engine…");
    try {
      const text = await runOcr(file, (pct) => {
        setScanPct(pct);
        setScanStatus(`Reading prescription — ${pct}%`);
      });
      setCapturedText(text || "");
      if (text) {
        const parsed = parsePrescriptionText(text, medicines);
        if (parsed.filledFields.length > 0) {
          setForm((prev) => ({
            ...prev,
            ...(parsed.doctorName ? { doctorName: parsed.doctorName } : {}),
            ...(parsed.department ? { department: parsed.department } : {}),
            ...(parsed.diagnosisNotes ? { diagnosisNotes: parsed.diagnosisNotes } : {}),
            ...(parsed.symptoms ? { symptoms: parsed.symptoms } : {}),
            ...(parsed.allergies ? { allergies: parsed.allergies } : {}),
            ...(parsed.followUpDate ? { followUpDate: parsed.followUpDate } : {}),
            ...(parsed.medicineId ? { medicineId: parsed.medicineId } : {}),
            ...(parsed.dosage ? { dosage: parsed.dosage } : {}),
            ...(parsed.quantity ? { quantity: parsed.quantity } : {}),
          }));
          setFilledFields(parsed.filledFields);
          setFormErrors({});
        } else {
          setScanError("No recognisable fields found — please fill the form manually.");
        }
      } else {
        setScanError("No text detected in this image. Ensure the photo is clear and well-lit.");
      }
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed — please fill the form manually.");
      setScanStatus("");
    } finally {
      setScanning(false);
      setScanStatus("");
    }
  };

  const clearCapture = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setFile(null); setPreviewUrl(""); setCapturedText(""); setScanError(""); setScanPct(0); setFilledFields([]); setScanStatus("");
  };

  const setField = (key: keyof typeof EMPTY, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key]) setFormErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.patientId) errs.patientId = "Please select a patient";
    const docErr = validatePersonName(form.doctorName, "Doctor name");
    if (docErr) errs.doctorName = docErr;
    if (errs.patientId || errs.doctorName) { setFormErrors(errs); return false; }
    return true;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!validate()) return;
    setBusy(true);
    try {
      const fd = new FormData();
      const notes = [form.prescriptionNotes, capturedText.trim() ? `[Captured from scan]\n${capturedText.trim()}` : ""]
        .filter(Boolean).join("\n\n");
      const fields: Record<string, string> = { ...form, prescriptionNotes: notes };
      Object.entries(fields).forEach(([k, v]) => {
        if (v && k !== "medicineId" && k !== "dosage" && k !== "quantity") fd.append(k, v);
      });
      if (form.medicineId) {
        fd.append("medicines", JSON.stringify([{
          medicineId: form.medicineId,
          dosage: form.dosage || undefined,
          quantity: form.quantity ? Number(form.quantity) : undefined,
        }]));
      }
      if (file) fd.append("prescription", file);
      await api("/prescriptions", { method: "POST", body: fd });
      setSuccess("Prescription saved" + (file ? " with attached scan." : "."));
      setForm(EMPTY);
      setFormErrors({});
      clearCapture();
      setShowForm(false);
      api("/prescriptions").then(setList);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save prescription");
    } finally {
      setBusy(false);
    }
  };

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      <OperationsTabs />

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      <div className="flex justify-end">
        <Button onClick={() => { setShowForm((s) => !s); setError(""); }}>
          <Plus className="mr-2 h-4 w-4" /> New Prescription
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Prescription</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">

              {/* ── Left: form fields ── */}
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Patient */}
                <div className="sm:col-span-2">
                  <Label>Patient *</Label>
                  <select
                    className={`h-11 w-full rounded-lg border px-3 text-sm ${formErrors.patientId ? "border-red-400" : ""}`}
                    value={form.patientId}
                    onChange={(e) => setField("patientId", e.target.value)}
                  >
                    <option value="">Select patient</option>
                    {patients.map((p) => (
                      <option key={p.id} value={p.id}>{p.firstName} {p.lastName} ({p.patientId})</option>
                    ))}
                  </select>
                  {formErrors.patientId && <p className="mt-1 text-sm text-red-600">{formErrors.patientId}</p>}
                </div>

                {/* Doctor */}
                <div>
                  <Label>Doctor</Label>
                  <Input
                    value={form.doctorName}
                    placeholder="Doctor name"
                    className={formErrors.doctorName ? "border-red-400" : ""}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const sanitized = raw.replace(/[^A-Za-z .'-]/g, "");
                      setForm((prev) => ({ ...prev, doctorName: sanitized }));
                      setFormErrors((prev) => {
                        if (raw !== sanitized && /\d/.test(raw)) return { ...prev, doctorName: "Doctor name must not contain numbers" };
                        if (raw !== sanitized) return { ...prev, doctorName: "Doctor name must not contain special characters" };
                        const n = { ...prev }; delete n.doctorName; return n;
                      });
                    }}
                  />
                  {formErrors.doctorName && <p className="mt-1 text-sm text-red-600">{formErrors.doctorName}</p>}
                </div>

                {/* Department */}
                <div>
                  <Label>Department</Label>
                  <Input
                    value={form.department}
                    placeholder="Department"
                    onChange={(e) => setField("department", e.target.value)}
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label>Diagnosis</Label>
                  <Input value={form.diagnosisNotes} onChange={(e) => setField("diagnosisNotes", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Symptoms / Chief Complaint</Label>
                  <Input value={form.symptoms} onChange={(e) => setField("symptoms", e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Allergies</Label>
                  <Input value={form.allergies} placeholder="Known allergies" onChange={(e) => setField("allergies", e.target.value)} />
                </div>

                {/* Follow-up */}
                <div>
                  <Label>Follow-up date</Label>
                  <Input type="date" value={form.followUpDate} onChange={(e) => setField("followUpDate", e.target.value)} />
                </div>

                {/* Medicine */}
                <div className="sm:col-span-2">
                  <Label>Medicine (optional)</Label>
                  <MedicineCombobox
                    medicines={medicines}
                    value={form.medicineId}
                    onChange={(id) => setField("medicineId", id)}
                    placeholder="Search or leave blank…"
                    className="h-11"
                  />
                </div>
                <div>
                  <Label>Dosage</Label>
                  <Input value={form.dosage} placeholder="Dosage" onChange={(e) => setField("dosage", e.target.value)} />
                </div>
                <div>
                  <Label>Quantity</Label>
                  <Input inputMode="numeric" value={form.quantity} onChange={(e) => setField("quantity", e.target.value.replace(/\D/g, ""))} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Additional notes</Label>
                  <Input value={form.prescriptionNotes} onChange={(e) => setField("prescriptionNotes", e.target.value)} />
                </div>
              </div>

              {/* ── Right: scan panel ── */}
              <div className="flex flex-col gap-3">
                <div className="rounded-lg border border-dashed bg-slate-50/60 p-3">
                  <p className="mb-2 text-sm font-medium text-slate-700">Prescription scan</p>

                  {!file ? (
                    <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-white px-4 py-8 text-center text-sm text-slate-500 hover:border-medflow-300">
                      <Upload className="h-6 w-6 text-slate-400" />
                      <span className="font-medium text-slate-600">Upload image or PDF</span>
                      <span className="text-sm text-slate-400">Attach the physical prescription for the record</span>
                      <Input
                        type="file"
                        accept="image/jpeg,image/png,image/jpg,.pdf,application/pdf"
                        className="hidden"
                        onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                          <FileText className="h-4 w-4" /> {file.name}
                        </span>
                        <button type="button" className="text-slate-400 hover:text-red-500" onClick={clearCapture}>
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      {isImage && <img src={previewUrl} alt="Prescription preview" className="max-h-52 w-full rounded-lg border object-contain" />}
                      {isPdf && <iframe src={previewUrl} title="Prescription PDF" className="h-52 w-full rounded-lg border" />}

                      {/* File upload confirmation */}
                      {!scanning && !scanError && filledFields.length === 0 && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          File attached: <span className="font-medium truncate max-w-[160px]">{file.name}</span>
                          <span className="ml-auto text-slate-400">{(file.size / 1024).toFixed(0)} KB</span>
                        </div>
                      )}

                      {/* Scan & fill button — only for images */}
                      {isImage && !scanning && (
                        <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={scanAndFill}>
                          <ScanLine className="h-4 w-4" />
                          {filledFields.length > 0 ? "Re-scan & Fill" : "Scan & Auto-fill Form"}
                        </Button>
                      )}

                      {/* Scanning progress */}
                      {scanning && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 rounded-lg border border-medflow-100 bg-medflow-50 p-2.5 text-sm text-medflow-700">
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                            {scanStatus || "Processing…"}
                          </div>
                          {scanPct > 0 && (
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-medflow-100">
                              <div className="h-full bg-medflow-500 transition-all" style={{ width: `${scanPct}%` }} />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Scan error */}
                      {scanError && (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{scanError}</p>
                      )}

                      {/* Success banner */}
                      {filledFields.length > 0 && !scanning && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5">
                          <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" />
                            Auto-filled {filledFields.length} field{filledFields.length !== 1 ? "s" : ""} — please review
                          </div>
                          <p className="mt-0.5 text-sm text-emerald-600">{filledFields.join(", ")}</p>
                        </div>
                      )}

                      {/* Extracted text */}
                      {capturedText && !scanning && (
                        <div>
                          <Label className="text-sm text-slate-500">Extracted text (editable)</Label>
                          <textarea
                            className="mt-1 h-20 w-full rounded-lg border px-3 py-2 text-sm text-slate-600"
                            value={capturedText}
                            onChange={(e) => setCapturedText(e.target.value)}
                          />
                        </div>
                      )}

                      {isPdf && (
                        <p className="text-sm text-slate-400">PDF attached. Text extraction is not available for PDFs — fill the form manually.</p>
                      )}
                    </div>
                  )}
                  <p className="mt-2 text-sm text-slate-400">Always verify extracted values before saving.</p>
                </div>

                <div className="flex gap-2">
                  <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save Prescription"}</Button>
                  <Button type="button" variant="outline" onClick={() => { setShowForm(false); setForm(EMPTY); setFormErrors({}); clearCapture(); }}>Cancel</Button>
                </div>
              </div>

            </form>
          </CardContent>
        </Card>
      )}

      {/* Prescription list */}
      {list.map((rx) => {
        const r = rx as {
          id: string; prescriptionId: string; patient?: { firstName: string; lastName: string };
          doctorName?: string; department?: string; diagnosisNotes?: string;
          status: string; prescriptionDate: string; uploadedPrescriptionUrl?: string;
        };
        return (
          <Card key={r.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/prescriptions/${r.id}`} className="font-semibold hover:text-medflow-700 hover:underline">{r.prescriptionId}</Link>
                  <p className="text-sm">{r.patient?.firstName} {r.patient?.lastName} — {r.doctorName || "N/A"}</p>
                  <p className="text-sm text-muted-foreground">{[r.department, r.diagnosisNotes].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{r.status} · {new Date(r.prescriptionDate).toLocaleDateString()}</p>
              {r.uploadedPrescriptionUrl && (
                <a href={`${apiBaseUrl()}${r.uploadedPrescriptionUrl}`} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-medflow-600 hover:underline">
                  <FileText className="h-3.5 w-3.5" /> View attached scan
                </a>
              )}
            </CardContent>
          </Card>
        );
      })}
      {list.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No prescriptions yet.</p>}
    </div>
  );
}
