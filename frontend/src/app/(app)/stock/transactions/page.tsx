"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, ArrowUpDown } from "lucide-react";
import { api } from "@/lib/api";
import { useMedicines } from "@/lib/medicines-cache";
import { dateInputMin, dateInputMax } from "@/lib/datetime";
import { DateInput } from "@/components/ui/date-input";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { downloadAuthenticatedFile } from "@/lib/download";

interface Tx {
  id: string;
  type: string;
  quantity: number;
  balanceAfter: number | null;
  reason: string | null;
  notes: string | null;
  createdAt: string;
  facilityId: string;
  medicine: { id: string; medicineName: string } | null;
  batch: { batchNumber: string; expiryDate: string } | null;
  performedBy: { firstName: string; lastName: string } | null;
  facility: { id: string; name: string; code: string } | null;
  sourceFacility: { id: string; name: string; code: string } | null;
  destinationFacility: { id: string; name: string; code: string } | null;
}

interface TxResponse { total: number; skip: number; take: number; transactions: Tx[] }

const TYPE_COLORS: Record<string, string> = {
  RECEIPT: "bg-emerald-100 text-emerald-700",
  CONSUMPTION: "bg-orange-100 text-orange-700",
  ADJUSTMENT: "bg-slate-100 text-slate-600",
  DISPENSING: "bg-blue-100 text-blue-700",
  EXPIRED: "bg-red-100 text-red-700",
  RETURN_IN: "bg-teal-100 text-teal-700",
  RETURN_OUT: "bg-rose-100 text-rose-700",
  TRANSFER_OUT: "bg-violet-100 text-violet-700",
  TRANSFER_IN: "bg-cyan-100 text-cyan-700",
};

const ALL_TYPES = ["RECEIPT", "CONSUMPTION", "ADJUSTMENT", "DISPENSING", "EXPIRED", "RETURN_IN", "RETURN_OUT", "TRANSFER_OUT", "TRANSFER_IN"];
const PAGE_SIZE = 50;

type SortField = "createdAt" | "type" | "medicine" | "facility" | "destination" | "batch" | "quantity" | "balanceAfter" | "reason" | "performedBy";

