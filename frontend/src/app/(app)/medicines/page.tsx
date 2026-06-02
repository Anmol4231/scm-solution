"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Eye, Filter, Pencil, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Category {
  id: string;
  name: string;
  description?: string | null;
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
  strength?: string | null;
  strengths?: Strength[];
  reorderThreshold: number;
  leadTimeDays?: number | null;
  minimumOrderLevel?: number | null;
  categoryId?: string | null;
  category?: Category | null;
  isActive?: boolean;
}

interface Suggestion {
  id: string;
  label: string;
  medicineName: string;
  genericName?: string | null;
  strength?: string | null;
  categoryName?: string | null;
}

const emptyForm = {
  medicineName: "",
  genericName: "",
  dosageForm: "",
  strengthsText: "",
  reorderThreshold: 50,
  leadTimeDays: "",
  minimumOrderLevel: "",
  categoryId: "",
};

const namePattern = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;

function parseStrengths(value: string) {
  return Array.from(new Set(value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)));
}

function strengthLabel(m: Medicine) {
  const strengths = m.strengths?.map((s) => s.strength).filter(Boolean);
  if (strengths?.length) return strengths.join(", ");
  return m.strength || "Not recorded";
}

const adminNav = [
  { href: "/medicines", label: "Medicine Master" },
  { href: "/medicines/categories", label: "Categories" },
  { href: "/medicines/recent-changes", label: "Recent Changes" },
];

