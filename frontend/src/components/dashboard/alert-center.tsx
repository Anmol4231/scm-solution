"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, Eye, PackageX, CalendarClock, Search, Plus, Pencil, PlayCircle } from "lucide-react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Alert {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  medicineId?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  facility?: { id: string; name: string; code: string } | null;
  acknowledgedBy?: { firstName: string; lastName: string } | null;
}

interface AlertsResponse {
  alerts: Alert[];
  counts: { lowStock: number; expiry: number; resolved: number };
}

type Tab = "low_stock" | "expiry" | "resolved";
type Range = "today" | "7" | "30" | "90" | "custom";

const TABS: { key: Tab; label: string; icon: typeof PackageX }[] = [
  { key: "low_stock", label: "Low Stock", icon: PackageX },
  { key: "expiry", label: "Expiry", icon: CalendarClock },
  { key: "resolved", label: "Resolved", icon: CheckCircle2 },
];

const RANGES: { key: Range; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7", label: "7 Days" },
  { key: "30", label: "30 Days" },
  { key: "90", label: "90 Days" },
  { key: "custom", label: "Custom" },
];

function rangeToDates(range: Range, customFrom: string, customTo: string): { from?: string; to?: string } {
  if (range === "custom") {
    return { from: customFrom || undefined, to: customTo ? `${customTo}T23:59:59` : undefined };
  }
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { from: d.toISOString() };
  }
  const days = Number(range);
  return { from: new Date(Date.now() - days * 86400000).toISOString() };
}

function severityClass(severity: string) {
  if (severity === "CRITICAL") return "bg-red-100 text-red-700";
  if (severity === "WARNING") return "bg-amber-100 text-amber-800";
  return "bg-blue-100 text-blue-700";
}

const ALERT_TYPES = ["LOW_STOCK", "STOCKOUT", "SHORTFALL", "EXPIRY_WARNING", "EXPIRY_CRITICAL", "NON_REPORTING", "DISPENSING_SPIKE", "TRANSFER_PENDING"] as const;
const SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;

interface AlertForm {
  type: string;
  severity: string;
  title: string;
  message: string;
}

const EMPTY_ALERT_FORM: AlertForm = { type: "LOW_STOCK", severity: "WARNING", title: "", message: "" };

