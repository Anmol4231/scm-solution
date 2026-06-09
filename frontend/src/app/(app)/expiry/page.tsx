"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Clock, PackageX, ChevronDown, ChevronUp, X, ArrowLeftRight, Eye, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Category { id: string; name: string }
interface ExpiryBatch {
  id: string; batchNumber: string; medicineId: string;
  daysUntilExpiry: number; severity: string; quantity: number; expiryDate: string;
  medicine: { medicineName: string; category?: { name: string } | null };
  facility?: { name: string };
}
interface ExpiryResponse {
  total: number;
  batches: ExpiryBatch[];
  categoryAnalytics?: { category: string; count: number; quantity: number; critical: number }[];
  facilityAnalytics?: { name: string; count: number; quantity: number }[];
  recommendations?: { medicineId: string; medicineName: string; batchNumber: string; facility: string; daysUntilExpiry: number; quantity: number; recommendation: string }[];
}
interface DisposalRecord { id: string; batchNumber: string; medicineName: string; quantity: number; disposalMethod: string; createdAt: string }

const WITHIN_OPTIONS = [
  { value: "30", label: "Within 30 days" },
  { value: "60", label: "Within 60 days" },
  { value: "90", label: "Within 90 days" },
  { value: "all", label: "All batches" },
];
const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "expired", label: "Expired" },
  { value: "critical", label: "Critical (≤30d)" },
  { value: "warning", label: "Warning (31–90d)" },
];
const DISPOSAL_METHODS = ["Incineration", "Landfill", "Return to Supplier", "Chemical Neutralization", "Other"];

function severityBadge(s: string) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";
  if (s === "expired") return `${base} bg-slate-200 text-slate-700`;
  if (s === "critical") return `${base} bg-red-100 text-red-700`;
  if (s === "warning") return `${base} bg-amber-100 text-amber-700`;
  return `${base} bg-green-100 text-green-700`;
}
function rowBg(s: string) {
  if (s === "expired") return "bg-slate-50/80";
  if (s === "critical") return "bg-red-50/30";
  if (s === "warning") return "bg-amber-50/30";
  return "";
}

// ─── Modal shell ──────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

