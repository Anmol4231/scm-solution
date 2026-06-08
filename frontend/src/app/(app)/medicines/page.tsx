"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Plus, ScrollText, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeMedicineName, sanitizeDosageForm, toDigitsOnly } from "@/lib/validation";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Category {
  id: string;
  name: string;
  description?: string | null;
  sortOrder?: number | null;
  _count?: { medicines: number };
}

interface Strength {
  id: string;
  strength: string;
}

interface Medicine {
  id: string;
  medicineName: string;
  genericName?: string | null;
  dosageForm?: string | null;
  dosageFormOther?: string | null;
  strength?: string | null;
  strengths?: Strength[];
  reorderThreshold: number;
  leadTimeDays?: number | null;
  minimumOrderLevel?: number | null;
  categoryId?: string | null;
  category?: Category | null;
}

// ─── Form defaults ────────────────────────────────────────────────────────────

interface MedForm {
  medicineName: string; genericName: string; dosageForm: string; dosageFormOther: string;
  strengthsText: string; reorderThreshold: string;
  leadTimeDays: string; minimumOrderLevel: string; categoryId: string;
}

const EMPTY_MED: MedForm = {
  medicineName: "", genericName: "", dosageForm: "", dosageFormOther: "",
  strengthsText: "", reorderThreshold: "50", leadTimeDays: "", minimumOrderLevel: "", categoryId: "",
};

// ─── Dosage form + strength options ──────────────────────────────────────────

const DOSAGE_FORMS = [
  "Tablet", "Capsule", "Syrup", "Suspension", "Injection",
  "Cream", "Ointment", "Drops", "Inhaler", "Sachet", "Powder", "Other",
];

const STRENGTH_OPTIONS: Record<string, string[]> = {
  Tablet:     ["5 mg","10 mg","25 mg","50 mg","100 mg","250 mg","500 mg","1000 mg"],
  Capsule:    ["5 mg","10 mg","25 mg","50 mg","100 mg","250 mg","500 mg","1000 mg"],
  Syrup:      ["125mg/5ml","250mg/5ml","500mg/5ml"],
  Suspension: ["125mg/5ml","250mg/5ml","500mg/5ml"],
  Injection:  ["1ml","2ml","5ml","10ml","100mg/ml","250mg/ml"],
  Cream:      ["0.5%","1%","2%","5%"],
  Ointment:   ["0.5%","1%","2%","5%"],
  Drops:      ["0.5%","1%","2%","5%"],
  Inhaler:    ["100mcg","200mcg","400mcg"],
  Sachet:     ["500 mg","1000 mg","1 g","5 g"],
  Powder:     ["500 mg","1 g","5 g"],
  Other:      [],
};

function strengthOptionsFor(form: string): string[] {
  return STRENGTH_OPTIONS[form] ?? [];
}

function parseStrengths(v: string) {
  return Array.from(new Set(v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)));
}

function strengthLabel(m: Medicine): string {
  const s = m.strengths?.map((x) => x.strength).filter(Boolean);
  if (s?.length) return s.join(", ");
  return m.strength ?? "";
}

// ─── Custom-strength persistence ──────────────────────────────────────────────

const STRENGTHS_KEY = "medflow_custom_strengths";

function loadCustomStrengths(): string[] {
  if (typeof window === "undefined") return [];
  try { return JSON.parse(localStorage.getItem(STRENGTHS_KEY) ?? "[]") as string[]; }
  catch { return []; }
}

function persistCustomStrengths(newStrengths: string[]) {
  if (typeof window === "undefined") return;
  try {
    const existing = loadCustomStrengths();
    const merged = Array.from(new Set([...existing, ...newStrengths])).sort();
    localStorage.setItem(STRENGTHS_KEY, JSON.stringify(merged));
  } catch { /* ignore */ }
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="h-4 w-4 animate-spin rounded-full border-2 border-medflow-400 border-t-transparent" />
  );
}

