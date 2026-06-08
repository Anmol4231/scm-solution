"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, ScrollText, Search, Tags, Thermometer, Trash2, FileText, Shield } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { sanitizeCategoryName } from "@/lib/validation";

interface Category {
  id: string;
  name: string;
  description?: string | null;
  coldStorage: boolean;
  controlledDrug: boolean;
  requiresPrescription: boolean;
  _count?: { medicines: number };
}

interface CatForm {
  name: string;
  description: string;
  coldStorage: boolean;
  controlledDrug: boolean;
  requiresPrescription: boolean;
}

const EMPTY_CAT: CatForm = {
  name: "",
  description: "",
  coldStorage: false,
  controlledDrug: false,
  requiresPrescription: false,
};

// ─── Filter state ────────────────────────────────────────────────────────────

type FilterKey = "all" | "coldStorage" | "controlledDrug" | "requiresPrescription";

// ─── CategoryCard ─────────────────────────────────────────────────────────────

function CategoryCard({
  category: c,
  isAdmin,
  onOpen,
  onEdit,
  onDelete,
}: {
  category: Category;
  isAdmin: boolean;
  onOpen: () => void;
  onEdit: (c: Category, e: React.MouseEvent) => void;
  onDelete: (c: Category, e: React.MouseEvent) => void;
}) {
  const count = c._count?.medicines ?? 0;
  return (
    <Card
      role="button"
      tabIndex={0}
      title={`Open ${c.name} in Medicine Master`}
      className="cursor-pointer transition hover:border-medflow-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-medflow-400"
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
    >
      <CardContent className="flex h-full flex-col p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="rounded-lg bg-medflow-50 p-2 text-medflow-600">
            <Tags className="h-5 w-5" />
          </div>
          {isAdmin && (
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                title="Edit category"
                className="rounded p-1 text-slate-300 transition hover:text-slate-600"
                onClick={(e) => onEdit(c, e)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Delete category"
                className="rounded p-1 text-slate-300 transition hover:text-red-500"
                onClick={(e) => onDelete(c, e)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
        <p className="mt-3 text-base font-semibold leading-snug text-slate-800">{c.name}</p>
        <p className="mt-1 text-sm font-medium text-medflow-600">
          {count} medicine{count !== 1 ? "s" : ""}
        </p>
        {c.description && (
          <p className="mt-2 line-clamp-2 text-sm text-slate-500">{c.description}</p>
        )}
        {(c.coldStorage || c.controlledDrug || c.requiresPrescription) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {c.coldStorage && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                <Thermometer className="h-3 w-3" /> Cold Storage
              </span>
            )}
            {c.controlledDrug && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-700">
                <Shield className="h-3 w-3" /> Controlled
              </span>
            )}
            {c.requiresPrescription && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                <FileText className="h-3 w-3" /> Rx Required
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Toggle helper ────────────────────────────────────────────────────────────

function ToggleField({
  label, value, onChange, description,
}: { label: string; value: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${value ? "bg-medflow-600" : "bg-slate-200"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-4" : "translate-x-0"}`}
        />
      </button>
      <div>
        <p className="text-sm font-medium text-slate-700">{label}</p>
        {description && <p className="text-sm text-slate-500">{description}</p>}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CategoriesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);
  const hasAccess = useRequirePermission("stockCategories");

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CatForm>(EMPTY_CAT);

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadCategories = () => {
    setLoading(true);
    api<Category[]>("/categories")
      .then((c) => { setCategories(c); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : "Failed to load categories"); setLoading(false); });
  };

  useEffect(() => { loadCategories(); }, []);

  const visible = useMemo(() => {
    let list = categories;
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q));
    if (activeFilter === "coldStorage") list = list.filter((c) => c.coldStorage);
    if (activeFilter === "controlledDrug") list = list.filter((c) => c.controlledDrug);
    if (activeFilter === "requiresPrescription") list = list.filter((c) => c.requiresPrescription);
    return list;
  }, [categories, query, activeFilter]);

  const openCategory = (c: Category) => router.push(`/medicines?category=${encodeURIComponent(c.id)}`);
  const resetForm = () => { setForm(EMPTY_CAT); setEditingId(null); setShowForm(false); };

  const startAdd = () => {
    setError(""); setSuccess("");
    setEditingId(null); setForm(EMPTY_CAT); setShowForm(true);
  };

  const startEdit = (c: Category, e: React.MouseEvent) => {
    e.stopPropagation();
    setError(""); setSuccess("");
    setEditingId(c.id);
    setForm({
      name: c.name,
      description: c.description ?? "",
      coldStorage: c.coldStorage,
      controlledDrug: c.controlledDrug,
      requiresPrescription: c.requiresPrescription,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return setError("Only administrators can manage categories.");
    setError(""); setSuccess("");
    if (!form.name.trim()) return setError("Category name is required");
    if (!/[A-Za-z]/.test(form.name)) return setError("Category name must be alphanumeric");
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      coldStorage: form.coldStorage,
      controlledDrug: form.controlledDrug,
      requiresPrescription: form.requiresPrescription,
    };
    try {
      await api(editingId ? `/categories/${editingId}` : "/categories", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setSuccess(editingId ? "Category updated" : `Category "${form.name}" created`);
      resetForm();
      loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category");
    }
  };

  const deleteCategory = async (c: Category, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isAdmin) return;
    if (!window.confirm(`Delete category "${c.name}"? It can be restored from Recovery.`)) return;
    try {
      await api(`/categories/${c.id}`, { method: "DELETE" });
      setSuccess(`Category "${c.name}" deleted`);
      loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete category");
    }
  };

  const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "coldStorage", label: "Cold Storage" },
    { key: "controlledDrug", label: "Controlled Drug" },
    { key: "requiresPrescription", label: "Rx Required" },
  ];

  if (!hasAccess) return null;

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stock Categories</h1>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? "Manage stock categories. Click a card to open its medicines." : "Browse categories. Click a card to open its medicines."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <>
              <Button variant="outline" size="sm" onClick={() => router.push("/settings/audit")}>
                <ScrollText className="mr-1.5 h-3.5 w-3.5" /> Audit Trail &amp; Restore
              </Button>
              <Button onClick={startAdd}>
                <Plus className="mr-2 h-4 w-4" /> Add Category
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      {/* ── Add/Edit form ── */}
      {showForm && isAdmin && (
        <Card>
          <CardHeader><CardTitle>{editingId ? "Edit Category" : "Add Category"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Category name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: sanitizeCategoryName(e.target.value) })}
                  placeholder="Category name"
                  required
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optional"
                />
              </div>

              {/* Flags */}
              <div className="space-y-3 rounded-lg border bg-slate-50/60 p-4 md:col-span-2">
                <p className="text-sm font-semibold uppercase tracking-wider text-slate-400">Storage &amp; Regulatory Flags</p>
                <ToggleField
                  label="Cold Storage Required"
                  value={form.coldStorage}
                  onChange={(v) => setForm({ ...form, coldStorage: v })}
                  description="Medicines in this category require refrigeration or cold chain."
                />
                <ToggleField
                  label="Controlled Drug"
                  value={form.controlledDrug}
                  onChange={(v) => setForm({ ...form, controlledDrug: v })}
                  description="Medicines are subject to controlled substance regulations."
                />
                <ToggleField
                  label="Requires Prescription"
                  value={form.requiresPrescription}
                  onChange={(v) => setForm({ ...form, requiresPrescription: v })}
                  description="Dispensing requires a valid prescription."
                />
              </div>

              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">{editingId ? "Update Category" : "Save Category"}</Button>
                <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* ── Search + Filter ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder=""
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5">
          {FILTER_OPTIONS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setActiveFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                activeFilter === f.key
                  ? "border-medflow-400 bg-medflow-50 text-medflow-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Cards ── */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-medflow-400 border-t-transparent" />
          Loading categories…
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center">
          <p className="text-sm text-muted-foreground">
            {query || activeFilter !== "all" ? "No categories match your search." : "No categories found."}
          </p>
          {isAdmin && !query && activeFilter === "all" && (
            <Button size="sm" className="mt-3" onClick={startAdd}>
              <Plus className="mr-2 h-4 w-4" /> Add Category
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {visible.map((c) => (
            <CategoryCard
              key={c.id}
              category={c}
              isAdmin={isAdmin}
              onOpen={() => openCategory(c)}
              onEdit={startEdit}
              onDelete={deleteCategory}
            />
          ))}
        </div>
      )}
    </div>
  );
}
