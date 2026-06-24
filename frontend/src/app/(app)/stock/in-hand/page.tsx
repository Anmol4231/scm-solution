"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Download, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useMedicines } from "@/lib/medicines-cache";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { downloadAuthenticatedFile } from "@/lib/download";

// ─── Types ───────────────────────────────────────────────────────────────────

interface StockBatchRow {
  id: string;
  batchNumber: string;
  quantity: number;
  expiryDate: string;
  daysLeft: number;
  status: string;
  medicine: {
    id: string;
    medicineName: string;
    genericName?: string | null;
    dosageForm?: string | null;
    reorderThreshold: number;
    category?: { id: string; name: string; coldStorage: boolean; controlledDrug: boolean } | null;
  };
  facility: { id: string; name: string; code: string };
}

interface Category {
  id: string;
  name: string;
}

interface MedicineOption {
  id: string;
  medicineName: string;
}

type SortField = "medicineName" | "category" | "facility" | "quantity" | "expiryDate" | "batchNumber";
type ExpiryFilter = "" | "expired" | "not-expired" | "expiring" | "ok";

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Expired"
      ? "bg-red-100 text-red-700"
      : status.startsWith("Expiring Soon (Critical)")
        ? "bg-orange-100 text-orange-700"
        : status.startsWith("Expiring")
          ? "bg-amber-100 text-amber-700"
          : "bg-emerald-100 text-emerald-700";
  // Friendlier display labels than the raw backend status strings.
  const label =
    status === "Expiring Soon (Critical)"
      ? "Critical — Expiring"
      : status;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {label}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StockInHandPage() {
  const { user } = useAuth();
  const isCrossAdmin = isAdminDashboardRole(user?.role);

  const [rows, setRows] = useState<StockBatchRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const { data: medicines = [] } = useMedicines();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [medicineId, setMedicineId] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>("");
  const [facilityId, setFacilityId] = useState("");
  const [allFacilities, setAllFacilities] = useState<{ id: string; name: string; code: string }[]>([]);

  // Sorting
  const [sortBy, setSortBy] = useState<SortField>("medicineName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const PAGE_SIZE = 100;

  // Export
  const [exporting, setExporting] = useState(false);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Load categories + facilities (admin)
  useEffect(() => {
    api<Category[]>("/categories").then(setCategories).catch(() => {});
    if (isCrossAdmin) {
      api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setAllFacilities).catch(() => {});
    }
  }, [isCrossAdmin]);

  // Single source of truth for all active filter params — used by both load and export.
  const buildParams = useCallback((includeSort = true) => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    if (medicineId) params.set("medicineId", medicineId);
    if (batchNumber.trim()) params.set("batchNumber", batchNumber.trim());
    if (categoryId) params.set("categoryId", categoryId);
    if (expiryFilter) params.set("expiryStatus", expiryFilter);
    if (isCrossAdmin && facilityId) params.set("facilityId", facilityId);
    if (includeSort) {
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
    }
    return params;
  }, [debouncedSearch, medicineId, batchNumber, categoryId, expiryFilter, facilityId, isCrossAdmin, sortBy, sortDir]);

  const load = useCallback((pg = 1) => {
    setLoading(true);
    setError("");
    const params = buildParams();
    params.set("page", String(pg));
    params.set("pageSize", String(PAGE_SIZE));
    api<{ data: StockBatchRow[]; total: number; page: number; pageSize: number }>(`/stock/in-hand?${params}`)
      .then((r) => { setRows(r.data); setTotal(r.total); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : "Failed to load stock data"); setLoading(false); });
  }, [buildParams]);

  useEffect(() => { setPage(1); load(1); }, [load]);

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      // Pass all active filters (excluding sort — CSV is alphabetical by default).
      const params = buildParams(false);
      const date = new Date().toISOString().slice(0, 10);
      await downloadAuthenticatedFile(`/stock/in-hand/export?${params}`, `stock-in-hand-${date}.csv`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className="flex items-center gap-1 font-semibold hover:text-medflow-700"
    >
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${sortBy === field ? "text-medflow-600" : "text-slate-300"}`} />
    </button>
  );

  const EXPIRY_FILTERS: { key: ExpiryFilter; label: string }[] = [
    { key: "", label: "All statuses" },
    { key: "not-expired", label: "Not expired (usable)" },
    { key: "ok", label: "In date" },
    { key: "expiring", label: "Expiring soon" },
    { key: "expired", label: "Expired" },
  ];

  return (
    <div className="space-y-5">
      <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stock in Hand</h1>
          <p className="text-sm text-muted-foreground">Real-time view of current inventory across all batches.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Search + Filters */}
      <div className="space-y-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search by medicine, generic name, or batch no.…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-slate-50/60 p-3">
            {isCrossAdmin && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Facility</label>
                <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className="h-9 rounded-lg border bg-white px-2 text-sm">
                  <option value="">All Facilities</option>
                  {allFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">Product</label>
              <select value={medicineId} onChange={(e) => setMedicineId(e.target.value)} className="h-9 rounded-lg border bg-white px-2 text-sm">
                <option value="">All Products</option>
                {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-9 rounded-lg border bg-white px-2 text-sm"
              >
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">Batch</label>
              <Input className="h-9 w-36" value={batchNumber} onChange={(e) => setBatchNumber(e.target.value)} placeholder="Batch no." />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">Expiry Status</label>
              <select
                value={expiryFilter}
                onChange={(e) => setExpiryFilter(e.target.value as ExpiryFilter)}
                className="h-9 rounded-lg border bg-white px-2 text-sm"
              >
                {EXPIRY_FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setMedicineId("");
                setBatchNumber("");
                setCategoryId("");
                setExpiryFilter("");
                setFacilityId("");
              }}
              className="h-9 self-end rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-white"
            >
              Clear
            </button>
          </div>
      </div>

      {/* Summary counts */}
      {!loading && rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {[
            { label: "Total Stock", value: rows.reduce((sum, r) => sum + r.quantity, 0), cls: "bg-slate-100 text-slate-700" },
            { label: "Active Stock", value: rows.filter((r) => r.status !== "Expired").reduce((sum, r) => sum + r.quantity, 0), cls: "bg-emerald-50 text-emerald-700" },
            { label: "Near Expiry", value: rows.filter((r) => r.status.startsWith("Expiring Soon")).reduce((sum, r) => sum + r.quantity, 0), cls: "bg-amber-50 text-amber-700" },
            { label: "Expired Stock", value: rows.filter((r) => r.status === "Expired").reduce((sum, r) => sum + r.quantity, 0), cls: "bg-red-50 text-red-700" },
            { label: "Low Stock", value: rows.filter((r) => r.quantity > 0 && r.quantity <= r.medicine.reorderThreshold).length, cls: "bg-orange-50 text-orange-700" },
            { label: "Out Of Stock", value: 0, cls: "bg-rose-50 text-rose-700" },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg px-3 py-2 text-sm ${s.cls}`}>
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-lg font-bold">{s.value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-sm">
            <tbody><SkeletonRows rows={8} cols={8} /></tbody>
          </table>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <p className="text-sm text-muted-foreground">No stock batches found matching the current filters.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white shadow-sm">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-sm text-slate-500">
                <th className="p-3 pl-4">
                  <SortButton field="medicineName" label="Medicine" />
                </th>
                <th className="p-3"><SortButton field="category" label="Category" /></th>
                {isCrossAdmin && <th className="p-3"><SortButton field="facility" label="Facility" /></th>}
                <th className="p-3">
                  <SortButton field="batchNumber" label="Batch No." />
                </th>
                <th className="p-3 text-right">
                  <SortButton field="quantity" label="Qty" />
                </th>
                <th className="p-3">
                  <SortButton field="expiryDate" label="Expiry Date" />
                </th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0 hover:bg-slate-50/60">
                  <td className="p-3 pl-4">
                    <p className="font-medium text-slate-800">{row.medicine.medicineName}</p>
                    {row.medicine.genericName && (
                      <p className="text-sm text-slate-500">{row.medicine.genericName}</p>
                    )}
                    {row.medicine.dosageForm && (
                      <p className="text-sm text-slate-400">{row.medicine.dosageForm}</p>
                    )}
                  </td>
                  <td className="p-3">
                    {row.medicine.category ? (
                      <div>
                        <p className="text-slate-700">{row.medicine.category.name}</p>
                        <div className="mt-0.5 flex gap-1">
                          {row.medicine.category.coldStorage && (
                            <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">Cold</span>
                          )}
                          {row.medicine.category.controlledDrug && (
                            <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700">Ctrl</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  {isCrossAdmin && (
                    <td className="p-3">
                      <p className="text-slate-700">{row.facility.name}</p>
                      <p className="text-sm text-slate-400">{row.facility.code}</p>
                    </td>
                  )}
                  <td className="p-3 font-mono text-sm text-slate-600">{row.batchNumber}</td>
                  <td className="p-3 text-right font-semibold text-slate-800">{row.quantity.toLocaleString()}</td>
                  <td className="p-3 tabular-nums text-slate-600">
                    {new Date(row.expiryDate).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                    {row.daysLeft > 0 && (
                      <p className="text-sm text-slate-400">{row.daysLeft} days left</p>
                    )}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE && (
        <StockPagination
          page={page}
          total={total}
          pageSize={PAGE_SIZE}
          onChange={(p) => { setPage(p); load(p); }}
        />
      )}
    </div>
  );
}

function StockPagination({ page, total, pageSize, onChange }: {
  page: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (page > 4) pages.push("...");
    for (let i = Math.max(2, page - 2); i <= Math.min(totalPages - 1, page + 2); i++) pages.push(i);
    if (page < totalPages - 3) pages.push("...");
    pages.push(totalPages);
  }

  return (
    <div className="flex items-center justify-center gap-1 pt-4">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="rounded px-3 py-1 text-sm text-muted-foreground hover:bg-accent disabled:opacity-40"
      >
        Previous
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`ellipsis-${i}`} className="px-2 text-sm text-muted-foreground">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onChange(p as number)}
            className={`min-w-[2rem] rounded px-2 py-1 text-sm ${p === page ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:bg-accent"}`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onChange(page + 1)}
        disabled={page === totalPages}
        className="rounded px-3 py-1 text-sm text-muted-foreground hover:bg-accent disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}
