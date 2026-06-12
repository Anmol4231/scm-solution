"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Upload, FileText, X, CheckCircle2, Loader2, ScanLine, Trash2, ChevronDown, AlertCircle, Building2 } from "lucide-react";
import { api, resolveApiUrl } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OperationsTabs } from "@/components/layout/operations-tabs";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";

function apiBaseUrl() {
  return resolveApiUrl().replace(/\/api$/, "");
}

interface MedicineOpt { id: string; medicineName: string }
interface PatientOpt { id: string; firstName: string; lastName: string; patientId: string }

interface RxLine { medicineId: string; dosage: string; quantity: string }

/** Server OCR response (POST /prescriptions/ocr). */
interface OcrResponse {
  rawText: string;
  confidence?: number;
  doctorName?: string | null;
  diagnosisNotes?: string | null;
  department?: string | null;
  symptoms?: string | null;
  allergies?: string | null;
  followUpDate?: string | null;
  medicines?: {
    medicineName: string;
    strength?: string | null;
    dosage?: string | null;
    quantity?: number | null;
    medicineId?: string | null;
    candidates?: { id: string; medicineName: string }[];
  }[];
  fieldsDetected?: string[];
  warnings?: string[];
  error?: string;
}

interface OcrAmbiguity { lineIndex: number; ocrName: string; candidates: { id: string; medicineName: string }[] }

