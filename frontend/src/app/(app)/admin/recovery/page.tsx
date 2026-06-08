"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface DeletedMedicine {
  id: string;
  medicineName: string;
  genericName?: string | null;
  dosageForm?: string | null;
  strength?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  category?: string | null;
}

interface DeletedCategory {
  id: string;
  name: string;
  description?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  linkedMedicines?: number;
}

type TabKey = "medicines" | "categories";

export default function RecoveryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const isAdmin = isMasterDataAdminRole(user?.role);

  const [activeTab, setActiveTab] = useState<TabKey>("medicines");
  const [deletedMedicines, setDeletedMedicines] = useState<DeletedMedicine[]>([]);
  const [deletedCategories, setDeletedCategories] = useState<DeletedCategory[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/medicines");
  }, [isAdmin, loading, router]);

  const loadData = async () => {
    setDataLoading(true);
    setError("");
    try {
      const [dm, dc] = await Promise.all([
        api<DeletedMedicine[]>("/medicines/deleted"),
        api<DeletedCategory[]>("/categories/deleted"),
      ]);
      setDeletedMedicines(dm);
      setDeletedCategories(dc);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recovery data");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin]);

  const restore = async (type: "medicine" | "category", id: string, name: string) => {
    if (!window.confirm(`Restore "${name}"? It will become active again.`)) return;
    setError("");
    setSuccess("");
    try {
      const endpoint = type === "medicine" ? `/medicines/${id}/restore` : `/categories/${id}/restore`;
      await api(endpoint, { method: "POST" });
      setSuccess(`"${name}" restored successfully`);
      setExpanded(null);
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore record");
    }
  };

  if (!isAdmin) return null;

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "medicines", label: "Deleted Medicines", count: deletedMedicines.length },
    { key: "categories", label: "Deleted Categories", count: deletedCategories.length },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Recovery</h1>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      <div className="flex gap-1 overflow-x-auto border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === t.key
                ? "border-medflow-600 text-medflow-700"
                : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
            onClick={() => { setActiveTab(t.key); setExpanded(null); }}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-sm font-normal text-slate-600">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {dataLoading ? (
        <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Loading…</CardContent></Card>

      ) : activeTab === "medicines" ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Deleted Medicines
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <th className="p-3">Medicine Name</th>
                  <th className="p-3">Dosage Form</th>
                  <th className="p-3">Strength</th>
                  <th className="p-3">Category</th>
                  <th className="p-3">Deleted By</th>
                  <th className="p-3">Deleted Date</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deletedMedicines.map((m) => (
                  <>
                    <tr key={m.id} className="border-b hover:bg-slate-50/70">
                      <td className="p-3 font-medium">{m.medicineName}</td>
                      <td className="p-3 text-slate-600">{m.dosageForm || "—"}</td>
                      <td className="p-3 text-slate-600">{m.strength || "—"}</td>
                      <td className="p-3 text-slate-600">{m.category || "—"}</td>
                      <td className="p-3 text-slate-600">{m.deletedBy || "Unknown"}</td>
                      <td className="p-3 text-slate-600">{m.deletedAt ? new Date(m.deletedAt).toLocaleString() : "—"}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                          >
                            {expanded === m.id ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                            Details
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => restore("medicine", m.id, m.medicineName)}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded === m.id && (
                      <tr key={`${m.id}-detail`} className="border-b bg-slate-50/60">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="grid gap-2 text-sm sm:grid-cols-2">
                            <div><span className="font-medium text-slate-500">Medicine Name:</span> {m.medicineName}</div>
                            <div><span className="font-medium text-slate-500">Dosage Form:</span> {m.dosageForm || "—"}</div>
                            <div><span className="font-medium text-slate-500">Strength:</span> {m.strength || "—"}</div>
                            <div><span className="font-medium text-slate-500">Category:</span> {m.category || "—"}</div>
                            <div><span className="font-medium text-slate-500">Deleted By:</span> {m.deletedBy || "Unknown"}</div>
                            <div><span className="font-medium text-slate-500">Deleted Date:</span> {m.deletedAt ? new Date(m.deletedAt).toLocaleString() : "—"}</div>
                          </div>
                          <Button
                            size="sm"
                            className="mt-3"
                            onClick={() => restore("medicine", m.id, m.medicineName)}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore this medicine
                          </Button>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {deletedMedicines.length === 0 && (
                  <tr><td className="p-6 text-center text-muted-foreground" colSpan={7}>No deleted medicines.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" /> Deleted Categories
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left">
                  <th className="p-3">Category Name</th>
                  <th className="p-3">Medicine Count</th>
                  <th className="p-3">Deleted By</th>
                  <th className="p-3">Deleted Date</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {deletedCategories.map((c) => (
                  <>
                    <tr key={c.id} className="border-b hover:bg-slate-50/70">
                      <td className="p-3 font-medium">{c.name}</td>
                      <td className="p-3 text-slate-600">{c.linkedMedicines ?? 0} active</td>
                      <td className="p-3 text-slate-600">{c.deletedBy || "Unknown"}</td>
                      <td className="p-3 text-slate-600">{c.deletedAt ? new Date(c.deletedAt).toLocaleString() : "—"}</td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                          >
                            {expanded === c.id ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
                            Details
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => restore("category", c.id, c.name)}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {expanded === c.id && (
                      <tr key={`${c.id}-detail`} className="border-b bg-slate-50/60">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="grid gap-2 text-sm sm:grid-cols-2">
                            <div><span className="font-medium text-slate-500">Category Name:</span> {c.name}</div>
                            <div><span className="font-medium text-slate-500">Active medicines:</span> {c.linkedMedicines ?? 0}</div>
                            {c.description && <div className="sm:col-span-2"><span className="font-medium text-slate-500">Description:</span> {c.description}</div>}
                            <div><span className="font-medium text-slate-500">Deleted By:</span> {c.deletedBy || "Unknown"}</div>
                            <div><span className="font-medium text-slate-500">Deleted Date:</span> {c.deletedAt ? new Date(c.deletedAt).toLocaleString() : "—"}</div>
                          </div>
                          <Button
                            size="sm"
                            className="mt-3"
                            onClick={() => restore("category", c.id, c.name)}
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Restore this category
                          </Button>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {deletedCategories.length === 0 && (
                  <tr><td className="p-6 text-center text-muted-foreground" colSpan={5}>No deleted categories.</td></tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