function MedicineCard({ medicine: m }: { medicine: Medicine }) {
  return (
    <Link href={`/medicines/${m.id}`}>
      <Card className="cursor-pointer transition hover:border-medflow-300 hover:shadow-sm">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{m.medicineName}</p>
              <p className="text-sm text-muted-foreground">
                {[m.genericName, m.dosageForm, strengthLabel(m)].filter(Boolean).join(" | ")}
              </p>
            </div>
            {m.category && (
              <span className="shrink-0 rounded-full bg-medflow-50 px-2 py-0.5 text-xs font-medium text-medflow-700">
                {m.category.name}
              </span>
            )}
          </div>
          <span className="mt-2 inline-block text-xs text-medflow-600">View details</span>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function MedicinesPage() {
  const { user } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingMedicineId, setEditingMedicineId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadCategories = () => api<Category[]>("/categories").then(setCategories);

  const load = (search = debouncedQ, cat = categoryFilter) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (cat) params.set("categoryId", cat);
    const query = params.toString() ? `?${params}` : "";
    api<Medicine[]>(`/medicines${query}`).then(setMedicines).catch(console.error);
  };

  useEffect(() => {
    loadCategories();
    load("", "");
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => window.clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    load(debouncedQ, categoryFilter);
    if (debouncedQ.length < 2) {
      setSuggestions([]);
      return;
    }
    api<Suggestion[]>(`/medicines/suggestions?q=${encodeURIComponent(debouncedQ)}&limit=8`)
      .then(setSuggestions)
      .catch(() => setSuggestions([]));
  }, [debouncedQ, categoryFilter]);

  const filteredCategory = useMemo(
    () => categories.find((c) => c.id === categoryFilter),
    [categories, categoryFilter]
  );

  const grouped = categories
    .map((cat) => ({
      category: cat,
      items: medicines.filter((m) => m.categoryId === cat.id),
    }))
    .filter((g) => g.items.length > 0);

  const uncategorized = medicines.filter((m) => !m.categoryId);

  const resetMedicineForm = () => {
    setForm(emptyForm);
    setEditingMedicineId(null);
    setShowForm(false);
  };

  const startAddMedicine = () => {
    setError("");
    setSuccess("");
    setEditingMedicineId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const startEditMedicine = (medicine: Medicine) => {
    setError("");
    setSuccess("");
    setEditingMedicineId(medicine.id);
    setShowForm(true);
    setForm({
      medicineName: medicine.medicineName,
      genericName: medicine.genericName ?? "",
      dosageForm: medicine.dosageForm ?? "",
      strengthsText: medicine.strengths?.length ? medicine.strengths.map((s) => s.strength).join("\n") : medicine.strength ?? "",
      reorderThreshold: medicine.reorderThreshold,
      leadTimeDays: medicine.leadTimeDays?.toString() ?? "",
      minimumOrderLevel: medicine.minimumOrderLevel?.toString() ?? "",
      categoryId: medicine.categoryId ?? "",
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!isAdmin) return setError("Only administrators can manage medicine master data.");
    if (!form.categoryId) return setError("Please select a category");
    if (!namePattern.test(form.medicineName)) return setError("Medicine Name contains invalid characters");
    if (form.genericName && !namePattern.test(form.genericName)) return setError("Generic Name contains invalid characters");
    if (!Number.isInteger(Number(form.reorderThreshold))) return setError("Stock Threshold must be a whole number");

    const payload = {
      medicineName: form.medicineName,
      genericName: form.genericName || undefined,
      dosageForm: form.dosageForm || undefined,
      strengths: parseStrengths(form.strengthsText),
      reorderThreshold: Number(form.reorderThreshold),
      leadTimeDays: form.leadTimeDays ? Number(form.leadTimeDays) : undefined,
      minimumOrderLevel: form.minimumOrderLevel ? Number(form.minimumOrderLevel) : undefined,
      categoryId: form.categoryId,
    };

    try {
      await api(editingMedicineId ? `/medicines/${editingMedicineId}` : "/medicines", {
        method: editingMedicineId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setSuccess(editingMedicineId ? "Medicine updated" : `Added ${form.medicineName}`);
      resetMedicineForm();
      loadCategories();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save medicine");
    }
  };

  const chooseSuggestion = (suggestion: Suggestion) => {
    setQ(suggestion.medicineName);
    setDebouncedQ(suggestion.medicineName);
    setShowSuggestions(false);
  };

  if (!isAdmin) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold">Medicines</h1>
          <p className="text-sm text-muted-foreground">Browse medicines by category and open details for stock information.</p>
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        <Card>
          <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_260px]">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                load(q.trim(), categoryFilter);
              }}
            >
              <div className="relative flex-1">
                <Label className="sr-only">Search medicines</Label>
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  placeholder="Search medicines..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Button type="submit" variant="outline">Search</Button>
            </form>
            <select
              className="h-11 w-full rounded-lg border bg-white px-3 text-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c._count?.medicines ?? 0})
                </option>
              ))}
            </select>
          </CardContent>
        </Card>

        {categoryFilter && (
          <Button type="button" variant="ghost" className="gap-2 px-0" onClick={() => setCategoryFilter("")}>
            <ArrowLeft className="h-4 w-4" /> Back to categories
          </Button>
        )}

        {!categoryFilter && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map((c) => (
              <Card
                key={c.id}
                className="cursor-pointer transition hover:border-medflow-300 hover:shadow-sm"
                onClick={() => setCategoryFilter(c.id)}
              >
                <CardContent className="p-4">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-sm text-muted-foreground">{c._count?.medicines ?? 0} medicines</p>
                  {c.description && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{c.description}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="space-y-4">
          {categoryFilter ? (
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-medflow-700">
                  {filteredCategory?.name ?? "Selected category"}
                </h2>
                <span className="text-sm text-muted-foreground">{medicines.length} medicines</span>
              </div>
              <div className="space-y-2">
                {medicines.map((m) => <MedicineCard key={m.id} medicine={m} />)}
                {medicines.length === 0 && (
                  <Card>
                    <CardContent className="p-6 text-center text-sm text-muted-foreground">No medicines found in this category.</CardContent>
                  </Card>
                )}
              </div>
            </div>
          ) : (
            <>
              {grouped.map(({ category, items }) => (
                <div key={category.id}>
                  <h2 className="mb-2 text-lg font-semibold text-medflow-700">{category.name}</h2>
                  <div className="space-y-2">
                    {items.map((m) => <MedicineCard key={m.id} medicine={m} />)}
                  </div>
                </div>
              ))}
              {uncategorized.length > 0 && (
                <div>
                  <h2 className="mb-2 text-lg font-semibold text-muted-foreground">Uncategorized</h2>
                  <div className="space-y-2">
                    {uncategorized.map((m) => <MedicineCard key={m.id} medicine={m} />)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Medicines</h1>
          <p className="text-sm text-muted-foreground">Medicine reference records and stock-use metadata.</p>
        </div>
        {isAdmin && (
          <Button size="lg" onClick={startAddMedicine}>
            <Plus className="mr-2 h-4 w-4" /> Add Medicine
          </Button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto border-b">
        {adminNav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="whitespace-nowrap border-b-2 border-transparent px-2 py-2 text-sm font-medium text-slate-600 first:border-medflow-600 first:text-medflow-700"
          >
            {item.label}
          </Link>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_260px]">
          <div className="relative">
            <Label className="sr-only">Search medicines</Label>
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search name, generic, strength, category..."
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              className="pl-9"
            />
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
                {suggestions.map((s) => (
                  <button
                    key={`${s.id}-${s.label}`}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-medflow-50"
                    onMouseDown={() => chooseSuggestion(s)}
                  >
                    <span className="font-medium">{s.label}</span>
                    <span className="ml-2 text-xs text-slate-500">{s.genericName || s.categoryName || ""}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <select
              className="h-11 w-full rounded-lg border bg-white pl-9 pr-3 text-sm"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c._count?.medicines ?? 0})
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {showForm && isAdmin && (
        <Card>
          <CardHeader><CardTitle>{editingMedicineId ? "Edit Medicine" : "Add Medicine"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Label>Category *</Label>
                <select
                  className="h-11 w-full rounded-lg border px-3"
                  value={form.categoryId}
                  onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                  required
                >
                  <option value="">Select category</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Medicine Name *</Label>
                <Input value={form.medicineName} onChange={(e) => setForm({ ...form, medicineName: e.target.value })} required />
              </div>
              <div>
                <Label>Generic Name</Label>
                <Input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} />
              </div>
              <div>
                <Label>Dosage Form</Label>
                <select
                  className="h-11 w-full rounded-lg border px-3"
                  value={form.dosageForm}
                  onChange={(e) => setForm({ ...form, dosageForm: e.target.value })}
                >
                  <option value="">Select</option>
                  <option>Tablet</option>
                  <option>Capsule</option>
                  <option>Syrup</option>
                  <option>Injection</option>
                  <option>Sachet</option>
                  <option>Inhaler</option>
                  <option>IV Fluid</option>
                  <option>Vial</option>
                </select>
              </div>
              <div>
                <Label>Stock Threshold</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.reorderThreshold}
                  onChange={(e) => setForm({ ...form, reorderThreshold: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>Lead Time</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.leadTimeDays}
                  onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
                />
              </div>
              <div>
                <Label>Minimum Order Level</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.minimumOrderLevel}
                  onChange={(e) => setForm({ ...form, minimumOrderLevel: e.target.value })}
                />
              </div>
              <div className="md:col-span-2">
                <Label>Strengths</Label>
                <textarea
                  className="min-h-24 w-full rounded-lg border px-3 py-2 text-sm"
                  value={form.strengthsText}
                  onChange={(e) => setForm({ ...form, strengthsText: e.target.value })}
                  placeholder={"250mg\n500mg\n650mg"}
                />
              </div>
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit" size="lg">{editingMedicineId ? "Update Medicine" : "Save Medicine"}</Button>
                <Button type="button" size="lg" variant="outline" onClick={resetMedicineForm}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            Medicine Master {filteredCategory ? `- ${filteredCategory.name}` : ""}
          </CardTitle>
          <span className="text-sm text-muted-foreground">{medicines.length} shown</span>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Medicine Name</th>
                <th className="p-3">Generic Name</th>
                <th className="p-3">Strength</th>
                <th className="p-3">Dosage Form</th>
                <th className="p-3">Category</th>
                <th className="p-3">Stock Threshold</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {medicines.map((m) => (
                <tr key={m.id} className="border-b hover:bg-slate-50/70">
                  <td className="p-3 font-medium text-slate-900">{m.medicineName}</td>
                  <td className="p-3 text-slate-600">{m.genericName || "-"}</td>
                  <td className="p-3 text-slate-600">{strengthLabel(m)}</td>
                  <td className="p-3 text-slate-600">{m.dosageForm || "-"}</td>
                  <td className="p-3 text-slate-600">{m.category?.name || "Uncategorized"}</td>
                  <td className="p-3">{m.reorderThreshold}</td>
                  <td className="p-3">
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Button asChild type="button" size="sm" variant="outline">
                        <Link href={`/medicines/${m.id}`}><Eye className="mr-1 h-3.5 w-3.5" /> View</Link>
                      </Button>
                      {isAdmin && (
                        <Button type="button" size="sm" variant="outline" onClick={() => startEditMedicine(m)}>
                          <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {medicines.length === 0 && (
                <tr>
                  <td className="p-6 text-center text-muted-foreground" colSpan={8}>No medicines found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