// ─── IntInput ─────────────────────────────────────────────────────────────────

function IntInput({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="text" inputMode="numeric" pattern="[0-9]*"
        value={value} placeholder={placeholder ?? "0"}
        onChange={(e) => onChange(toDigitsOnly(e.target.value))}
      />
    </div>
  );
}

// ─── StrengthSelector ────────────────────────────────────────────────────────

function StrengthSelector({
  dosageForm, value, onChange, suggestions = [],
}: { dosageForm: string; value: string; onChange: (v: string) => void; suggestions?: string[] }) {
  const options = strengthOptionsFor(dosageForm);
  const selected = parseStrengths(value);

  const toggle = (opt: string) => {
    const next = selected.includes(opt)
      ? selected.filter((s) => s !== opt)
      : [...selected, opt];
    onChange(next.join("\n"));
  };

  const customVal = selected.find((s) => !options.includes(s)) ?? "";

  const handleCustom = (raw: string) => {
    const existing = selected.filter((s) => options.includes(s));
    const trimmed = raw.trim();
    onChange([...existing, ...(trimmed ? [trimmed] : [])].join("\n"));
  };

  const datalistOptions = suggestions.filter((s) => !options.includes(s));

  return (
    <div>
      <Label>
        Strength *{options.length > 0 ? " (select or type custom)" : " (type value)"}
      </Label>
      {options.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-2">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                selected.includes(opt)
                  ? "border-medflow-400 bg-medflow-50 text-medflow-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <datalist id="strength-datalist">
        {datalistOptions.map((s) => <option key={s} value={s} />)}
      </datalist>
      <input
        list="strength-datalist"
        className="mt-2 h-11 w-full rounded-lg border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-medflow-400"
        placeholder="Strength"
        value={customVal}
        onChange={(e) => handleCustom(e.target.value)}
      />
      {selected.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          Selected: {selected.join(", ")}
        </p>
      )}
      {!dosageForm && (
        <p className="mt-1 text-sm text-amber-600">Select a dosage form first to see strength options.</p>
      )}
    </div>
  );
}

// ─── MedicineCard ─────────────────────────────────────────────────────────────

