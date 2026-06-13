"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle, BarChart3, ChevronDown, ChevronUp, Download,
  Eye, Loader2, Printer, Search, X,
} from "lucide-react";
import { api } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { OperationsTabs } from "@/components/layout/operations-tabs";

interface DispenseLine {
  medicineName: string;
  quantity: number;
  batchNumber: string;
  expiryDate: string;
  dispensedAt: string;
  dispensedBy: string;
}

interface PrescriptionGroup {
  prescriptionDbId: string;
  prescriptionId: string;
  dispensedAt: string;
  patient: { id: string; patientId: string; firstName: string; lastName: string } | null;
  doctorName: string | null;
  facility: { name: string; code: string } | null;
  dispensedBy: string | null;
  totalQuantity: number;
  lines: DispenseLine[];
}

interface GroupedResponse {
  records: PrescriptionGroup[];
  total: number;
}

interface SummaryStats {
  totalDispensingsToday: number;
  patientsTodayCount: number;
  controlledDispensingsToday: number;
  medicinesDispensedToday: number;
  returnsToday: number;
}

interface Filters {
  from: string;
  to: string;
  patientName: string;
  patientId: string;
  prescriptionNumber: string;
  medicine: string;
  batchNumber: string;
  pharmacist: string;
  facilityId: string;
}

type SortDir = "asc" | "desc";

const PAGE_SIZE = 50;

function todayIso() { return new Date().toISOString().slice(0, 10); }
function isoDaysAgo(days: number) { return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10); }

function SummaryCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