function validatePersonName(v: string, label: string): string {
  const t = v.trim();
  if (!t) return "";
  if (/\d/.test(t)) return `${label} must not contain numbers`;
  if (/[^A-Za-z .'-]/.test(t)) return `${label} must not contain special characters`;
  if (!/[A-Za-z]/.test(t)) return `${label} must contain at least one letter`;
  return "";
}

const EMPTY_FORM = {
  patientId: "", doctorName: "", department: "", diagnosisNotes: "", symptoms: "",
  followUpDate: "", allergies: "", prescriptionNotes: "",
};
const EMPTY_LINE: RxLine = { medicineId: "", dosage: "", quantity: "" };

export default function PrescriptionsPage() {
  const hasAccess = useRequirePermission("prescriptions");
  const { user } = useAuth();

  /* Facility selection — only needed for cross-facility roles (no JWT facilityId). */
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState("");
  /* Effective facility for all API calls on this page. */
  const effectiveFacilityId = user?.facilityId ?? selectedFacilityId;

  useEffect(() => {
    if (!user?.facilityId) {
      api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
    }
  }, [user?.facilityId]);

  const [list, setList] = useState<Record<string, unknown>[]>([]);
  const [patients, setPatients] = useState<PatientOpt[]>([]);
  const [medicines, setMedicines] = useState<MedicineOpt[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [lines, setLines] = useState<RxLine[]>([{ ...EMPTY_LINE }]);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // Scan state — OCR runs server-side (same pipeline as the dispense workflow)
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [ocrAmbiguous, setOcrAmbiguous] = useState<OcrAmbiguity[]>([]);
  const [rawTextOpen, setRawTextOpen] = useState(false);
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
    setScanError(""); setOcrResult(null); setOcrAmbiguous([]); setRawTextOpen(false);
    if (!f) { setFile(null); setPreviewUrl(""); previewRef.current = ""; return; }
    const url = URL.createObjectURL(f);
    previewRef.current = url;
    setFile(f);
    setPreviewUrl(url);
  };

  const scanAndFill = async () => {
    if (!file || !isImage) return;
    setScanning(true); setScanError(""); setOcrResult(null); setOcrAmbiguous([]);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const result = await api<OcrResponse>("/prescriptions/ocr", { method: "POST", body: fd });
      setOcrResult(result);

      setForm((prev) => ({
        ...prev,
        ...(result.doctorName ? { doctorName: result.doctorName } : {}),
        ...(result.department ? { department: result.department } : {}),
        ...(result.diagnosisNotes ? { diagnosisNotes: result.diagnosisNotes } : {}),
        ...(result.symptoms ? { symptoms: result.symptoms } : {}),
        ...(result.allergies ? { allergies: result.allergies } : {}),
        ...(result.followUpDate ? { followUpDate: result.followUpDate } : {}),
      }));

      if (result.medicines?.length) {
        const mapped: RxLine[] = [];
        const ambiguous: OcrAmbiguity[] = [];
        result.medicines.forEach((m, idx) => {
          mapped.push({
            medicineId: m.medicineId ?? "",
            dosage: m.dosage ?? m.strength ?? "",
            quantity: m.quantity ? String(m.quantity) : "",
          });
          if (!m.medicineId) {
            ambiguous.push({ lineIndex: idx, ocrName: m.medicineName, candidates: m.candidates ?? [] });
          }
        });
        setLines(mapped.length ? mapped : [{ ...EMPTY_LINE }]);
        setOcrAmbiguous(ambiguous);
      }
      setFormErrors({});
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed — please fill the form manually.");
    } finally {
      setScanning(false);
    }
  };

  const selectOcrMedicine = (lineIndex: number, medicineId: string) => {
    setLines((ls) => ls.map((l, idx) => (idx === lineIndex ? { ...l, medicineId } : l)));
    setOcrAmbiguous((prev) => prev.filter((x) => x.lineIndex !== lineIndex));
  };

  const clearCapture = () => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = "";
    setFile(null); setPreviewUrl(""); setScanError(""); setOcrResult(null); setOcrAmbiguous([]); setRawTextOpen(false);
  };

  const setField = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (formErrors[key]) setFormErrors((prev) => { const n = { ...prev }; delete n[key]; return n; });
  };

  const setLine = (i: number, patch: Partial<RxLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const validate = (): string => {
    const errs: Record<string, string> = {};
    if (!user?.facilityId && !selectedFacilityId) errs.facilityId = "Please select a facility";
    if (!form.patientId) errs.patientId = "Please select a patient";
    const docErr = validatePersonName(form.doctorName, "Doctor name");
    if (docErr) errs.doctorName = docErr;
    setFormErrors(errs);
    if (Object.keys(errs).length) return "Please fix the highlighted fields.";

    const filled = lines.filter((l) => l.medicineId || l.quantity.trim() || l.dosage.trim());
    if (!filled.length) return "Add at least one medicine to the prescription.";
    if (filled.some((l) => !l.medicineId)) return "Please select a medicine from the Medicine Master for every line.";
    // C4: every line needs a prescribed quantity — open-ended lines would allow unlimited dispensing.
    if (filled.some((l) => !l.quantity.trim() || Number(l.quantity) <= 0)) return "Every medicine needs a prescribed quantity.";
    return "";
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    const v = validate();
    if (v) return setError(v);
    setBusy(true);
    try {
      const filled = lines.filter((l) => l.medicineId);
      const fd = new FormData();
      Object.entries(form).forEach(([k, val]) => { if (val) fd.append(k, val); });
      if (effectiveFacilityId) fd.append("facilityId", effectiveFacilityId);
      fd.append("medicines", JSON.stringify(filled.map((l) => ({
        medicineId: l.medicineId,
        dosage: l.dosage || undefined,
        quantity: Number(l.quantity),
      }))));
      if (file) fd.append("prescription", file);
      await api("/prescriptions", { method: "POST", body: fd });
      setSuccess("Prescription saved" + (file ? " with attached scan." : "."));
      setForm(EMPTY_FORM);
      setLines([{ ...EMPTY_LINE }]);
      setFormErrors({});
      if (!user?.facilityId) setSelectedFacilityId("");
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
                {/* Facility selector — only shown for cross-facility roles */}
                {!user?.facilityId && (
                  <div className="sm:col-span-2">
                    <Label className="flex items-center gap-1.5">
                      <Building2 className="h-3.5 w-3.5 text-medflow-600" />
                      Facility *
                    </Label>
                    <select
                      className={`h-11 w-full rounded-lg border px-3 text-sm ${formErrors.facilityId ? "border-red-400" : ""}`}
                      value={selectedFacilityId}
                      onChange={(e) => {
                        setSelectedFacilityId(e.target.value);
                        if (formErrors.facilityId) setFormErrors((p) => { const n = { ...p }; delete n.facilityId; return n; });
                      }}
                    >
                      <option value="">— Select facility —</option>
                      {facilities.map((f) => (
                        <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
                      ))}
                    </select>
                    {formErrors.facilityId && <p className="mt-1 text-sm text-red-600">{formErrors.facilityId}</p>}
                  </div>
                )}

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
                  <Input value={form.department} placeholder="Department" onChange={(e) => setField("department", e.target.value)} />
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

                <div className="sm:col-span-2">
                  <Label>Additional notes</Label>
                  <Input value={form.prescriptionNotes} onChange={(e) => setField("prescriptionNotes", e.target.value)} />
                </div>

                {/* Medicines — multi-line (H2) */}
                <div className="sm:col-span-2">
                  <Label className="mb-1.5 block">Medicines *</Label>
                  <div className="rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-xs text-slate-500">
                        <tr>
                          <th className="p-2 pl-3">Medicine</th>
                          <th className="p-2 w-28">Dosage</th>
                          <th className="p-2 w-20 text-right">Qty *</th>
                          <th className="p-2 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {lines.map((ln, i) => (
                          <tr key={i}>
                            <td className="p-2 pl-3">
                              <MedicineCombobox
                                medicines={medicines}
                                value={ln.medicineId}
                                onChange={(id) => setLine(i, { medicineId: id })}
                                className="h-9"
                              />
                            </td>
                            <td className="p-2">
                              <Input className="h-9" placeholder="Dosage" value={ln.dosage}
                                onChange={(e) => setLine(i, { dosage: e.target.value })} />
                            </td>
                            <td className="p-2">
                              <Input className="h-9 text-right" inputMode="numeric" placeholder="Qty" value={ln.quantity}
                                onChange={(e) => setLine(i, { quantity: e.target.value.replace(/\D/g, "") })} />
                            </td>
                            <td className="p-2">
                              {lines.length > 1 && (
                                <button type="button"
                                  className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500"
                                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
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
                    onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}>
                    <Plus className="h-4 w-4" /> Add medicine
                  </button>
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

                      {isImage && !scanning && (
                        <Button type="button" variant="outline" size="sm" className="w-full gap-2" onClick={scanAndFill}>
                          <ScanLine className="h-4 w-4" />
                          {ocrResult ? "Re-scan & Fill" : "Scan & Auto-fill Form"}
                        </Button>
                      )}

                      {scanning && (
                        <div className="flex items-center gap-2 rounded-lg border border-medflow-100 bg-medflow-50 p-2.5 text-sm text-medflow-700">
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                          Running OCR on the server — this may take a few seconds…
                        </div>
                      )}

                      {scanError && (
                        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">{scanError}</p>
                      )}

                      {ocrResult && !scanning && (
                        <div className="space-y-1.5 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm">
                          <div className="flex items-center gap-1.5 font-medium text-emerald-700">
                            <CheckCircle2 className="h-4 w-4" />
                            OCR complete
                            {ocrResult.confidence !== undefined && (
                              <span className="ml-auto text-xs font-normal text-emerald-600">{ocrResult.confidence}% confidence</span>
                            )}
                          </div>
                          {(ocrResult.fieldsDetected?.length ?? 0) > 0 ? (
                            <p className="text-xs text-emerald-700">Fields detected: <strong>{ocrResult.fieldsDetected!.join(", ")}</strong> — please review</p>
                          ) : (
                            <p className="text-xs font-medium text-orange-600">No prescription fields detected — fill the form manually.</p>
                          )}
                          {(ocrResult.warnings?.length ?? 0) > 0 && (
                            <ul className="space-y-0.5">
                              {ocrResult.warnings!.map((w, i) => (
                                <li key={i} className="text-xs text-amber-700">⚠ {w}</li>
                              ))}
                            </ul>
                          )}

                          {/* Ambiguous / unmatched medicine resolution */}
                          {ocrAmbiguous.length > 0 && (
                            <div className="space-y-1.5 border-t border-emerald-200 pt-2">
                              {ocrAmbiguous.map((item) => (
                                <div key={item.lineIndex}
                                  className={`rounded border p-2 text-xs ${item.candidates.length ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
                                  <p className={item.candidates.length ? "text-amber-800" : "text-red-700"}>
                                    <AlertCircle className="mr-1 inline h-3.5 w-3.5" />
                                    OCR: <strong>&ldquo;{item.ocrName}&rdquo;</strong>
                                    {item.candidates.length === 0 ? " — not in medicine master, select manually." : " — select the correct match:"}
                                  </p>
                                  {item.candidates.length > 0 && (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {item.candidates.map((c) => (
                                        <button key={c.id} type="button"
                                          className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium hover:bg-amber-100"
                                          onClick={() => selectOcrMedicine(item.lineIndex, c.id)}>
                                          {c.medicineName}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <button type="button"
                            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
                            onClick={() => setRawTextOpen((v) => !v)}>
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rawTextOpen ? "rotate-180" : ""}`} />
                            {rawTextOpen ? "Hide" : "Show"} raw OCR text
                          </button>
                          {rawTextOpen && (
                            <pre className="max-h-40 overflow-auto rounded border bg-white p-2 text-xs text-slate-700 whitespace-pre-wrap">
                              {ocrResult.rawText || "(empty — image may be blank or unreadable)"}
                            </pre>
                          )}
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
                  <Button type="button" variant="outline" onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setLines([{ ...EMPTY_LINE }]); setFormErrors({}); if (!user?.facilityId) setSelectedFacilityId(""); clearCapture(); }}>Cancel</Button>
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
          medicines?: unknown[];
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
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  r.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : r.status === "COMPLETED" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"
                }`}>{r.status}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {r.medicines?.length ? `${r.medicines.length} medicine(s) · ` : ""}
                {new Date(r.prescriptionDate).toLocaleDateString()}
              </p>
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
