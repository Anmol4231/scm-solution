"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, RotateCcw, ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isMasterDataAdminRole } from "@/lib/roles";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";

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
type Range = "7" | "30" | "90" | "all" | "custom";

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
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

const RESTORE_ENDPOINTS: Record<string, string> = {
  Medicine: "/medicines",
  MedicineCategory: "/categories",
  Facility: "/facilities",
  Role: "/roles",
  HealthcareWorker: "/healthcare-workers",
  StockOrder: "/orders",
};

const NO_LOCATION_TYPES = new Set(["Medicine", "MedicineCategory", "Role"]);

function actionBadge(action: string) {
  if (action === "CREATE" || action === "ACTIVATE" || action === "RESTORE")
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  if (action === "SOFT_DELETE" || action === "DEACTIVATE")
    return "bg-red-50 text-red-700 ring-1 ring-red-200";
  if (action.startsWith("PASSWORD") || action === "FORCE_PASSWORD_CHANGE")
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
  if (action === "RESOLVE")
    return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  if (action === "UPDATE")
    return "bg-slate-100 text-medflow-700 ring-1 ring-slate-200";
  return "bg-slate-100 text-slate-600 ring-1 ring-slate-200";
}

function formatFieldLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function formatDate(ts: string) {
  const d = new Date(ts);
  return {
    date: d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
  };
}

// ─── Change diff ────────────────────────────────────────────────────────────

