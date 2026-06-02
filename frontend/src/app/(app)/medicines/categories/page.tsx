"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, Pencil, Plus, Trash2 } from "lucide-react";
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
  isActive?: boolean;
  _count?: { medicines: number };
}

const emptyCategoryForm = { name: "", description: "" };

function nav(isAdmin: boolean) {
  const items: { href: string; label: string }[] = [
    { href: "/medicines", label: "Medicine Master" },
    { href: "/medicines/categories", label: "Categories" },
  ];
  if (isAdmin) items.push({ href: "/medicines/recent-changes", label: "Recent Changes" });
  return items;
}

export default function CategoriesPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [categoryForm, setCategoryForm] = useState(emptyCategoryForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const loadCategories = () => api<Category[]>("/categories").then(setCategories);

  useEffect(() => {
    if (!loading && !isAdmin) {
      router.replace("/medicines");
      return;
    }
    if (isAdmin) loadCategories();
  }, [isAdmin, loading, router]);

  const selected = useMemo(
    () => categories.find((c) => c.id === selectedId) ?? null,
    [categories, selectedId]
  );

  const startAddCategory = () => {
    setError("");
    setSuccess("");
    setEditingCategoryId(null);
    setCategoryForm(emptyCategoryForm);
    setShowCategoryForm(true);
  };

  const startEditCategory = (category: Category) => {
    setError("");
    setSuccess("");
    setEditingCategoryId(category.id);
    setShowCategoryForm(true);
    setCategoryForm({ name: category.name, description: category.description ?? "" });
  };

  const submitCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return setError("Only administrators can manage categories.");
    setError("");
    try {
      await api(editingCategoryId ? `/categories/${editingCategoryId}` : "/categories", {
        method: editingCategoryId ? "PATCH" : "POST",
        body: JSON.stringify(categoryForm),
      });
      setSuccess(editingCategoryId ? "Category updated" : `Category "${categoryForm.name}" created`);
      setCategoryForm(emptyCategoryForm);
      setEditingCategoryId(null);
      setShowCategoryForm(false);
      loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save category");
    }
  };

  const deleteCategory = async (category: Category) => {
    if (!isAdmin) return;
    if (!window.confirm(`Delete ${category.name}? It can be restored from Recent Changes.`)) return;
    try {
      await api(`/categories/${category.id}`, { method: "DELETE" });
      setSuccess("Category deleted");
      setSelectedId(null);
      loadCategories();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete category");
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Categories</h1>
          <p className="text-sm text-muted-foreground">Reference categories used by medicine master records.</p>
        </div>
        {isAdmin && (
          <Button size="lg" onClick={startAddCategory}>
            <Plus className="mr-2 h-4 w-4" /> Add Category
          </Button>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto border-b">
        {nav(isAdmin).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap border-b-2 px-2 py-2 text-sm font-medium ${
              item.href === "/medicines/categories"
                ? "border-medflow-600 text-medflow-700"
                : "border-transparent text-slate-600"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      {showCategoryForm && isAdmin && (
        <Card>
          <CardHeader><CardTitle>{editingCategoryId ? "Edit Category" : "Add Category"}</CardTitle></CardHeader>
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
              <div className="flex gap-2 md:col-span-2">
                <Button type="submit">{editingCategoryId ? "Update Category" : "Save Category"}</Button>
                <Button type="button" variant="outline" onClick={() => { setShowCategoryForm(false); setEditingCategoryId(null); }}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader><CardTitle className="text-base">Category List</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <th className="p-3">Category Name</th>
                  <th className="p-3">Medicine Count</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => (
                  <tr key={c.id} className="border-b hover:bg-slate-50/70">
                    <td className="p-3 font-medium">{c.name}</td>
                    <td className="p-3 text-slate-600">{c._count?.medicines ?? 0}</td>
                    <td className="p-3">
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Active</span>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => setSelectedId(c.id)}>
                          <Eye className="mr-1 h-3.5 w-3.5" /> View
                        </Button>
                        {isAdmin && (
                          <Button type="button" size="sm" variant="outline" onClick={() => startEditCategory(c)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {categories.length === 0 && (
                  <tr>
                    <td className="p-6 text-center text-muted-foreground" colSpan={4}>No categories found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Category Details</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {selected ? (
              <>
                <div>
                  <p className="text-xs text-muted-foreground">Category Name</p>
                  <p className="font-semibold">{selected.name}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Medicine Count</p>
                  <p className="font-semibold">{selected._count?.medicines ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p>{selected.description || "No description recorded."}</p>
                </div>
                {isAdmin && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => startEditCategory(selected)}>
                      <Pencil className="mr-1 h-4 w-4" /> Edit
                    </Button>
                    <Button type="button" variant="destructive" onClick={() => deleteCategory(selected)}>
                      <Trash2 className="mr-1 h-4 w-4" /> Delete
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-muted-foreground">Select a category to view details.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
