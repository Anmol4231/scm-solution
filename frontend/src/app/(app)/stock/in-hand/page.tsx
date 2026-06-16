"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowUpDown, Download, Search, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type SortField = "medicineName" | "quantity" | "expiryDate" | "batchNumber";
type ExpiryFilter = "" | "expired" | "expiring" | "ok";

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
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>
      {status}
    </span>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function StockInHandPage() {
  const { user } = useAuth();
  const isCrossAdmin = isAdminDashboardRole(user?.role);

  const [rows, setRows] = useState<StockBatchRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [medicines, setMedicines] = useState<MedicineOption[]>([]);
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
  const [showFilters, setShowFilters] = useState(false);

  // Sorting
  const [sortBy, setSortBy] = useState<SortField>("medicineName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

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
    api<MedicineOption[]>("/medicines").then(setMedicines).catch(() => {});
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

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api<StockBatchRow[]>(`/stock/in-hand?${buildParams()}`)
      .then((data) => { setRows(data); setLoading(false); })
      .catch((err) => { setError(err instanceof Error ? err.message : "Failed to load stock data"); setLoading(false); });
  }, [buildParams]);

  useEffect(() => { load(); }, [load]);

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
    { key: "", label: "All" },
    { key: "ok", label: "In Date" },
    { key: "expiring", label: "Expiring Soon" },
    { key: "expired", label: "Expired" },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stock in Hand</h1>
          <p className="text-sm text-muted-foreground">Real-time view of current inventory across all batches.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
            Filters
          </Button>
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
            placeholder=""
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-slate-50/60 p-3">
            {isCrossAdmin && (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Facility</label>
                <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className="h-9 rounded-lg border px-2 text-sm">
                  <option value="">All Facilities</option>
                  {allFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">Product</label>
              <select value={medicineId} onChange={(e) => setMedicineId(e.target.value)} className="h-9 rounded-lg border px-2 text-sm">
                <option value="">All Products</option>
                {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="h-9 rounded-lg border px-2 text-sm"
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
              <div className="flex gap-1">
                {EXPIRY_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setExpiryFilter(f.key)}
                    className={`rounded-full border px-3 py-1 text-sm font-medium transition ${
                      expiryFilter === f.key
                        ? "border-medflow-400 bg-medflow-50 text-medflow-700"
                        : "border-slate-200 text-slate-600 hover:bg-white"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-medflow-400 border-t-transparent" />
          Loading inventory…
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
                <th className="p-3">Category</th>
                {isCrossAdmin && <th className="p-3">Facility</th>}
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
    </div>
  );
}
