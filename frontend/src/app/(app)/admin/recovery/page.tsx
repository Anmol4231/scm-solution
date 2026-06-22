"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/api";
import { invalidateMedicinesCache } from "@/lib/medicines-cache";
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

interface DeletedFacility {
  id: string;
  name: string;
  code: string;
  facilityType?: string | null;
  province?: string | null;
  district?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

interface DeletedRole {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
}

interface DeletedWorker {
  id: string;
  workerId: string;
  firstName: string;
  lastName: string;
  department: string;
  role: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  facility?: { id: string; name: string } | null;
}

type TabKey = "medicines" | "categories" | "facilities" | "roles" | "staff";

export default function RecoveryPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const isAdmin = isMasterDataAdminRole(user?.role);

  const [activeTab, setActiveTab] = useState<TabKey>("medicines");
  const [deletedMedicines, setDeletedMedicines] = useState<DeletedMedicine[]>([]);
  const [deletedCategories, setDeletedCategories] = useState<DeletedCategory[]>([]);
  const [deletedFacilities, setDeletedFacilities] = useState<DeletedFacility[]>([]);
  const [deletedRoles, setDeletedRoles] = useState<DeletedRole[]>([]);
  const [deletedWorkers, setDeletedWorkers] = useState<DeletedWorker[]>([]);
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
      const [dm, dc, df, dr, dw] = await Promise.all([
        api<DeletedMedicine[]>("/medicines/deleted"),
        api<DeletedCategory[]>("/categories/deleted"),
        api<DeletedFacility[]>("/facilities/deleted"),
        api<DeletedRole[]>("/roles/deleted"),
        api<DeletedWorker[]>("/healthcare-workers/deleted"),
      ]);
      setDeletedMedicines(dm);
      setDeletedCategories(dc);
      setDeletedFacilities(df);
      setDeletedRoles(dr);
      setDeletedWorkers(dw);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recovery data");
    } finally {
      setDataLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) loadData();
  }, [isAdmin]);

  const restore = async (endpoint: string, id: string, name: string) => {
    if (!window.confirm(`Restore "${name}"? It will become active again.`)) return;
    setError("");
    setSuccess("");
    try {
      await api(`${endpoint}/${id}/restore`, { method: "POST" });
      setSuccess(`"${name}" restored successfully`);
      setExpanded(null);
      if (endpoint === "/medicines" || endpoint === "/categories") invalidateMedicinesCache();
      loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore record");
    }
  };

  if (!isAdmin) return null;

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: "medicines", label: "Medicines", count: deletedMedicines.length },
    { key: "categories", label: "Categories", count: deletedCategories.length },
    { key: "facilities", label: "Facilities", count: deletedFacilities.length },
    { key: "roles", label: "Roles", count: deletedRoles.length },
    { key: "staff", label: "Staff", count: deletedWorkers.length },
  ];

  const RestoreBtn = ({ label, onClick }: { label?: string; onClick: () => void }) =>
    label ? (
      <Button size="sm" variant="outline" onClick={onClick}>
        <RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> {label}
      </Button>
    ) : (
      <Button
        size="sm" variant="ghost"
        className="h-8 w-8 p-0 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600"
        title="Restore" aria-label="Restore"
        onClick={onClick}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
      </Button>
    );

  const ExpandBtn = ({ id }: { id: string }) => (
    <Button
      size="sm" variant="ghost"
      className="h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      title={expanded === id ? "Collapse details" : "Expand details"}
      aria-label={expanded === id ? "Collapse details" : "Expand details"}
      onClick={() => setExpanded(expanded === id ? null : id)}
    >
      {expanded === id
        ? <ChevronUp className="h-4 w-4" aria-hidden="true" />
        : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
    </Button>
  );

  const fmtDate = (d?: string | null) => d ? new Date(d).toLocaleString() : "—";

  return (
    <div className="space-y-5">
      <Link href="/admin" className="text-sm text-medflow-600 hover:underline">← Admin Dashboard</Link>
      <div>
        <h1 className="text-2xl font-bold">Archived Records</h1>
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
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> Deleted Medicines</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Medicine Name</th>
                <th className="p-3">Dosage Form</th>
                <th className="p-3">Strength</th>
                <th className="p-3">Category</th>
                <th className="p-3">Deleted By</th>
                <th className="p-3">Deleted Date</th>
                <th className="p-3">Actions</th>
              </tr></thead>
              <tbody>
                {deletedMedicines.map((m) => (
                  <>
                    <tr key={m.id} className="border-b hover:bg-slate-50/70">
                      <td className="p-3 font-medium">{m.medicineName}</td>
                      <td className="p-3 text-slate-600">{m.dosageForm || "—"}</td>
                      <td className="p-3 text-slate-600">{m.strength || "—"}</td>
                      <td className="p-3 text-slate-600">{m.category || "—"}</td>
                      <td className="p-3 text-slate-600">{m.deletedBy || "Unknown"}</td>
                      <td className="p-3 text-slate-600">{fmtDate(m.deletedAt)}</td>
                      <td className="p-3"><div className="flex flex-wrap gap-1">
                        <ExpandBtn id={m.id} />
                        <RestoreBtn onClick={() => restore("/medicines", m.id, m.medicineName)} />
                      </div></td>
                    </tr>
                    {expanded === m.id && (
                      <tr key={`${m.id}-d`} className="border-b bg-slate-50/60">
                        <td colSpan={7} className="px-4 py-3">
                          <div className="grid gap-2 text-sm sm:grid-cols-2">
                            <div><span className="font-medium text-slate-500">Medicine Name:</span> {m.medicineName}</div>
                            <div><span className="font-medium text-slate-500">Dosage Form:</span> {m.dosageForm || "—"}</div>
                            <div><span className="font-medium text-slate-500">Strength:</span> {m.strength || "—"}</div>
                            <div><span className="font-medium text-slate-500">Category:</span> {m.category || "—"}</div>
                            <div><span className="font-medium text-slate-500">Deleted By:</span> {m.deletedBy || "Unknown"}</div>
                            <div><span className="font-medium text-slate-500">Deleted Date:</span> {fmtDate(m.deletedAt)}</div>
                          </div>
                          <RestoreBtn label="Restore this medicine" onClick={() => restore("/medicines", m.id, m.medicineName)} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {deletedMedicines.length === 0 && <tr><td className="p-6 text-center text-muted-foreground" colSpan={7}>No deleted medicines.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

      ) : activeTab === "categories" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> Deleted Categories</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Category Name</th>
                <th className="p-3">Medicine Count</th>
                <th className="p-3">Deleted By</th>
                <th className="p-3">Deleted Date</th>
                <th className="p-3">Actions</th>
              </tr></thead>
              <tbody>
                {deletedCategories.map((c) => (
                  <>
                    <tr key={c.id} className="border-b hover:bg-slate-50/70">
                      <td className="p-3 font-medium">{c.name}</td>
                      <td className="p-3 text-slate-600">{c.linkedMedicines ?? 0} active</td>
                      <td className="p-3 text-slate-600">{c.deletedBy || "Unknown"}</td>
                      <td className="p-3 text-slate-600">{fmtDate(c.deletedAt)}</td>
                      <td className="p-3"><div className="flex flex-wrap gap-1">
                        <ExpandBtn id={c.id} />
                        <RestoreBtn onClick={() => restore("/categories", c.id, c.name)} />
                      </div></td>
                    </tr>
                    {expanded === c.id && (
                      <tr key={`${c.id}-d`} className="border-b bg-slate-50/60">
                        <td colSpan={5} className="px-4 py-3">
                          <div className="grid gap-2 text-sm sm:grid-cols-2">
                            <div><span className="font-medium text-slate-500">Category Name:</span> {c.name}</div>
                            <div><span className="font-medium text-slate-500">Active medicines:</span> {c.linkedMedicines ?? 0}</div>
                            {c.description && <div className="sm:col-span-2"><span className="font-medium text-slate-500">Description:</span> {c.description}</div>}
                            <div><span className="font-medium text-slate-500">Deleted By:</span> {c.deletedBy || "Unknown"}</div>
                            <div><span className="font-medium text-slate-500">Deleted Date:</span> {fmtDate(c.deletedAt)}</div>
                          </div>
                          <RestoreBtn label="Restore this category" onClick={() => restore("/categories", c.id, c.name)} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
                {deletedCategories.length === 0 && <tr><td className="p-6 text-center text-muted-foreground" colSpan={5}>No deleted categories.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

      ) : activeTab === "facilities" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> Deleted Facilities</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Name</th>
                <th className="p-3">Code</th>
                <th className="p-3">Type</th>
                <th className="p-3">Province / District</th>
                <th className="p-3">Deleted By</th>
                <th className="p-3">Deleted Date</th>
                <th className="p-3">Actions</th>
              </tr></thead>
              <tbody>
                {deletedFacilities.map((f) => (
                  <tr key={f.id} className="border-b hover:bg-slate-50/70">
                    <td className="p-3 font-medium">{f.name}</td>
                    <td className="p-3 text-slate-600">{f.code}</td>
                    <td className="p-3 text-slate-600">{f.facilityType || "—"}</td>
                    <td className="p-3 text-slate-600">{[f.province, f.district].filter(Boolean).join(" / ") || "—"}</td>
                    <td className="p-3 text-slate-600">{f.deletedBy || "Unknown"}</td>
                    <td className="p-3 text-slate-600">{fmtDate(f.deletedAt)}</td>
                    <td className="p-3"><RestoreBtn onClick={() => restore("/facilities", f.id, f.name)} /></td>
                  </tr>
                ))}
                {deletedFacilities.length === 0 && <tr><td className="p-6 text-center text-muted-foreground" colSpan={7}>No deleted facilities.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

      ) : activeTab === "roles" ? (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> Deleted Roles</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Name</th>
                <th className="p-3">Code</th>
                <th className="p-3">Description</th>
                <th className="p-3">Deleted By</th>
                <th className="p-3">Deleted Date</th>
                <th className="p-3">Actions</th>
              </tr></thead>
              <tbody>
                {deletedRoles.map((r) => (
                  <tr key={r.id} className="border-b hover:bg-slate-50/70">
                    <td className="p-3 font-medium">{r.name}</td>
                    <td className="p-3 text-slate-600">{r.code}</td>
                    <td className="p-3 text-slate-500">{r.description || "—"}</td>
                    <td className="p-3 text-slate-600">{r.deletedBy || "Unknown"}</td>
                    <td className="p-3 text-slate-600">{fmtDate(r.deletedAt)}</td>
                    <td className="p-3"><RestoreBtn onClick={() => restore("/roles", r.id, r.name)} /></td>
                  </tr>
                ))}
                {deletedRoles.length === 0 && <tr><td className="p-6 text-center text-muted-foreground" colSpan={6}>No deleted roles.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>

      ) : (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-500" /> Deleted Staff</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Name</th>
                <th className="p-3">Worker ID</th>
                <th className="p-3">Department</th>
                <th className="p-3">Facility</th>
                <th className="p-3">Deleted By</th>
                <th className="p-3">Deleted Date</th>
                <th className="p-3">Actions</th>
              </tr></thead>
              <tbody>
                {deletedWorkers.map((w) => (
                  <tr key={w.id} className="border-b hover:bg-slate-50/70">
                    <td className="p-3 font-medium">{w.firstName} {w.lastName}</td>
                    <td className="p-3 text-slate-600">{w.workerId}</td>
                    <td className="p-3 text-slate-600">{w.department}</td>
                    <td className="p-3 text-slate-600">{w.facility?.name || "—"}</td>
                    <td className="p-3 text-slate-600">{w.deletedBy || "Unknown"}</td>
                    <td className="p-3 text-slate-600">{fmtDate(w.deletedAt)}</td>
                    <td className="p-3"><RestoreBtn onClick={() => restore("/healthcare-workers", w.id, `${w.firstName} ${w.lastName}`)} /></td>
                  </tr>
                ))}
                {deletedWorkers.length === 0 && <tr><td className="p-6 text-center text-muted-foreground" colSpan={7}>No deleted staff members.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