function CreateDiff({ curr }: { curr: Record<string, unknown> }) {
  const entries = Object.entries(curr).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!entries.length) return null;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-3 rounded-md px-2 py-1 odd:bg-slate-50">
          <span className="w-36 shrink-0 text-xs text-slate-400 pt-0.5">{formatFieldLabel(k)}</span>
          <span className="text-sm text-slate-800 break-all">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function UpdateDiff({
  prev,
  curr,
}: {
  prev: Record<string, unknown>;
  curr: Record<string, unknown>;
}) {
  const changedKeys = Object.keys({ ...prev, ...curr }).filter(
    (k) => String(prev[k] ?? "") !== String(curr[k] ?? "")
  );
  if (!changedKeys.length) return <p className="text-sm text-slate-400">No field-level changes recorded.</p>;
  return (
    <div className="space-y-2">
      {changedKeys.map((k) => (
        <div key={k} className="rounded-lg border border-slate-100 bg-white p-2.5">
          <p className="mb-1.5 text-xs font-medium text-slate-400 uppercase tracking-wide">{formatFieldLabel(k)}</p>
          <div className="flex items-start gap-2">
            <div className="flex-1 rounded-md bg-red-50 px-2.5 py-1.5 text-sm text-red-800 break-all">
              {String(prev[k] ?? "—")}
            </div>
            <ArrowRight className="mt-1.5 h-4 w-4 shrink-0 text-slate-300" />
            <div className="flex-1 rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm text-emerald-800 break-all">
              {String(curr[k] ?? "—")}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChangeDiff({
  prev,
  curr,
}: {
  prev: Record<string, unknown> | null | undefined;
  curr: Record<string, unknown> | null | undefined;
}) {
  if (!prev && curr) return <CreateDiff curr={curr} />;
  if (prev && curr) return <UpdateDiff prev={prev} curr={curr} />;
  return null;
}

// ─── Inline detail row ───────────────────────────────────────────────────────

function ExpandedDetail({
  entry,
  canRestore,
  restoring,
  onRestore,
}: {
  entry: AuditEntry;
  canRestore: boolean;
  restoring: boolean;
  onRestore: () => void;
}) {
  const hasDiff = !!(entry.previousValues || entry.currentValues);
  return (
    <tr className="border-b bg-slate-50/70">
      <td colSpan={7} className="px-6 py-4">
        {entry.changeDetails && (
          <p className="mb-3 text-sm text-slate-500">{entry.changeDetails}</p>
        )}
        {hasDiff ? (
          <ChangeDiff prev={entry.previousValues} curr={entry.currentValues} />
        ) : (
          !entry.changeDetails && (
            <p className="text-sm text-slate-400">No additional details recorded.</p>
          )
        )}
        {canRestore && (
          <div className="mt-4">
            <Button size="sm" variant="outline" disabled={restoring} onClick={onRestore} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" />
              {restoring ? "Restoring…" : `Restore "${entry.recordName}"`}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AuditTrailPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const isAdmin = isMasterDataAdminRole(user?.role);

  const [category, setCategory] = useState<Category>("");
  const [range, setRange] = useState<Range>("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreSuccess, setRestoreSuccess] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [deletedEntitySet, setDeletedEntitySet] = useState<Set<string>>(new Set());

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
    if (range === "custom") {
      if (customFrom) params.set("from", `${customFrom}T00:00:00.000Z`);
      if (customTo) params.set("to", `${customTo}T23:59:59.999Z`);
    } else if (range !== "all") {
      params.set("from", new Date(Date.now() - Number(range) * 86400000).toISOString());
    }
    if (debounced) params.set("q", debounced);
    api<{ logs: AuditEntry[] }>(`/audit?${params}`)
      .then((r) => setEntries(r.logs))
      .catch(console.error)
      .finally(() => setBusy(false));
  }, [isAdmin, category, range, customFrom, customTo, debounced]);

  useEffect(() => { load(); }, [load]);

  const loadDeletedEntities = useCallback(async () => {
    if (!isAdmin) return;
    const endpoints: [string, string][] = [
      ["Role", "/roles/deleted"],
      ["Facility", "/facilities/deleted"],
      ["HealthcareWorker", "/healthcare-workers/deleted"],
      ["Medicine", "/medicines/deleted"],
      ["MedicineCategory", "/categories/deleted"],
      ["StockOrder", "/orders/deleted"],
    ];
    const results = await Promise.allSettled(
      endpoints.map(([type, path]) =>
        api<{ id: string }[]>(path).then((items) => items.map((item) => `${type}:${item.id}`))
      )
    );
    const keys = new Set<string>();
    for (const r of results) {
      if (r.status === "fulfilled") r.value.forEach((k) => keys.add(k));
    }
    setDeletedEntitySet(keys);
  }, [isAdmin]);

  useEffect(() => { loadDeletedEntities(); }, [loadDeletedEntities]);

  const auditDerivedDeletedSet = useMemo(() => {
    const state = new Map<string, "deleted" | "active">();
    const sorted = [...entries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    for (const e of sorted) {
      if (!e.entityId || !(e.entityType in RESTORE_ENDPOINTS)) continue;
      const key = `${e.entityType}:${e.entityId}`;
      if (e.action === "SOFT_DELETE") state.set(key, "deleted");
      else if (e.action === "RESTORE") state.set(key, "active");
    }
    const deleted = new Set<string>();
    state.forEach((s, k) => { if (s === "deleted") deleted.add(k); });
    return deleted;
  }, [entries]);

  const isCurrentlyDeleted = (e: AuditEntry) => {
    if (!e.entityId || !(e.entityType in RESTORE_ENDPOINTS)) return false;
    const key = `${e.entityType}:${e.entityId}`;
    return deletedEntitySet.has(key) || auditDerivedDeletedSet.has(key);
  };

  const restore = async (entry: AuditEntry) => {
    if (!entry.entityId) return;
    const base = RESTORE_ENDPOINTS[entry.entityType];
    if (!base) return;
    setRestoring(entry.id);
    setRestoreError("");
    setRestoreSuccess("");
    try {
      await api(`${base}/${entry.entityId}/restore`, { method: "POST" });
      setRestoreSuccess(`"${entry.recordName}" restored successfully.`);
      load();
      loadDeletedEntities();
    } catch (err) {
      setRestoreError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setRestoring(null);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Audit Logs</h1>

      {restoreSuccess && (
        <p className="rounded-lg bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 ring-1 ring-emerald-200">
          {restoreSuccess}
        </p>
      )}
      {restoreError && (
        <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-700 ring-1 ring-red-200">
          {restoreError}
        </p>
      )}

      {/* Category pills */}
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.map((c) => (
          <button
            key={c.key || "all"}
            type="button"
            onClick={() => setCategory(c.key)}
            className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
              category === c.key
                ? "border-medflow-300 bg-medflow-50 text-medflow-700"
                : "border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Time range + search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRange(r.key)}
              className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                range === r.key
                  ? "border-medflow-300 bg-medflow-50 text-medflow-700"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </button>
          ))}
          {range === "custom" && (
            <div className="flex items-center gap-1.5 ml-1">
              <DateInput
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 w-36 text-sm"
                aria-label="From date"
                placeholder="From"
              />
              <span className="text-slate-400">–</span>
              <DateInput
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 w-36 text-sm"
                aria-label="To date"
                placeholder="To"
              />
            </div>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="h-9 w-52 pl-9"
            placeholder="Search records…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Record</th>
                <th className="px-4 py-3">Changed by</th>
                <th className="px-4 py-3">Facility</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => {
                const { date, time } = formatDate(e.timestamp);
                const isOpen = expanded === e.id;
                return (
                  <>
                    <tr
                      key={e.id}
                      className={`border-b transition hover:bg-slate-50/60 ${isOpen ? "bg-slate-50/60" : ""}`}
                    >
                      <td className="px-4 py-3 text-slate-500">
                        <span className="block text-slate-700">{date}</span>
                        <span className="block text-xs text-slate-400">{time}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${actionBadge(e.action)}`}>
                          {e.actionLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{e.entityType}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{e.recordName}</td>
                      <td className="px-4 py-3 text-slate-500">{e.changedBy}</td>
                      <td className="px-4 py-3 text-slate-400">
                        {NO_LOCATION_TYPES.has(e.entityType) ? "—" : (e.facility ?? "—")}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setExpanded(isOpen ? null : e.id)}
                          className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                            isOpen
                              ? "border-medflow-300 bg-medflow-50 text-medflow-700"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {isOpen ? "Close" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {isOpen && (
                      <ExpandedDetail
                        key={`${e.id}-detail`}
                        entry={e}
                        canRestore={isCurrentlyDeleted(e)}
                        restoring={restoring === e.id}
                        onRestore={() => restore(e)}
                      />
                    )}
                  </>
                );
              })}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    {busy ? "Loading…" : "No audit entries match this filter."}
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