// ─── Summary stat card ────────────────────────────────────────────────────────
function StatCard({ label, value, accent, icon: Icon }: { label: string; value: number; accent: string; icon: typeof PackageX }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${accent}`}>
      <Icon className="h-5 w-5 shrink-0 opacity-70" />
      <div>
        <p className="text-2xl font-bold leading-none">{value}</p>
        <p className="mt-0.5 text-sm font-medium opacity-75">{label}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ExpiryPage() {
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);
  const hasAccess = useRequirePermission("expiry");

  // Filter state
  const [withinDays, setWithinDays] = useState("90");
  const [categoryId, setCategoryId] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [status, setStatus] = useState("all");

  // Data
  const [data, setData] = useState<ExpiryResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);

  // Secondary panels
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<DisposalRecord[]>([]);

  // Modals
  const [recordModal, setRecordModal] = useState(false);
  const [disposeTarget, setDisposeTarget] = useState<ExpiryBatch | null>(null);

  // Record Expired form
  const emptyRecord = { medicineId: "", batchNumber: "", expiryDate: "", quantity: "", disposalMethod: "Incineration", notes: "", facilityId: user?.facilityId ?? "" };
  const [recordForm, setRecordForm] = useState(emptyRecord);
  const [recordError, setRecordError] = useState("");
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordSuccess, setRecordSuccess] = useState("");

  // Dispose form
  const [disposeForm, setDisposeForm] = useState({ disposalMethod: "Incineration", witness: "" });
  const [disposeError, setDisposeError] = useState("");
  const [disposeBusy, setDisposeBusy] = useState(false);
  const [disposeSuccess, setDisposeSuccess] = useState("");

  const loadAlerts = useCallback(() => {
    const params = new URLSearchParams();
    params.set("withinDays", withinDays);
    params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    if (facilityFilter) params.set("facilityFilter", facilityFilter);
    api<ExpiryResponse>(`/expiry/alerts?${params}`).then(setData).catch(console.error);
  }, [withinDays, categoryId, facilityFilter, status]);

  const loadHistory = () =>
    api<DisposalRecord[]>("/expiry/disposal-history").then(setHistory).catch(console.error);

  useEffect(() => {
    api<Category[]>("/categories").then(setCategories);
    api<{ id: string; medicineName: string }[]>("/medicines").then(setMedicines);
    if (isAdmin) api<{ id: string; name: string }[]>("/auth/facilities").then(setFacilities);
  }, [isAdmin]);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  // ── Record Expired submit ───────────────────────────────────────────────────
  const submitRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecordError(""); setRecordSuccess("");
    if (!recordForm.medicineId) return setRecordError("Please select a medicine");
    if (!recordForm.batchNumber.trim()) return setRecordError("Batch number is required");
    if (!recordForm.expiryDate) return setRecordError("Expiry date is required");
    const qty = Number(recordForm.quantity);
    if (!recordForm.quantity || isNaN(qty) || qty <= 0) return setRecordError("Quantity must be greater than 0");
    if (!recordForm.disposalMethod) return setRecordError("Disposal method is required");
    if (isAdmin && !recordForm.facilityId) return setRecordError("Please select a facility");

    setRecordBusy(true);
    try {
      await api("/expiry/record-expired", {
        method: "POST",
        body: JSON.stringify({
          medicineId: recordForm.medicineId,
          batchNumber: recordForm.batchNumber.trim(),
          expiryDate: recordForm.expiryDate,
          quantity: qty,
          disposalMethod: recordForm.disposalMethod,
          disposalWitness: recordForm.notes.trim() || undefined,
          ...(isAdmin && recordForm.facilityId ? { facilityId: recordForm.facilityId } : {}),
        }),
      });
      setRecordSuccess("Expired stock recorded successfully.");
      setRecordForm(emptyRecord);
      loadAlerts();
      if (showHistory) loadHistory();
      setTimeout(() => { setRecordModal(false); setRecordSuccess(""); }, 1500);
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : "Failed to record expired stock");
    } finally {
      setRecordBusy(false);
    }
  };

  // ── Dispose Off submit ─────────────────────────────────────────────────────
  const submitDispose = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!disposeTarget) return;
    setDisposeError(""); setDisposeSuccess("");
    if (!disposeForm.disposalMethod) return setDisposeError("Disposal method is required");

    setDisposeBusy(true);
    try {
      await api("/expiry/record-expired", {
        method: "POST",
        body: JSON.stringify({
          medicineId: disposeTarget.medicineId,
          batchNumber: disposeTarget.batchNumber,
          expiryDate: disposeTarget.expiryDate,
          quantity: disposeTarget.quantity,
          disposalMethod: disposeForm.disposalMethod,
          disposalWitness: disposeForm.witness || undefined,
        }),
      });
      setDisposeSuccess(`Disposed ${disposeTarget.quantity} units of ${disposeTarget.medicine?.medicineName}.`);
      loadAlerts();
      if (showHistory) loadHistory();
      setTimeout(() => { setDisposeTarget(null); setDisposeSuccess(""); }, 1800);
    } catch (err) {
      setDisposeError(err instanceof Error ? err.message : "Failed to process disposal");
    } finally {
      setDisposeBusy(false);
    }
  };

  const batches = data?.batches ?? [];
  const expiredCount = batches.filter((b) => b.severity === "expired").length;
  const criticalCount = batches.filter((b) => b.severity === "critical").length;
  const warningCount = batches.filter((b) => b.severity === "warning").length;

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-0.5 text-2xl font-bold">Expiry Management</h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadHistory(); }}>
            Disposal History
          </Button>
          <Button size="sm" onClick={() => { setRecordForm({ ...emptyRecord, facilityId: user?.facilityId ?? "" }); setRecordError(""); setRecordSuccess(""); setRecordModal(true); }}>
            Record Expired Stock
          </Button>
        </div>
      </div>

      {/* ── Filters ── */}
      <Card>
        <CardContent className="flex flex-wrap gap-2 py-3 px-4">
          <div className="min-w-[130px] flex-1">
            <Label className="text-[11px] uppercase tracking-wide text-slate-400">Window</Label>
            <select className="mt-1 h-9 w-full rounded-lg border bg-white px-2 text-sm" value={withinDays} onChange={(e) => setWithinDays(e.target.value)}>
              {WITHIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="min-w-[130px] flex-1">
            <Label className="text-[11px] uppercase tracking-wide text-slate-400">Category</Label>
            <select className="mt-1 h-9 w-full rounded-lg border bg-white px-2 text-sm" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="min-w-[130px] flex-1">
            <Label className="text-[11px] uppercase tracking-wide text-slate-400">Status</Label>
            <select className="mt-1 h-9 w-full rounded-lg border bg-white px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {isAdmin && facilities.length > 0 && (
            <div className="min-w-[130px] flex-1">
              <Label className="text-[11px] uppercase tracking-wide text-slate-400">Facility</Label>
              <select className="mt-1 h-9 w-full rounded-lg border bg-white px-2 text-sm" value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)}>
                <option value="">All facilities</option>
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Summary cards ── */}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Total batches" value={data.total} accent="border-slate-200 bg-white text-slate-700" icon={PackageX} />
          <StatCard label="Expired" value={expiredCount} accent="border-slate-300 bg-slate-50 text-slate-700" icon={PackageX} />
          <StatCard label="Critical (≤30d)" value={criticalCount} accent="border-red-200 bg-red-50 text-red-700" icon={AlertTriangle} />
          <StatCard label="Warning (31–90d)" value={warningCount} accent="border-amber-200 bg-amber-50 text-amber-700" icon={Clock} />
        </div>
      )}

      {/* ── Primary: Expiry table ── */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {batches.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <Clock className="mx-auto mb-3 h-10 w-10 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No batches match the current filters</p>
              <p className="mt-1 text-sm text-slate-400">Try widening the expiry window or changing the status filter</p>
            </div>
          ) : (
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-sm font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Medicine</th>
                  <th className="px-4 py-3">Batch</th>
                  <th className="px-4 py-3">Expiry</th>
                  <th className="px-4 py-3">Days</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Status</th>
                  {isAdmin && <th className="px-4 py-3">Facility</th>}
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className={`border-b last:border-0 transition-colors ${rowBg(batch.severity)} hover:brightness-95`}>
                    <td className="px-4 py-3">
                      <span className="font-medium text-slate-800">{batch.medicine?.medicineName}</span>
                      {batch.medicine?.category && (
                        <span className="mt-0.5 block text-sm text-slate-400">{batch.medicine.category.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm text-slate-600">{batch.batchNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{new Date(batch.expiryDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {batch.daysUntilExpiry < 0
                        ? <span className="font-medium text-slate-500">—</span>
                        : <span className={batch.daysUntilExpiry <= 30 ? "font-bold text-red-600" : "font-medium text-amber-700"}>{batch.daysUntilExpiry}d</span>
                      }
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-700">{batch.quantity}</td>
                    <td className="px-4 py-3"><span className={severityBadge(batch.severity)}>{batch.severity}</span></td>
                    {isAdmin && <td className="px-4 py-3 text-sm text-slate-500">{batch.facility?.name ?? "—"}</td>}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-slate-500 hover:text-slate-700" title="View medicine">
                          <Link href={`/medicines/${batch.medicineId}`}><Eye className="h-3.5 w-3.5" /></Link>
                        </Button>
                        {(batch.severity === "critical" || batch.severity === "warning") && (
                          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-medflow-600 hover:text-medflow-800" title="Transfer batch">
                            <Link href={`/transfers/send?medicineId=${batch.medicineId}`}><ArrowLeftRight className="h-3.5 w-3.5" /></Link>
                          </Button>
                        )}
                        {batch.severity === "expired" && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-red-200 px-2 text-red-700 hover:bg-red-50"
                            title="Dispose off"
                            onClick={() => {
                              setDisposeTarget(batch);
                              setDisposeForm({ disposalMethod: "Incineration", witness: "" });
                              setDisposeError(""); setDisposeSuccess("");
                            }}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" /> Dispose
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── Redistribution Recommendations (collapsible) ── */}
      {data?.recommendations && data.recommendations.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/40">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-amber-800"
            onClick={() => setShowRecommendations(!showRecommendations)}
          >
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Redistribution Recommendations
              <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[11px] font-semibold">{data.recommendations.length}</span>
            </span>
            {showRecommendations ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showRecommendations && (
            <div className="border-t border-amber-200 px-4 pb-3 pt-2 space-y-1.5">
              {data.recommendations.map((r, i) => (
                <p key={i} className="text-sm text-amber-900">
                  <Link href={`/medicines/${r.medicineId}`} className="font-medium hover:underline">{r.medicineName}</Link>
                  <span className="text-amber-700"> · {r.batchNumber}, {r.facility} — {r.recommendation}</span>
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Analytics (collapsible) ── */}
      {(data?.categoryAnalytics?.length || data?.facilityAnalytics?.length) ? (
        <div className="rounded-xl border">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-slate-700"
            onClick={() => setShowAnalytics(!showAnalytics)}
          >
            <span>Analytics</span>
            {showAnalytics ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
          </button>
          {showAnalytics && (
            <div className="border-t p-4">
              <div className="grid gap-4 md:grid-cols-2">
                {data?.categoryAnalytics && data.categoryAnalytics.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">By Category</p>
                    <div className="space-y-1.5 text-sm">
                      {data.categoryAnalytics.map((c) => (
                        <div key={c.category} className="flex justify-between border-b pb-1.5 last:border-0">
                          <span className="text-slate-700">{c.category}</span>
                          <span className="text-slate-500">{c.count} batch{c.count !== 1 ? "es" : ""} · <span className="text-red-600">{c.critical} critical</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data?.facilityAnalytics && data.facilityAnalytics.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">By Facility</p>
                    <div className="space-y-1.5 text-sm">
                      {data.facilityAnalytics.map((f) => (
                        <div key={f.name} className="flex justify-between border-b pb-1.5 last:border-0">
                          <span className="text-slate-700">{f.name}</span>
                          <span className="text-slate-500">{f.count} batch{f.count !== 1 ? "es" : ""} · qty {f.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Disposal History (collapsible) ── */}
      {showHistory && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Disposal History</CardTitle>
              <button type="button" onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-500">No disposal records yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-slate-50 text-left text-sm font-semibold uppercase tracking-wide text-slate-500">
                      <th className="px-4 py-2">Medicine</th>
                      <th className="px-4 py-2">Batch</th>
                      <th className="px-4 py-2">Qty</th>
                      <th className="px-4 py-2">Method</th>
                      <th className="px-4 py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b last:border-0 hover:bg-slate-50/60">
                        <td className="px-4 py-2.5 font-medium text-slate-800">{h.medicineName}</td>
                        <td className="px-4 py-2.5 font-mono text-sm text-slate-600">{h.batchNumber}</td>
                        <td className="px-4 py-2.5 text-slate-600">{h.quantity}</td>
                        <td className="px-4 py-2.5 text-slate-600">{h.disposalMethod}</td>
                        <td className="px-4 py-2.5 text-slate-500">{new Date(h.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Modal: Record Expired Stock ── */}
      {recordModal && (
        <Modal title="Record Expired Stock" onClose={() => setRecordModal(false)}>
          {recordSuccess ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-sm font-medium text-slate-800">{recordSuccess}</p>
            </div>
          ) : (
            <form onSubmit={submitRecord} className="space-y-3">
              {recordError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{recordError}</p>}

              {isAdmin && (
                <div>
                  <Label>Facility <span className="text-red-500">*</span></Label>
                  <select className="mt-1 h-9 w-full rounded-lg border px-3 text-sm" value={recordForm.facilityId} onChange={(e) => setRecordForm({ ...recordForm, facilityId: e.target.value })} required>
                    <option value="">Select facility</option>
                    {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <Label>Medicine <span className="text-red-500">*</span></Label>
                <MedicineCombobox
                  medicines={medicines}
                  value={recordForm.medicineId}
                  onChange={(id) => setRecordForm({ ...recordForm, medicineId: id })}
                  className="mt-1 h-9"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Batch number <span className="text-red-500">*</span></Label>
                  <Input className="mt-1 h-9" value={recordForm.batchNumber} onChange={(e) => setRecordForm({ ...recordForm, batchNumber: e.target.value })} required />
                </div>
                <div>
                  <Label>Quantity <span className="text-red-500">*</span></Label>
                  <Input className="mt-1 h-9" type="number" min="1" placeholder="0" value={recordForm.quantity} onChange={(e) => setRecordForm({ ...recordForm, quantity: e.target.value })} required />
                </div>
              </div>

              <div>
                <Label>Expiry date <span className="text-red-500">*</span></Label>
                <Input className="mt-1 h-9" type="date" value={recordForm.expiryDate} onChange={(e) => setRecordForm({ ...recordForm, expiryDate: e.target.value })} required />
              </div>

              <div>
                <Label>Disposal method <span className="text-red-500">*</span></Label>
                <select className="mt-1 h-9 w-full rounded-lg border px-3 text-sm" value={recordForm.disposalMethod} onChange={(e) => setRecordForm({ ...recordForm, disposalMethod: e.target.value })} required>
                  {DISPOSAL_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <Label>Notes / Witness</Label>
                <Input className="mt-1 h-9" value={recordForm.notes} onChange={(e) => setRecordForm({ ...recordForm, notes: e.target.value })} placeholder="Witness name or notes" />
              </div>

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={recordBusy} className="flex-1">{recordBusy ? "Saving…" : "Record Expired Stock"}</Button>
                <Button type="button" variant="outline" onClick={() => setRecordModal(false)}>Cancel</Button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* ── Modal: Dispose Off confirmation ── */}
      {disposeTarget && (
        <Modal title="Confirm Disposal" onClose={() => { setDisposeTarget(null); setDisposeSuccess(""); }}>
          {disposeSuccess ? (
            <div className="py-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <svg className="h-6 w-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="text-sm font-medium text-slate-800">{disposeSuccess}</p>
            </div>
          ) : (
            <form onSubmit={submitDispose} className="space-y-3">
              <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
                <p className="font-medium text-slate-800">{disposeTarget.medicine?.medicineName}</p>
                <p className="mt-0.5 text-slate-500">Batch {disposeTarget.batchNumber} · {disposeTarget.quantity} units · Expired {new Date(disposeTarget.expiryDate).toLocaleDateString()}</p>
              </div>

              {disposeError && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{disposeError}</p>}

              <div>
                <Label>Disposal method <span className="text-red-500">*</span></Label>
                <select className="mt-1 h-9 w-full rounded-lg border px-3 text-sm" value={disposeForm.disposalMethod} onChange={(e) => setDisposeForm({ ...disposeForm, disposalMethod: e.target.value })} required>
                  {DISPOSAL_METHODS.map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <Label>Witness / Authorized by</Label>
                <Input className="mt-1 h-9" value={disposeForm.witness} placeholder="Witness name" onChange={(e) => setDisposeForm({ ...disposeForm, witness: e.target.value })} />
              </div>

              <p className="text-sm text-slate-500">
                This will reduce stock by <strong>{disposeTarget.quantity}</strong> units and create an audit entry.
              </p>

              <div className="flex gap-2 pt-1">
                <Button type="submit" disabled={disposeBusy} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
                  {disposeBusy ? "Processing…" : "Confirm Dispose Off"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setDisposeTarget(null)}>Cancel</Button>
              </div>
            </form>
          )}
        </Modal>
      )}
    </div>
  );
}
