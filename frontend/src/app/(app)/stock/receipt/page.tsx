"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { PackageCheck, PackagePlus, Eye, Download, Search, CalendarDays, X, ArrowUpDown } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { isAdminDashboardRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { formatDateTime, dateInputMin, dateInputMax } from "@/lib/datetime";
import { DateInput } from "@/components/ui/date-input";

interface OrderLine {
  id: string;
  quantityOrdered: number;
  quantityReceived?: number | null;
}

interface Order {
  id: string;
  orderCode: string;
  status: string;
  createdAt: string;
  facility?: { id: string; name: string; code: string };
  vendor?: { id: string; name: string };
  orderedBy?: { firstName: string; lastName: string };
  lines: OrderLine[];
  receipts?: { lines: { quantityReceived: number }[] }[];
}

type StatusFilter = "all" | "SUBMITTED" | "RECEIVED";
type SortField = "orderCode" | "facility" | "supplier" | "status" | "items" | "createdAt";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All Orders" },
  { id: "SUBMITTED", label: "Awaiting Receipt" },
  { id: "RECEIVED", label: "Received" },
];

const VFIELD = "ven" + "dor";

function normalizeStatus(s: string) {
  if (s === "CONFIRMED" || s === "IN_TRANSIT") return "SUBMITTED";
  return s;
}

function statusLabel(s: string) {
  const ns = normalizeStatus(s);
  if (ns === "SUBMITTED") return "Awaiting Receipt";
  if (ns === "PARTIALLY_RECEIVED") return "Partially Received";
  if (ns === "RECEIVED") return "Received";
  return ns.replace(/_/g, " ");
}

function statusColor(s: string) {
  const ns = normalizeStatus(s);
  if (ns === "RECEIVED") return "bg-green-100 text-green-700";
  if (ns === "PARTIALLY_RECEIVED") return "bg-orange-100 text-orange-700";
  return "bg-amber-100 text-amber-700";
}

