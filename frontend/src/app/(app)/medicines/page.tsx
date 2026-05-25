"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
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

interface Medicine {
  id: string;
  medicineName: string;
  genericName?: string | null;
  dosageForm?: string | null;
  strength?: string | null;
  unitType: string;
  reorderThreshold: number;
  categoryId?: string | null;
  category?: Category | null;
}

const emptyForm = {
  medicineName: "",
  genericName: "",
  dosageForm: "",
  strength: "",
  unitType: "tablets",
  reorderThreshold: 50,
  categoryId: "",
};

const emptyCategoryForm = { name: "", description: "" };

export default function MedicinesPage() {
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [q, setQ] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadCategories = () => api<Category[]>("/categories").then(setCategories);

  const load = (search = q, cat = categoryFilter) => {
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
    load(q, categoryFilter);
  }, [categoryFilter]);

  const search = (e: React.FormEvent) => {
    e.preventDefault();
    load(q, categoryFilter);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!form.categoryId) {
      setError("Please select a category");
      return;
    }
    try {
      await api("/medicines", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          reorderThreshold: Number(form.reorderThreshold),
        }),
      });
      setSuccess(`Added ${form.medicineName}`);
      setForm(emptyForm);
      setShowForm(false);
      loadCategories();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add medicine");
    }
  };

  const submitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await api("/categories", {
        method: "POST",
        body: JSON.stringify(categoryForm),
      });
      setSuccess(`Category "${categoryForm.name}" created`);
      setCategoryForm(emptyCategoryForm);
      setShowCategoryForm(false);
      loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add category");
    }
  };

  const grouped = categories
    .map((cat) => ({
      category: cat,
      items: medicines.filter((m) => m.categoryId === cat.id),
    }))
    .filter((g) => g.items.length > 0);

  const uncategorized = medicines.filter((m) => !m.categoryId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Medicine Master</h1>
        <div className="flex flex-wrap gap-2">
          <Button size="lg" variant="outline" onClick={() => setShowCategoryForm(!showCategoryForm)}>
            {showCategoryForm ? "Cancel" : "+ Category"}
          </Button>
          <Button size="lg" onClick={() => setShowForm(!showForm)}>
            {showForm ? "Cancel" : "+ Medicine"}
          </Button>
        </div>
      </div>

      {showCategoryForm && (
        <Card>
          <CardHeader><CardTitle>Add Category</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submitCategory} className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Category name *</Label>
                <Input
                  value={categoryForm.name}
                  onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                  placeholder="e.g. Antibiotics"
                  required
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={categoryForm.description}
                  onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                />
              </div>
              <Button type="submit" className="md:col-span-2">Save Category</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <form onSubmit={search} className="flex flex-1 gap-2 min-w-[200px]">
          <Input
            placeholder="Search medicines..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1"
          />
          <Button type="submit">Search</Button>
        </form>
        <select
          className="h-11 rounded-lg border px-3"
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

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>Add New Medicine</CardTitle>
          </CardHeader>
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
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <Label>Medicine name *</Label>
                <Input
                  value={form.medicineName}
                  onChange={(e) => setForm({ ...form, medicineName: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Generic name</Label>
                <Input value={form.genericName} onChange={(e) => setForm({ ...form, genericName: e.target.value })} />
              </div>
              <div>
                <Label>Strength</Label>
                <Input value={form.strength} onChange={(e) => setForm({ ...form, strength: e.target.value })} />
              </div>
              <div>
                <Label>Dosage form</Label>
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
                </select>
              </div>
              <div>
                <Label>Unit type</Label>
                <select
                  className="h-11 w-full rounded-lg border px-3"
                  value={form.unitType}
                  onChange={(e) => setForm({ ...form, unitType: e.target.value })}
                >
                  <option>tablets</option>
                  <option>capsules</option>
                  <option>sachets</option>
                  <option>inhalers</option>
                </select>
              </div>
              <div>
                <Label>Low stock threshold</Label>
                <Input
                  type="number"
                  min={0}
                  value={form.reorderThreshold}
                  onChange={(e) => setForm({ ...form, reorderThreshold: +e.target.value })}
                />
              </div>
              {error && <p className="text-sm text-destructive md:col-span-2">{error}</p>}
              <Button type="submit" size="lg" className="md:col-span-2">Save Medicine</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((c) => (
          <Card
            key={c.id}
            className={`cursor-pointer transition ${categoryFilter === c.id ? "border-medflow-500 ring-2 ring-medflow-200" : ""}`}
            onClick={() => setCategoryFilter(categoryFilter === c.id ? "" : c.id)}
          >
            <CardContent className="p-3">
              <p className="font-medium text-sm">{c.name}</p>
              <p className="text-xs text-muted-foreground">{c._count?.medicines ?? 0} medicines</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-sm text-muted-foreground">{medicines.length} medicines shown</p>

      {categoryFilter ? (
        <div className="space-y-2">
          {medicines.map((m) => (
            <MedicineCard key={m.id} medicine={m} />
          ))}
        </div>
      ) : (
        <>
          {grouped.map(({ category, items }) => (
            <div key={category.id}>
              <h2 className="mb-2 text-lg font-semibold text-medflow-700">{category.name}</h2>
              <div className="space-y-2">
                {items.map((m) => (
                  <MedicineCard key={m.id} medicine={m} />
                ))}
              </div>
            </div>
          ))}
          {uncategorized.length > 0 && (
            <div>
              <h2 className="mb-2 text-lg font-semibold text-muted-foreground">Uncategorized</h2>
              <div className="space-y-2">
                {uncategorized.map((m) => (
                  <MedicineCard key={m.id} medicine={m} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MedicineCard({ medicine: m }: { medicine: Medicine }) {
  return (
    <Link href={`/medicines/${m.id}`}>
    <Card className="transition hover:border-medflow-300 hover:shadow-sm cursor-pointer">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold">{m.medicineName}</p>
          {m.category && (
            <span className="shrink-0 rounded-full bg-medflow-50 px-2 py-0.5 text-xs font-medium text-medflow-700">
              {m.category.name}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {m.genericName && `${m.genericName} · `}
          {m.dosageForm && `${m.dosageForm} `}
          {m.strength && `${m.strength} · `}
          Unit: {m.unitType} · Reorder at: {m.reorderThreshold}
        </p>
        <span className="mt-2 inline-block text-xs text-medflow-600">View details →</span>
      </CardContent>
    </Card>
    </Link>
  );
}