function MedicineCard({
  medicine: m, isAdmin, showCategory, onEdit, onDelete,
}: {
  medicine: Medicine; isAdmin: boolean; showCategory: boolean;
  onEdit?: (m: Medicine) => void;
  onDelete?: (m: Medicine) => void;
}) {
  const router = useRouter();
  const displayForm = m.dosageForm === "Other" && m.dosageFormOther ? m.dosageFormOther : m.dosageForm;
  const sub = [m.genericName, displayForm, strengthLabel(m)].filter(Boolean).join(" · ");

  return (
    <div
      role="button"
      tabIndex={0}
      className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border bg-white px-4 py-3.5 shadow-sm transition hover:border-medflow-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medflow-400"
      onClick={() => router.push(`/medicines/${m.id}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/medicines/${m.id}`)}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-slate-900">{m.medicineName}</p>
        {sub && <p className="mt-0.5 truncate text-sm text-muted-foreground">{sub}</p>}
        {showCategory && m.category && (
          <p className="mt-1 text-sm font-medium text-medflow-600">{m.category.name}</p>
        )}
      </div>
      {isAdmin && (
        <div className="mt-0.5 flex shrink-0 gap-0.5">
          <button
            type="button"
            aria-label="Edit"
            className="rounded p-1 text-slate-300 transition hover:text-slate-600"
            onClick={(e) => { e.stopPropagation(); onEdit?.(m); }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Delete"
            className="rounded p-1 text-slate-300 transition hover:text-red-500"
            onClick={(e) => { e.stopPropagation(); onDelete?.(m); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function MedicinesInner() {
  const { user } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);
  const router = useRouter();
  const hasAccess = useRequirePermission("medicines");
  const searchParams = useSearchParams();

  // ── Data ──
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryFilter, setCategoryFilter] = useState(() => searchParams.get("category") ?? "");

  // ── Loading / error ──
  const [catLoading, setCatLoading] = useState(true);
  const [medLoading, setMedLoading] = useState(true);
  const [medError, setMedError] = useState("");

  // ── Search (filters the medicine list across name/generic/category/form/strength) ──
  const [searchQ, setSearchQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");

  // ── Medicine form ──
  const [showMedForm, setShowMedForm] = useState(false);
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [medForm, setMedForm] = useState<MedForm>(EMPTY_MED);

  // ── Feedback ──
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ── Custom strength suggestions ──
  const [customStrengths, setCustomStrengths] = useState<string[]>([]);

  useEffect(() => { setCustomStrengths(loadCustomStrengths()); }, []);

  // ── Data loading ─────────────────────────────────────────────────────────────

  const loadCategories = () => {
    setCatLoading(true);
    api<Category[]>("/categories")
      .then((c) => { setCategories(c); setCatLoading(false); })
      .catch(() => setCatLoading(false));
  };

  const loadMedicines = (cat: string, q: string) => {
    setMedLoading(true);
    setMedError("");
    const params = new URLSearchParams();
    if (cat) params.set("categoryId", cat);
    if (q) params.set("q", q);
    const qs = params.toString() ? `?${params.toString()}` : "";
    api<Medicine[]>(`/medicines${qs}`)
      .then((m) => { setMedicines(m); setMedLoading(false); })
      .catch((err) => {
        setMedError(err instanceof Error ? err.message : "Failed to load medicines");
        setMedLoading(false);
      });
  };

  useEffect(() => { loadCategories(); }, []);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(searchQ.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  // Reload the medicine list when the category filter OR the search query changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadMedicines(categoryFilter, debouncedQ); }, [categoryFilter, debouncedQ]);

  // ── Medicine form helpers ────────────────────────────────────────────────────

  const resetMedForm = () => { setMedForm(EMPTY_MED); setEditingMedId(null); setShowMedForm(false); };

  const startAddMedicine = (presetCatId = "") => {
    setError(""); setSuccess("");
    setEditingMedId(null);
    setMedForm({ ...EMPTY_MED, categoryId: presetCatId || categoryFilter });
    setShowMedForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const startEditMedicine = (m: Medicine) => {
    setError(""); setSuccess("");
    setEditingMedId(m.id);
    setMedForm({
      medicineName: m.medicineName, genericName: m.genericName ?? "",
      dosageForm: m.dosageForm ?? "",
      dosageFormOther: m.dosageFormOther ?? "",
      strengthsText: m.strengths?.length ? m.strengths.map((s) => s.strength).join("\n") : (m.strength ?? ""),
      reorderThreshold: String(m.reorderThreshold),
      leadTimeDays: m.leadTimeDays != null ? String(m.leadTimeDays) : "",
      minimumOrderLevel: m.minimumOrderLevel != null ? String(m.minimumOrderLevel) : "",
      categoryId: m.categoryId ?? "",
    });
    setShowMedForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submitMedicine = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (!isAdmin) return;
    if (!medForm.categoryId) return setError("Please select a category.");
    if (!medForm.medicineName.trim()) return setError("Medicine Name is required.");
    if (!/[A-Za-z]/.test(medForm.medicineName)) return setError("Medicine Name must contain at least one alphabetic character (e.g. Amoxicillin 500mg).");
    if (medForm.genericName.trim() && !/[A-Za-z]/.test(medForm.genericName)) {
      return setError("Generic Name must be alphanumeric.");
    }
    if (!medForm.dosageForm) return setError("Dosage Form is required.");
    if (medForm.dosageForm === "Other") {
      if (!medForm.dosageFormOther.trim()) return setError("Please specify the dosage form.");
      if (!/[A-Za-z]/.test(medForm.dosageFormOther)) return setError("Dosage form must be alphanumeric.");
    }
    if (!parseStrengths(medForm.strengthsText).length) return setError("Strength is required.");
    if (!medForm.leadTimeDays) return setError("Lead Days is required.");
    const leadDays = parseInt(medForm.leadTimeDays, 10);
    if (isNaN(leadDays) || leadDays < 1) return setError("Lead Days must be greater than 0.");
    if (!medForm.minimumOrderLevel) return setError("Minimum Order Level is required.");
    const minOrder = parseInt(medForm.minimumOrderLevel, 10);
    if (isNaN(minOrder) || minOrder < 1) return setError("Minimum Order Level must be greater than 0.");
    const payload = {
      medicineName: medForm.medicineName.trim(),
      genericName: medForm.genericName.trim() || undefined,
      dosageForm: medForm.dosageForm,
      dosageFormOther: medForm.dosageForm === "Other" ? (medForm.dosageFormOther.trim() || null) : null,
      strengths: parseStrengths(medForm.strengthsText),
      reorderThreshold: medForm.reorderThreshold ? parseInt(medForm.reorderThreshold, 10) : 50,
      leadTimeDays: leadDays,
      minimumOrderLevel: minOrder,
      categoryId: medForm.categoryId,
    };
    try {
      await api(editingMedId ? `/medicines/${editingMedId}` : "/medicines", {
        method: editingMedId ? "PATCH" : "POST", body: JSON.stringify(payload),
      });
      setSuccess(editingMedId ? "Medicine updated" : `${medForm.medicineName} added`);
      const staticOpts = strengthOptionsFor(medForm.dosageForm);
      const customs = parseStrengths(medForm.strengthsText).filter((s) => !staticOpts.includes(s));
      if (customs.length) { persistCustomStrengths(customs); setCustomStrengths(loadCustomStrengths()); }
      resetMedForm(); loadCategories(); loadMedicines(categoryFilter, debouncedQ);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed to save medicine"); }
  };

  const deleteMedicine = async (m: Medicine) => {
    if (!window.confirm(`Delete "${m.medicineName}"? This can be restored from Audit Trail & Restore.`)) return;
    setError(""); setSuccess("");
    try {
      await api(`/medicines/${m.id}`, { method: "DELETE" });
      setSuccess(`"${m.medicineName}" deleted`);
      loadMedicines(categoryFilter, debouncedQ);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete medicine");
    }
  };

  const activeCategoryName = categories.find((c) => c.id === categoryFilter)?.name;

  if (!hasAccess) return null;

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Medicine Master</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={() => router.push("/settings/audit")}>
                <ScrollText className="mr-1.5 h-3.5 w-3.5" /> Audit Trail &amp; Restore
              </Button>
              <Button onClick={() => startAddMedicine()}>
                <Plus className="mr-2 h-4 w-4" /> Add Medicine
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      {/* ── Medicine Form ── */}
      {showMedForm && isAdmin && (
        <Card>
          <CardHeader><CardTitle>{editingMedId ? "Edit Medicine" : "Add Medicine"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submitMedicine} className="grid gap-3 md:grid-cols-2">
              {/* 1. Category */}
              <div className="md:col-span-2">
                <Label>Category *</Label>
                <select className="h-11 w-full rounded-lg border px-3 text-sm" value={medForm.categoryId}
                  onChange={(e) => setMedForm({ ...medForm, categoryId: e.target.value })} required>
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {/* 2. Medicine Name */}
              <div>
                <Label>Medicine Name *</Label>
                <Input value={medForm.medicineName} placeholder="Medicine name"
                  onChange={(e) => setMedForm({ ...medForm, medicineName: sanitizeMedicineName(e.target.value) })} required />
              </div>
              {/* Generic Name */}
              <div>
                <Label>Generic Name</Label>
                <Input value={medForm.genericName}
                  onChange={(e) => setMedForm({ ...medForm, genericName: sanitizeMedicineName(e.target.value) })} />
              </div>
              {/* 3. Dosage Form */}
              <div>
                <Label>Dosage Form *</Label>
                <select
                  className="h-11 w-full rounded-lg border px-3 text-sm"
                  value={medForm.dosageForm}
                  onChange={(e) => {
                    // Changing dosage form clears both the "other" specifier and selected strengths.
                    setMedForm({ ...medForm, dosageForm: e.target.value, dosageFormOther: "", strengthsText: "" });
                  }}
                  required
                >
                  <option value="">Select dosage form</option>
                  {DOSAGE_FORMS.map((f) => <option key={f}>{f}</option>)}
                </select>
              </div>
              {/* Specify Dosage Form — visible only when "Other" is selected */}
              {medForm.dosageForm === "Other" && (
                <div>
                  <Label>Specify Dosage Form *</Label>
                  <Input
                    placeholder="Dosage form"
                    value={medForm.dosageFormOther}
                    onChange={(e) => setMedForm({ ...medForm, dosageFormOther: sanitizeDosageForm(e.target.value) })}
                    required
                  />
                </div>
              )}
              {/* 4. Strength — updates based on Dosage Form */}
              <div className="md:col-span-2">
                <StrengthSelector
                  dosageForm={medForm.dosageForm}
                  value={medForm.strengthsText}
                  onChange={(v) => setMedForm({ ...medForm, strengthsText: v })}
                  suggestions={customStrengths}
                />
              </div>
              {/* 5. Thresholds */}
              <IntInput label="Stock Threshold" value={medForm.reorderThreshold} placeholder="50"
                onChange={(v) => setMedForm({ ...medForm, reorderThreshold: v })} />
              <IntInput label="Lead Days *" value={medForm.leadTimeDays} placeholder="Days"
                onChange={(v) => setMedForm({ ...medForm, leadTimeDays: v })} />
              <IntInput label="Minimum Order Level *" value={medForm.minimumOrderLevel} placeholder="Quantity"
                onChange={(v) => setMedForm({ ...medForm, minimumOrderLevel: v })} />
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">{editingMedId ? "Update Medicine" : "Save Medicine"}</Button>
                <Button type="button" variant="outline" onClick={resetMedForm}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Search ── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
        <Input
          className="pl-9"
          placeholder=""
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
      </div>

      {/* ── Category filter dropdown + medicines list ── */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-800">
              {debouncedQ ? `Results for "${debouncedQ}"` : activeCategoryName ?? "All Medicines"}
            </h2>
            {!medLoading && (
              <span className="text-sm text-muted-foreground">· {medicines.length}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!debouncedQ && !catLoading && categories.length > 0 && (
              <select
                className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-medflow-400"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <option value="">All Categories ({categories.reduce((s, c) => s + (c._count?.medicines ?? 0), 0)})</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c._count?.medicines ?? 0})
                  </option>
                ))}
              </select>
            )}
            {isAdmin && categoryFilter && (
              <Button size="sm" variant="ghost" onClick={() => startAddMedicine(categoryFilter)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add here
              </Button>
            )}
          </div>
        </div>

        {medLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Spinner /> Loading medicines…
          </div>
        ) : medError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {medError}
          </div>
        ) : medicines.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center">
            <p className="text-sm text-muted-foreground">
              No medicines found{categoryFilter ? " in this category" : ""}.
            </p>
            {isAdmin && (
              <Button size="sm" className="mt-3" onClick={() => startAddMedicine(categoryFilter)}>
                <Plus className="mr-2 h-4 w-4" /> Add Medicine
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {medicines.map((m) => (
              <MedicineCard
                key={m.id}
                medicine={m}
                isAdmin={isAdmin}
                showCategory={!categoryFilter || !!debouncedQ}
                onEdit={startEditMedicine}
                onDelete={deleteMedicine}
              />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}

export default function MedicinesPage() {
  return (
    <Suspense>
      <MedicinesInner />
    </Suspense>
  );
}
