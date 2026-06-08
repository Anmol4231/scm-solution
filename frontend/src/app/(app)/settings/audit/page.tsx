"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, ScrollText, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  actionLabel: string;
  entityType: string;
  entityId?: string | null;
  recordName: string;
  changedBy: string;
  facility?: string | null;
  previousValues?: Record<string, unknown> | null;
  currentValues?: Record<string, unknown> | null;
  changeDetails?: string | null;
}

type Category = "" | "users" | "alerts" | "staff" | "facilities" | "roles" | "medicines" | "stock";
type Range = "7" | "30" | "90" | "all";

const CATEGORIES: { key: Category; label: string }[] = [
  { key: "", label: "All" },
  { key: "users", label: "Users" },
  { key: "staff", label: "Staff" },
  { key: "medicines", label: "Medicines" },
  { key: "stock", label: "Stock" },
  { key: "facilities", label: "Facilities" },
  { key: "roles", label: "Roles" },
  { key: "alerts", label: "Alerts" },
];

const RANGES: { key: Range; label: string }[] = [
  { key: "7", label: "7 Days" },
  { key: "30", label: "30 Days" },
  { key: "90", label: "90 Days" },
  { key: "all", label: "All time" },
];

function actionClass(action: string) {
  if (action === "CREATE" || action === "ACTIVATE" || action === "RESTORE") return "bg-emerald-50 text-emerald-700";
  if (action === "SOFT_DELETE" || action === "DEACTIVATE") return "bg-red-50 text-red-700";
  if (action.startsWith("PASSWORD") || action === "FORCE_PASSWORD_CHANGE") return "bg-amber-50 text-amber-700";
  if (action === "RESOLVE") return "bg-blue-50 text-blue-700";
  if (action === "UPDATE") return "bg-slate-100 text-medflow-700";
  return "bg-slate-100 text-slate-600";
}

function formatFieldLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function ChangeDiff({ prev, curr }: {
  prev: Record<string, unknown> | null | undefined;
  curr: Record<string, unknown> | null | undefined;
}) {
  if (!prev && !curr) return null;

  // If we only have curr (CREATE), show it as a new-record summary.
  if (!prev && curr) {
    const entries = Object.entries(curr).filter(([, v]) => v !== null && v !== undefined && v !== "");
    if (!entries.length) return null;
    return (
      <div className="mt-2 text-sm">
        <p className="mb-1 font-semibold text-emerald-700">Created with:</p>
        <div className="space-y-0.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="w-32 shrink-0 text-slate-500">{formatFieldLabel(k)}</span>
              <span className="text-slate-800">{String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // UPDATE: show only changed fields with before → after.
  const changedKeys = Object.keys({ ...prev, ...curr }).filter((k) => {
    const pv = prev?.[k], cv = curr?.[k];
    return String(pv ?? "") !== String(cv ?? "");
  });

  if (!changedKeys.length) return null;

  return (
    <div className="mt-2 grid gap-3 text-sm sm:grid-cols-2">
      <div>
        <p className="mb-1 font-semibold text-red-700">Before</p>
        <div className="space-y-0.5 rounded-lg border border-red-100 bg-red-50/50 p-2">
          {changedKeys.map((k) => (
            <div key={k} className="flex gap-2">
              <span className="w-32 shrink-0 text-slate-500">{formatFieldLabel(k)}</span>
              <span className="text-slate-700">{String(prev?.[k] ?? "—")}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-1 font-semibold text-emerald-700">After</p>
        <div className="space-y-0.5 rounded-lg border border-emerald-100 bg-emerald-50/50 p-2">
          {changedKeys.map((k) => (
            <div key={k} className="flex gap-2">
              <span className="w-32 shrink-0 text-slate-500">{formatFieldLabel(k)}</span>
              <span className="text-slate-700">{String(curr?.[k] ?? "—")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AuditTrailPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);

  const [category, setCategory] = useState<Category>("");
  const [range, setRange] = useState<Range>("30");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState("");
  const [restoreError, setRestoreError] = useState("");

  useEffect(() => {
    if (!loading && !isAdmin) router.replace("/dashboard");
  }, [isAdmin, loading, router]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    if (!isAdmin) return;
    setBusy(true);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (range !== "all") params.set("from", new Date(Date.now() - Number(range) * 86400000).toISOString());
    if (debounced) params.set("q", debounced);
    api<{ logs: AuditEntry[] }>(`/audit?${params}`)
      .then((r) => setEntries(r.logs))
      .catch(console.error)
      .finally(() => setBusy(false));
  }, [isAdmin, category, range, debounced]);

  useEffect(() => { load(); }, [load]);

  const restore = async (entry: AuditEntry) => {
    if (!entry.entityId) return;
    const endpoint = entry.entityType === "Medicine"
      ? `/medicines/${entry.entityId}/restore`
      : `/categories/${entry.entityId}/restore`;
    setRestoring(entry.id);
    setRestoreError("");
    setRestoreSuccess("");
    try {
      await api(endpoint, { method: "POST" });
      setRestoreSuccess(`"${entry.recordName}" restored successfully.`);
      load();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(null);
    }
  };

  if (!isAdmin) return null;

  const hasDiff = (e: AuditEntry) =>
    (e.previousValues && Object.keys(e.previousValues).length > 0) ||
    (e.currentValues && Object.keys(e.currentValues).length > 0);

  const noLocationTypes = new Set(["Medicine", "MedicineCategory", "Role"]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5 text-medflow-600" />
        <div>
          <h1 className="text-2xl font-bold">Audit Trail &amp; Restore</h1>
        </div>
      </div>

      {restoreSuccess && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{restoreSuccess}</p>}
      {restoreError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{restoreError}</p>}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.key || "all"}
              type="button"
              onClick={() => setCategory(c.key)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                category === c.key ? "border-medflow-300 bg-medflow-50 text-medflow-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={`rounded-full border px-2.5 py-1 text-sm font-medium transition ${
                  range === r.key ? "border-medflow-300 bg-medflow-50 text-medflow-700" : "border-slate-200 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="h-9 w-44 pl-9" placeholder="" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3">When</th>
                <th className="p-3">Action</th>
                <th className="p-3">Type</th>
                <th className="p-3">Record</th>
                <th className="p-3">By</th>
                <th className="p-3">Location</th>
                <th className="p-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <>
                  <tr key={e.id} className="border-b hover:bg-slate-50/70">
                    <td className="whitespace-nowrap p-3 text-slate-500">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="p-3">
                      <span className={`rounded px-1.5 py-0.5 text-sm font-semibold ${actionClass(e.action)}`}>{e.actionLabel}</span>
                    </td>
                    <td className="p-3 text-slate-600">{e.entityType}</td>
                    <td className="p-3 font-medium">{e.recordName}</td>
                    <td className="p-3 text-slate-600">{e.changedBy}</td>
                    <td className="p-3 text-slate-500">
                      {noLocationTypes.has(e.entityType) ? "—" : (e.facility ?? "—")}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {hasDiff(e) && (
                          <button
                            type="button"
                            onClick={() => setExpanded(expanded === e.id ? null : e.id)}
                            className="flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-sm text-slate-600 hover:bg-slate-50"
                          >
                            {expanded === e.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            View
                          </button>
                        )}
                        {e.action === "SOFT_DELETE" && e.entityId && (e.entityType === "Medicine" || e.entityType === "MedicineCategory") && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-6 px-2 text-sm"
                            disabled={restoring === e.id}
                            onClick={() => restore(e)}
                          >
                            <RotateCcw className="mr-1 h-3 w-3" />
                            {restoring === e.id ? "Restoring…" : "Restore"}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expanded === e.id && (
                    <tr key={`${e.id}-detail`} className="border-b bg-slate-50/60">
                      <td colSpan={7} className="px-4 py-3">
                        {e.changeDetails && (
                          <p className="mb-2 text-sm text-slate-500">{e.changeDetails}</p>
                        )}
                        <ChangeDiff prev={e.previousValues} curr={e.currentValues} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    {busy ? "Loading…" : "No audit entries for this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