export function AlertCenter({ facilityId }: { facilityId?: string }) {
  const [tab, setTab] = useState<Tab>("low_stock");
  const [range, setRange] = useState<Range>("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<AlertForm>(EMPTY_ALERT_FORM);
  const [editingAlert, setEditingAlert] = useState<Alert | null>(null);
  const [editForm, setEditForm] = useState<Partial<AlertForm>>({});
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (facilityId) params.set("facilityId", facilityId);
    if (tab === "resolved") params.set("resolved", "true");
    else {
      params.set("resolved", "false");
      params.set("category", tab);
    }
    const { from, to } = rangeToDates(range, customFrom, customTo);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (debouncedSearch) params.set("q", debouncedSearch);
    api<AlertsResponse>(`/alerts?${params}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [facilityId, tab, range, customFrom, customTo, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolveAlert(id: string) {
    setResolvingId(id);
    try {
      await api(`/alerts/${id}/resolve`, { method: "PATCH" });
      load();
    } catch (e) {
      console.error(e);
    } finally {
      setResolvingId(null);
    }
  }

  async function activateAlert(id: string) {
    try {
      await api(`/alerts/${id}/activate`, { method: "POST" });
      load();
    } catch (e) {
      console.error(e);
    }
  }

  async function createAlert(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    if (!createForm.title.trim() || !createForm.message.trim()) {
      return setFormError("Title and message are required");
    }
    setFormBusy(true);
    try {
      await api("/alerts", {
        method: "POST",
        body: JSON.stringify({ ...createForm, facilityId: facilityId ?? undefined }),
      });
      setShowCreate(false);
      setCreateForm(EMPTY_ALERT_FORM);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create alert");
    } finally {
      setFormBusy(false);
    }
  }

  async function saveEditAlert(e: React.FormEvent) {
    e.preventDefault();
    if (!editingAlert) return;
    setFormError("");
    setFormBusy(true);
    try {
      await api(`/alerts/${editingAlert.id}`, {
        method: "PATCH",
        body: JSON.stringify(editForm),
      });
      setEditingAlert(null);
      setEditForm({});
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update alert");
    } finally {
      setFormBusy(false);
    }
  }

  const counts = data?.counts;
  const alerts = useMemo(() => data?.alerts ?? [], [data]);

  return (
    <Card className="border-slate-200 shadow-sm" id="alert-center">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-medflow-600" />
          <CardTitle className="text-base">Alert Center</CardTitle>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => { setShowCreate(!showCreate); setEditingAlert(null); setFormError(""); }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Create Alert
          </Button>
        </div>

        {showCreate && (
          <form onSubmit={createAlert} className="rounded-lg border bg-white p-3 space-y-2">
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-sm">Type</Label>
                <select className="h-9 w-full rounded border px-2 text-sm" value={createForm.type} onChange={(e) => setCreateForm({ ...createForm, type: e.target.value })}>
                  {ALERT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-sm">Severity</Label>
                <select className="h-9 w-full rounded border px-2 text-sm" value={createForm.severity} onChange={(e) => setCreateForm({ ...createForm, severity: e.target.value })}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <Label className="text-sm">Title *</Label>
              <Input className="h-9" value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="Alert title" />
            </div>
            <div>
              <Label className="text-sm">Message *</Label>
              <Input className="h-9" value={createForm.message} onChange={(e) => setCreateForm({ ...createForm, message: e.target.value })} placeholder="Alert message" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={formBusy}>{formBusy ? "Saving…" : "Create"}</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => { setShowCreate(false); setFormError(""); }}>Cancel</Button>
            </div>
          </form>
        )}

        {editingAlert && (
          <form onSubmit={saveEditAlert} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
            <p className="text-sm font-medium text-amber-800">Editing alert</p>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div>
              <Label className="text-sm">Severity</Label>
              <select className="h-9 w-full rounded border px-2 text-sm" value={editForm.severity ?? editingAlert.severity} onChange={(e) => setEditForm({ ...editForm, severity: e.target.value })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-sm">Title</Label>
              <Input className="h-9" value={editForm.title ?? editingAlert.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} />
            </div>
            <div>
              <Label className="text-sm">Message</Label>
              <Input className="h-9" value={editForm.message ?? editingAlert.message} onChange={(e) => setEditForm({ ...editForm, message: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={formBusy}>{formBusy ? "Saving…" : "Save"}</Button>
              <Button size="sm" type="button" variant="outline" onClick={() => { setEditingAlert(null); setEditForm({}); setFormError(""); }}>Cancel</Button>
            </div>
          </form>
        )}

        {/* Tabs */}
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const count =
              t.key === "low_stock" ? counts?.lowStock : t.key === "expiry" ? counts?.expiry : counts?.resolved;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  active ? "bg-white text-medflow-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                {t.label}
                {count !== undefined && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-semibold ${
                      active ? "bg-medflow-100 text-medflow-700" : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-wrap gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={`rounded-full border px-2.5 py-1 text-sm font-medium transition ${
                  range === r.key
                    ? "border-medflow-300 bg-medflow-50 text-medflow-700"
                    : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="relative sm:ml-auto sm:max-w-xs sm:flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="h-9 pl-9"
              placeholder=""
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <label className="flex items-center gap-1">
              From
              <Input type="date" className="h-9 w-auto" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            </label>
            <label className="flex items-center gap-1">
              To
              <Input type="date" className="h-9 w-auto" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
            </label>
          </div>
        )}
      </CardHeader>

      <CardContent>
        <div className="max-h-[28rem] space-y-2 overflow-y-auto">
          {loading && alerts.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">Loading alerts…</p>
          )}
          {!loading && alerts.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">
              {tab === "resolved" ? "No resolved alerts in this range." : "No active alerts in this range."}
            </p>
          )}
          {alerts.map((a) => {
            const resolved = !!a.resolvedAt;
            return (
              <div
                key={a.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3 transition hover:bg-white"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${severityClass(a.severity)}`}>
                      {a.severity}
                    </span>
                    <span className="text-sm text-slate-500">{a.type.replace(/_/g, " ")}</span>
                    {/* Facility / location shown on every alert */}
                    <span className="text-sm font-medium text-medflow-600">{a.facility?.name ?? "All facilities"}</span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-slate-900">{a.title}</p>
                  <p className="truncate text-sm text-slate-600">{a.message}</p>
                  {resolved ? (
                    <p className="mt-1 text-[11px] text-emerald-700">
                      Resolved {new Date(a.resolvedAt as string).toLocaleString()}
                      {a.acknowledgedBy && ` · by ${a.acknowledgedBy.firstName} ${a.acknowledgedBy.lastName}`.trimEnd()}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">Raised {new Date(a.createdAt).toLocaleString()}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {a.medicineId && (
                    <Button asChild variant="ghost" size="sm" className="text-slate-600 hover:text-slate-900" title="View medicine">
                      <Link href={`/medicines/${a.medicineId}`}>
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-slate-500 hover:text-slate-800"
                    onClick={() => { setEditingAlert(a); setEditForm({}); setShowCreate(false); setFormError(""); }}
                    title="Edit alert"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  {!resolved && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-emerald-700 hover:text-emerald-800"
                      onClick={() => resolveAlert(a.id)}
                      disabled={resolvingId === a.id}
                      title="Mark resolved"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </Button>
                  )}
                  {resolved && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-amber-600 hover:text-amber-800"
                      onClick={() => activateAlert(a.id)}
                      title="Re-activate alert"
                    >
                      <PlayCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