export default function TransactionsPage() {
  const { user } = useAuth();
  const isAdmin = isAdminDashboardRole(user?.role);

  const [data, setData] = useState<TxResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [type, setType] = useState("");
  const [medicineId, setMedicineId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [facilityId, setFacilityId] = useState("");
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const { data: medicines = [] } = useMedicines();

  // Sorting
  const [sortBy, setSortBy] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (field: SortField) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("asc"); }
    setPage(0);
  };
  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button type="button" onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 font-medium hover:text-medflow-700">
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${sortBy === field ? "text-medflow-600" : "text-slate-300"}`} />
    </button>
  );

  useEffect(() => {
    if (isAdmin) api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
  }, [isAdmin]);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ skip: String(page * PAGE_SIZE), take: String(PAGE_SIZE) });
    if (type) params.set("type", type);
    if (medicineId) params.set("medicineId", medicineId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (isAdmin && facilityId) params.set("facilityId", facilityId);
    params.set("sortBy", sortBy);
    params.set("sortDir", sortDir);
    api<TxResponse>(`/stock/transactions?${params}`)
      .then(setData)
      .finally(() => setLoading(false));
  }, [type, medicineId, from, to, facilityId, isAdmin, page, sortBy, sortDir]);

  useEffect(() => { load(); }, [load]);

  // Build the active filter params (no pagination) — shared by the export request.
  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (medicineId) params.set("medicineId", medicineId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (isAdmin && facilityId) params.set("facilityId", facilityId);
    return params;
  }, [type, medicineId, from, to, facilityId, isAdmin]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadAuthenticatedFile(`/stock/transactions/export?${buildFilterParams()}`, `transactions-${date}.csv`);
    } finally {
      setExporting(false);
    }
  };

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 text-2xl font-bold">Transaction History</h1>
          <p className="text-sm text-slate-500">Immutable ledger of all stock movements</p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting || (data?.total ?? 0) === 0}>
          <Download className="mr-1.5 h-3.5 w-3.5" />
          {exporting ? "Exporting…" : "Export CSV"}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-slate-50 p-3">
        {isAdmin && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">Facility</label>
            <select value={facilityId} onChange={(e) => { setFacilityId(e.target.value); setPage(0); }} className="h-9 rounded-lg border bg-white px-2 text-sm">
              <option value="">All Facilities</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">Type</label>
          <select value={type} onChange={(e) => { setType(e.target.value); setPage(0); }} className="h-9 rounded-lg border bg-white px-2 text-sm">
            <option value="">All Types</option>
            {ALL_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">Product</label>
          <select value={medicineId} onChange={(e) => { setMedicineId(e.target.value); setPage(0); }} className="h-9 rounded-lg border bg-white px-2 text-sm">
            <option value="">All Products</option>
            {medicines.map((m) => <option key={m.id} value={m.id}>{m.medicineName}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="txn-from" className="mb-1 block text-sm font-medium text-slate-600">From</label>
          <DateInput id="txn-from" value={from} min={dateInputMin()} max={to || dateInputMax()} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="h-9 w-36" />
        </div>
        <div>
          <label htmlFor="txn-to" className="mb-1 block text-sm font-medium text-slate-600">To</label>
          <DateInput id="txn-to" value={to} min={from || dateInputMin()} max={dateInputMax()} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="h-9 w-36" />
        </div>
        <button
          type="button"
          onClick={() => { setType(""); setMedicineId(""); setFrom(""); setTo(""); setFacilityId(""); setPage(0); }}
          className="h-9 self-end rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-white"
        >
          Clear
        </button>
      </div>

      {data && (
        <p className="text-sm text-slate-500">
          {data.total} transaction{data.total !== 1 ? "s" : ""} · showing {data.skip + 1}–{Math.min(data.skip + PAGE_SIZE, data.total)}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b bg-slate-50 text-sm text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium"><SortButton field="createdAt" label="Date & Time" /></th>
              <th className="px-3 py-2 text-left font-medium"><SortButton field="type" label="Type" /></th>
              <th className="px-3 py-2 text-left font-medium"><SortButton field="medicine" label="Medicine" /></th>
              {isAdmin && <th className="px-3 py-2 text-left font-medium"><SortButton field="facility" label="Facility" /></th>}
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap"><SortButton field="destination" label="Destination Facility" /></th>
              <th className="px-3 py-2 text-left font-medium"><SortButton field="batch" label="Batch" /></th>
              <th className="px-3 py-2 text-center font-medium"><div className="flex justify-center"><SortButton field="quantity" label="Qty" /></div></th>
              <th className="px-3 py-2 text-center font-medium"><div className="flex justify-center"><SortButton field="balanceAfter" label="Balance After" /></div></th>
              <th className="px-3 py-2 text-left font-medium"><SortButton field="reason" label="Reason" /></th>
              <th className="px-3 py-2 text-left font-medium"><SortButton field="performedBy" label="Performed By" /></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              <SkeletonRows rows={8} cols={isAdmin ? 10 : 9} />
            ) : !data?.transactions.length ? (
              <tr><td colSpan={isAdmin ? 10 : 9} className="py-8 text-center text-slate-400">No transactions found.</td></tr>
            ) : (
              data.transactions.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500 text-sm">{new Date(t.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${TYPE_COLORS[t.type] ?? "bg-slate-100 text-slate-600"}`}>
                      {t.type.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{t.medicine?.medicineName ?? "—"}</td>
                  {isAdmin && <td className="px-3 py-2 text-slate-600 text-sm">{t.facility?.name ?? "—"}</td>}
                  <td className="px-3 py-2 text-slate-600 text-sm">{t.destinationFacility?.name ?? "—"}</td>
                  <td className="px-3 py-2 font-mono text-sm text-slate-500">{t.batch?.batchNumber ?? "—"}</td>
                  <td className={`px-3 py-2 text-center font-semibold ${t.quantity < 0 ? "text-red-600" : "text-emerald-600"}`}>
                    {t.quantity > 0 ? `+${t.quantity}` : t.quantity}
                  </td>
                  <td className="px-3 py-2 text-center text-slate-600">{t.balanceAfter ?? "—"}</td>
                  <td className="px-3 py-2 text-sm text-slate-500 max-w-[160px] truncate" title={t.reason ?? t.notes ?? ""}>{t.reason ?? t.notes ?? "—"}</td>
                  <td className="px-3 py-2 text-sm text-slate-500">{t.performedBy ? `${t.performedBy.firstName} ${t.performedBy.lastName}` : "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
          <span className="text-sm text-slate-600">Page {page + 1} of {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
}