function DetailModal({ group, onClose }: { group: PrescriptionGroup; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div>
            <p className="font-semibold text-slate-900">Dispensing Detail — {group.prescriptionId}</p>
            <p className="mt-0.5 text-sm text-slate-500">
              {group.patient
                ? <Link href={`/patients/${group.patient.id}`} className="text-medflow-600 hover:underline" onClick={onClose}>{group.patient.firstName} {group.patient.lastName} · {group.patient.patientId}</Link>
                : "—"}
              {group.doctorName ? ` · Dr. ${group.doctorName}` : ""}
            </p>
            <p className="mt-0.5 text-xs text-slate-400">
              {new Date(group.dispensedAt).toLocaleString()}
              {group.facility ? ` · ${group.facility.name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Lines table */}
        <div className="overflow-x-auto p-5">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-slate-50 text-left text-xs text-slate-500">
              <tr>
                <th className="rounded-l p-2 pl-3">Medicine</th>
                <th className="p-2 text-right">Qty</th>
                <th className="p-2">Batch</th>
                <th className="p-2">Expiry</th>
                <th className="p-2">Dispensed By</th>
                <th className="rounded-r p-2">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {group.lines.map((l, i) => {
                const exp = new Date(l.expiryDate);
                const days = Math.floor((exp.getTime() - Date.now()) / 86400000);
                return (
                  <tr key={i}>
                    <td className="p-2 pl-3 font-medium">{l.medicineName}</td>
                    <td className="p-2 text-right font-semibold">{l.quantity}</td>
                    <td className="p-2 font-mono text-xs text-slate-600">{l.batchNumber}</td>
                    <td className="p-2 text-xs">
                      <span className={days < 30 ? "font-semibold text-red-600" : days < 90 ? "text-amber-600" : "text-slate-600"}>
                        {exp.toLocaleDateString()}{days < 90 && days >= 0 ? " ⚠" : ""}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-slate-600">{l.dispensedBy}</td>
                    <td className="p-2 text-xs text-slate-500">{new Date(l.dispensedAt).toLocaleTimeString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-slate-500">
              {group.lines.length} medicine{group.lines.length !== 1 ? "s" : ""} · {group.totalQuantity} total units
            </span>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Print
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DispensingReportsPage() {
  const hasAccess = useRequirePermission("dispensing");
  const { user } = useAuth();

  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  useEffect(() => {
    if (!user?.facilityId) {
      api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
    }
  }, [user?.facilityId]);

  /* ── Stats ── */
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const loadStats = useCallback(() => {
    setStatsLoading(true);
    const p = new URLSearchParams();
    if (user?.facilityId) p.set("facilityId", user.facilityId);
    api<SummaryStats>(`/dispensing/summary?${p}`)
      .then(setStats).catch(() => {}).finally(() => setStatsLoading(false));
  }, [user?.facilityId]);
  useEffect(() => { loadStats(); }, [loadStats]);

  /* ── Filters ── */
  const emptyFilters: Filters = {
    from: todayIso(), to: todayIso(),
    patientName: "", patientId: "", prescriptionNumber: "",
    medicine: "", batchNumber: "", pharmacist: "",
    facilityId: user?.facilityId ?? "",
  };
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const pf = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));

  /* ── Sort ── */
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  // Date sorting is applied server-side; Batch No. sorting reorders the loaded page client-side.
  const [sortKey, setSortKey] = useState<"date" | "batch">("date");

  /* ── Records ── */
  const [records, setRecords] = useState<PrescriptionGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* ── Detail modal ── */
  const [detailGroup, setDetailGroup] = useState<PrescriptionGroup | null>(null);

  const buildParams = useCallback((pageIndex: number) => {
    const p = new URLSearchParams();
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    if (filters.patientName.trim()) p.set("patientName", filters.patientName.trim());
    if (filters.patientId.trim()) p.set("patientId", filters.patientId.trim());
    if (filters.prescriptionNumber.trim()) p.set("prescriptionNumber", filters.prescriptionNumber.trim());
    if (filters.medicine.trim()) p.set("medicineName", filters.medicine.trim());
    if (filters.batchNumber.trim()) p.set("batchNumber", filters.batchNumber.trim());
    if (filters.pharmacist.trim()) p.set("pharmacist", filters.pharmacist.trim());
    if (filters.facilityId) p.set("facilityId", filters.facilityId);
    p.set("sortDir", sortDir);
    p.set("take", String(PAGE_SIZE));
    p.set("skip", String(pageIndex * PAGE_SIZE));
    return p;
  }, [filters, sortDir]);

  const loadRecords = useCallback((pageIndex: number) => {
    setLoading(true); setError("");
    api<GroupedResponse>(`/dispensing/by-prescription?${buildParams(pageIndex)}`)
      .then((r) => { setRecords(r.records); setTotal(r.total); setPage(pageIndex); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load records"))
      .finally(() => setLoading(false));
  }, [buildParams]);

  useEffect(() => { loadRecords(0); }, [loadRecords]);

  /* ── CSV export ── */
  const exportCsv = () => {
    const rows: (string | number)[][] = [
      ["Date/Time", "Patient", "Patient ID", "Batch No.", "Doctor", "Medicines", "Total Qty", "Dispensed By", "Facility", "Prescription #"],
    ];
    for (const g of records) {
      rows.push([
        new Date(g.dispensedAt).toLocaleString(),
        g.patient ? `${g.patient.firstName} ${g.patient.lastName}` : "",
        g.patient?.patientId ?? "",
        Array.from(new Set(g.lines.map((l) => l.batchNumber).filter(Boolean))).join("; "),
        g.doctorName ?? "",
        g.lines.map((l) => l.medicineName).join("; "),
        g.totalQuantity,
        g.dispensedBy ?? "",
        g.facility?.name ?? "",
        g.prescriptionId,
      ]);
    }
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `dispensing-report-${filters.from}-${filters.to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (!hasAccess) return null;

  const totalPages = Math.ceil(total / PAGE_SIZE);

  /** Distinct batch numbers dispensed under a prescription, sorted for display/sort. */
  const batchList = (g: PrescriptionGroup) =>
    Array.from(new Set(g.lines.map((l) => l.batchNumber).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

  // Batch No. sorting is page-local (the report is grouped/paginated by date on the server).
  const displayRecords =
    sortKey === "batch"
      ? [...records].sort((a, b) => {
          const av = batchList(a)[0] ?? "";
          const bv = batchList(b)[0] ?? "";
          return av.localeCompare(bv, undefined, { numeric: true }) * (sortDir === "asc" ? 1 : -1);
        })
      : records;

  const toggleSort = (key: "date" | "batch") => {
    if (sortKey === key) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else setSortKey(key);
  };

  return (
    <div className="space-y-4">
      <OperationsTabs />

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {statsLoading ? (
          <div className="col-span-full flex items-center justify-center py-6 text-sm text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading stats…
          </div>
        ) : stats ? (
          <>
            <SummaryCard label="Dispensings Today" value={stats.totalDispensingsToday} />
            <SummaryCard label="Patients Served Today" value={stats.patientsTodayCount} />
            <SummaryCard label="Controlled Dispensings Today" value={stats.controlledDispensingsToday} />
            <SummaryCard label="Units Dispensed Today" value={stats.medicinesDispensedToday} />
            <SummaryCard label="Returns Today" value={stats.returnsToday} />
          </>
        ) : null}
      </div>

      {/* ── Filters ── */}
      <Card>
        <div
          className="flex cursor-pointer items-center justify-between px-4 py-3"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Search className="h-4 w-4 text-medflow-600" /> Filters
          </div>
          {filtersOpen ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </div>

        {filtersOpen && (
          <CardContent className="space-y-3 border-t p-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" className="h-9" value={filters.from} onChange={(e) => pf({ from: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" className="h-9" value={filters.to} onChange={(e) => pf({ to: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Patient Name</Label>
                <Input className="h-9" placeholder="Search name…" value={filters.patientName} onChange={(e) => pf({ patientName: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Patient ID</Label>
                <Input className="h-9" placeholder="e.g. PAT00123" value={filters.patientId} onChange={(e) => pf({ patientId: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Prescription Number</Label>
                <Input className="h-9" placeholder="e.g. RX00123" value={filters.prescriptionNumber} onChange={(e) => pf({ prescriptionNumber: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Medicine</Label>
                <Input className="h-9" placeholder="Search medicine…" value={filters.medicine} onChange={(e) => pf({ medicine: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Batch Number</Label>
                <Input className="h-9" placeholder="e.g. BT-2024-001" value={filters.batchNumber} onChange={(e) => pf({ batchNumber: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Pharmacist</Label>
                <Input className="h-9" placeholder="Search pharmacist…" value={filters.pharmacist} onChange={(e) => pf({ pharmacist: e.target.value })} />
              </div>
              {!user?.facilityId && (
                <div>
                  <Label className="text-xs">Facility</Label>
                  <select
                    className="h-9 w-full rounded-lg border px-3 text-sm"
                    value={filters.facilityId}
                    onChange={(e) => pf({ facilityId: e.target.value })}
                  >
                    <option value="">All facilities</option>
                    {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => loadRecords(0)} disabled={loading}>
                {loading ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
                Apply Filters
              </Button>
              <Button size="sm" variant="outline" onClick={() => pf({ from: todayIso(), to: todayIso() })}>Today</Button>
              <Button size="sm" variant="outline" onClick={() => pf({ from: isoDaysAgo(6), to: todayIso() })}>Last 7 days</Button>
              <Button size="sm" variant="outline" onClick={() => pf({ from: isoDaysAgo(29), to: todayIso() })}>Last 30 days</Button>
              <Button size="sm" variant="ghost" onClick={() => setFilters({ ...emptyFilters, facilityId: user?.facilityId ?? "" })}>
                <X className="mr-1 h-3.5 w-3.5" /> Clear
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Results ── */}
      <Card>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-medflow-600" />
            <span className="text-sm font-medium text-slate-700">
              {loading ? "Loading…" : `${total.toLocaleString()} prescription${total !== 1 ? "s" : ""}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Sort:</span>
            <button
              type="button"
              className={`flex items-center gap-1 text-xs ${sortKey === "date" ? "font-semibold text-medflow-700" : "text-slate-500 hover:text-slate-700"}`}
              onClick={() => toggleSort("date")}
            >
              Date {sortKey === "date" && (sortDir === "desc" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />)}
            </button>
            <button
              type="button"
              className={`flex items-center gap-1 text-xs ${sortKey === "batch" ? "font-semibold text-medflow-700" : "text-slate-500 hover:text-slate-700"}`}
              onClick={() => toggleSort("batch")}
            >
              Batch No. {sortKey === "batch" && (sortDir === "desc" ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />)}
            </button>
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="mr-1.5 h-4 w-4" /> Print
            </Button>
            <Button size="sm" variant="outline" onClick={exportCsv} disabled={records.length === 0}>
              <Download className="mr-1.5 h-4 w-4" /> Export Excel
            </Button>
          </div>
        </div>

        <CardContent className="p-0">
          {error && <p className="mx-4 mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm print-table">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="p-2 pl-4">Date/Time</th>
                  <th className="p-2">Patient</th>
                  <th className="p-2">Batch No.</th>
                  <th className="p-2">Medicines</th>
                  <th className="p-2 text-right">Total Qty</th>
                  <th className="p-2">Dispensed By</th>
                  {!user?.facilityId && <th className="p-2">Facility</th>}
                  <th className="p-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {records.length === 0 && !loading && (
                  <tr>
                    <td colSpan={user?.facilityId ? 7 : 8} className="p-8 text-center text-slate-400">
                      <AlertCircle className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                      No dispensing records match the current filters.
                    </td>
                  </tr>
                )}
                {loading && records.length === 0 && (
                  <tr>
                    <td colSpan={user?.facilityId ? 7 : 8} className="p-8 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-medflow-400" />
                    </td>
                  </tr>
                )}
                {displayRecords.map((g) => {
                  const batches = batchList(g);
                  return (
                  <tr key={g.prescriptionDbId} className="hover:bg-slate-50/60">
                    <td className="whitespace-nowrap p-2 pl-4 text-slate-600">
                      {new Date(g.dispensedAt).toLocaleString()}
                    </td>
                    <td className="p-2">
                      {g.patient ? (
                        <Link href={`/patients/${g.patient.id}`} className="hover:underline">
                          <span className="font-medium text-medflow-600">{g.patient.firstName} {g.patient.lastName}</span>
                          <span className="ml-1 text-xs text-slate-400">{g.patient.patientId}</span>
                        </Link>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="p-2">
                      {batches.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className="font-mono text-sm text-slate-700" title={batches.join(", ")}>
                          {batches[0]}{batches.length > 1 ? ` +${batches.length - 1} more` : ""}
                        </span>
                      )}
                    </td>
                    <td className="p-2">
                      <span className="text-slate-700">
                        {g.lines.length === 1
                          ? g.lines[0].medicineName
                          : `${g.lines[0].medicineName} +${g.lines.length - 1} more`}
                      </span>
                    </td>
                    <td className="p-2 text-right font-semibold text-slate-700">{g.totalQuantity}</td>
                    <td className="p-2 text-slate-600">{g.dispensedBy ?? "—"}</td>
                    {!user?.facilityId && (
                      <td className="p-2 text-sm text-slate-500">{g.facility?.name ?? "—"}</td>
                    )}
                    <td className="p-2 pr-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDetailGroup(g)}
                        className="h-7 px-2 text-xs"
                      >
                        <Eye className="mr-1 h-3.5 w-3.5" /> View
                      </Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-500">
            <span>
              {total === 0 ? "No records" : `Showing ${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} of ${total.toLocaleString()}`}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0 || loading} onClick={() => loadRecords(page - 1)}>← Prev</Button>
              <span className="flex items-center px-2 text-xs">Page {page + 1} of {Math.max(totalPages, 1)}</span>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages || loading} onClick={() => loadRecords(page + 1)}>Next →</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Detail modal ── */}
      {detailGroup && <DetailModal group={detailGroup} onClose={() => setDetailGroup(null)} />}

      <style jsx global>{`
        @media print {
          body * { visibility: hidden; }
          .print-table, .print-table * { visibility: visible; }
          .print-table { position: absolute; inset: 0; font-size: 11px; }
        }
      `}</style>
    </div>
  );
}