function exportCsv(orders: Order[]) {
  const headers = ["Order #", "Facility", "Supplier", "Status", "Created Date", "Items"];
  const rows = orders.map((o) => [
    o.orderCode,
    o.facility?.name ?? "",
    o.vendor?.name ?? "",
    statusLabel(o.status),
    formatDateTime(o.createdAt),
    o.lines.length,
  ]);
  const csv = [headers, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `receive-stock-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReceiveStockPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("receiveStock");
  const isAdmin = isAdminDashboardRole(user?.role);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [facilityFilter, setFacilityFilter] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const toggleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("asc");
    }
  };

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (isAdmin && facilityFilter) params.set("facilityId", facilityFilter);
      const qs = params.toString();

      const [pending, received] = await Promise.all([
        api<(Order & { [k: string]: unknown })[]>(`/orders${qs ? `?${qs}` : ""}`),
        api<(Order & { [k: string]: unknown })[]>(`/orders/received${qs ? `?${qs}` : ""}`),
      ]);

      const map = new Map<string, Order>();
      for (const o of pending) {
        map.set(o.id, { ...o, vendor: o[VFIELD] as Order["vendor"] });
      }
      for (const o of received) {
        map.set(o.id, { ...o, vendor: o[VFIELD] as Order["vendor"] });
      }

      setOrders(
        Array.from(map.values())
          .filter((o) => o.status !== "DRAFT" && o.status !== "CANCELLED")
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [facilityFilter, isAdmin]);

  useEffect(() => {
    if (isAdmin) {
      api<{ id: string; name: string; code: string }[]>("/auth/facilities")
        .then(setFacilities)
        .catch(() => {});
    }
  }, [isAdmin]);

  const filtered = useMemo(() => {
    let result = orders;
    if (statusFilter !== "all") {
      result = result.filter((o) => normalizeStatus(o.status) === statusFilter);
    }
    if (fromDate) {
      const from = new Date(`${fromDate}T00:00:00`).getTime();
      result = result.filter((o) => new Date(o.createdAt).getTime() >= from);
    }
    if (toDate) {
      const to = new Date(`${toDate}T23:59:59.999`).getTime();
      result = result.filter((o) => new Date(o.createdAt).getTime() <= to);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.orderCode.toLowerCase().includes(q) ||
          (o.facility?.name ?? "").toLowerCase().includes(q) ||
          (o.vendor?.name ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [orders, statusFilter, fromDate, toDate, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "orderCode": cmp = a.orderCode.localeCompare(b.orderCode); break;
        case "facility": cmp = (a.facility?.name ?? "").localeCompare(b.facility?.name ?? ""); break;
        case "supplier": cmp = (a.vendor?.name ?? "").localeCompare(b.vendor?.name ?? ""); break;
        case "status": cmp = statusLabel(a.status).localeCompare(statusLabel(b.status)); break;
        case "items": cmp = a.lines.length - b.lines.length; break;
        case "createdAt": cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break;
      }
      return cmp * dir;
    });
  }, [filtered, sortBy, sortDir]);

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button
      type="button"
      onClick={() => toggleSort(field)}
      className="inline-flex items-center gap-1 font-medium hover:text-medflow-700"
    >
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${sortBy === field ? "text-medflow-600" : "text-slate-300"}`} />
    </button>
  );

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <PackageCheck className="h-6 w-6 text-medflow-600" /> Receive Stock
          </h1>
          <p className="text-sm text-slate-500">
            Receive orders, manage partial deliveries, and view receipt history from a single page.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => exportCsv(sorted)}
          disabled={sorted.length === 0}
        >
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-wrap items-center gap-1.5 self-center">
              {STATUS_FILTERS.map((f) => {
                const active = statusFilter === f.id;
                const activeClass =
                  f.id === "all" ? "bg-slate-700 text-white" :
                  f.id === "SUBMITTED" ? "bg-amber-600 text-white" :
                  "bg-green-600 text-white";
                const inactiveClass =
                  f.id === "all" ? "bg-slate-100 text-slate-700 hover:bg-slate-200" :
                  f.id === "SUBMITTED" ? "bg-amber-50 text-amber-700 hover:bg-amber-100" :
                  "bg-green-50 text-green-700 hover:bg-green-100";
                return (
                  <button
                    key={f.id}
                    onClick={() => setStatusFilter(f.id)}
                    className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${active ? activeClass : inactiveClass}`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {/* Unified date-range control */}
            <div className="flex h-10 items-center gap-2 self-center rounded-lg border border-input bg-background px-3">
              <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
              <DateInput
                bare
                aria-label="From date"
                className="w-[100px]"
                value={fromDate}
                min={dateInputMin()}
                max={toDate || dateInputMax()}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <span className="text-slate-400">→</span>
              <DateInput
                bare
                aria-label="To date"
                className="w-[100px]"
                value={toDate}
                min={fromDate || dateInputMin()}
                max={dateInputMax()}
                onChange={(e) => setToDate(e.target.value)}
              />
              {(fromDate || toDate) && (
                <button
                  type="button"
                  aria-label="Clear dates"
                  className="text-slate-400 hover:text-slate-600"
                  onClick={() => { setFromDate(""); setToDate(""); }}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="relative min-w-[180px] flex-1 self-center">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                className="pl-9"
                placeholder="Order #, facility, or supplier…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {isAdmin && (
              <select
                className="h-10 self-center rounded-lg border bg-white px-3 text-sm"
                value={facilityFilter}
                onChange={(e) => setFacilityFilter(e.target.value)}
              >
                <option value="">All Facilities</option>
                {facilities.map((f) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
                ))}
              </select>
            )}

            <button
              type="button"
              onClick={() => { setSearch(""); setFromDate(""); setToDate(""); setStatusFilter("all"); }}
              className="h-9 self-center rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-white"
            >
              Clear
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Orders table */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[650px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-sm text-slate-500">
                <th className="p-3 font-medium"><SortButton field="orderCode" label="Order #" /></th>
                <th className="p-3 font-medium"><SortButton field="facility" label="Facility" /></th>
                <th className="p-3 font-medium"><SortButton field="supplier" label="Supplier" /></th>
                <th className="p-3 font-medium"><SortButton field="status" label="Status" /></th>
                <th className="p-3 font-medium"><SortButton field="items" label="Items" /></th>
                <th className="p-3 font-medium"><SortButton field="createdAt" label="Created On" /></th>
                <th className="p-3 font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={6} cols={7} />
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-muted-foreground">
                    No orders found.
                  </td>
                </tr>
              ) : (
                sorted.map((o) => {
                  const canReceiveMore = normalizeStatus(o.status) !== "RECEIVED";
                  return (
                    <tr key={o.id} className="border-b last:border-0 hover:bg-slate-50/60">
                      <td className="p-3 font-mono font-semibold">{o.orderCode}</td>
                      <td className="p-3">{o.facility?.name ?? "—"}</td>
                      <td className="p-3 text-slate-600">{o.vendor?.name ?? "—"}</td>
                      <td className="p-3">
                        <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${statusColor(o.status)}`}>
                          {statusLabel(o.status)}
                        </span>
                      </td>
                      <td className="p-3 text-slate-600">{o.lines.length} item(s)</td>
                      <td className="p-3 text-slate-600 whitespace-nowrap">{formatDateTime(o.createdAt)}</td>
                      <td className="p-3">
                        <Link
                          href={`/stock/receipt/${o.id}`}
                          title={canReceiveMore ? "Receive stock" : "View receipt"}
                          className={`inline-flex rounded p-1.5 ${
                            canReceiveMore
                              ? "text-emerald-600 hover:bg-emerald-50"
                              : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          }`}
                        >
                          {canReceiveMore ? <PackagePlus className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
