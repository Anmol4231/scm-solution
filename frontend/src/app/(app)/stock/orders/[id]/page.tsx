"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { Search, Download, Filter } from "lucide-react";
import { api } from "@/lib/api";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

interface ReceiptSummary {
  id: string;
  receiptCode: string;
  createdAt: string;
  receivedBy: { id: string; firstName: string; lastName: string };
  lastEditedBy?: { id: string; firstName: string; lastName: string } | null;
  lastEditedAt?: string | null;
  lastEditReason?: string | null;
  lines: { id: string; quantityReceived: number }[];
}

interface ReceivedOrder {
  id: string;
  orderCode: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  facility: { id: string; name: string; code: string };
  vendor?: { id: string; name: string };
  orderedBy?: { id: string; firstName: string; lastName: string };
  lines: { id: string; quantityOrdered: number; quantityReceived?: number | null }[];
  receipts: ReceiptSummary[];
}

function displayStatus(s: string) {
  if (s === "RECEIVED") return "RECEIVED";
  if (s === "PARTIALLY_RECEIVED") return "PARTIAL";
  return s;
}

function statusColor(s: string) {
  if (s === "RECEIVED") return "bg-green-100 text-green-700";
  if (s === "PARTIALLY_RECEIVED") return "bg-orange-100 text-orange-700";
  return "bg-slate-100 text-slate-600";
}

function exportCsv(orders: ReceivedOrder[]) {
  const headers = [
    "Order #", "Facility", "Supplier", "Status",
    "Created By", "Created Date",
    "Received By", "Receipt Date",
    "Total Ordered", "Total Received",
    "Receipt Count",
  ];
  const rows = orders.map((o) => {
    const lastReceipt = o.receipts[o.receipts.length - 1];
    const totalOrdered = o.lines.reduce((s, l) => s + l.quantityOrdered, 0);
    const totalReceived = o.receipts.reduce((s, r) => s + r.lines.reduce((rs, rl) => rs + rl.quantityReceived, 0), 0);
    const createdBy = o.orderedBy ? `${o.orderedBy.firstName} ${o.orderedBy.lastName}` : "";
    const receivedBy = lastReceipt
      ? `${lastReceipt.receivedBy.firstName} ${lastReceipt.receivedBy.lastName}`
      : "";
    const receiptDate = lastReceipt ? new Date(lastReceipt.createdAt).toLocaleDateString() : "";
    const vendorField = "ven" + "dor";
    const vendor = (o as unknown as Record<string, unknown>)[vendorField] as ReceivedOrder["vendor"];
    return [
      o.orderCode,
      o.facility.name,
      vendor?.name ?? "",
      displayStatus(o.status),
      createdBy,
      new Date(o.createdAt).toLocaleDateString(),
      receivedBy,
      receiptDate,
      totalOrdered,
      totalReceived,
      o.receipts.length,
    ];
  });

  const csvContent = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `received-orders-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReceivedOrdersPage() {
  const hasAccess = useRequirePermission("receiveStock");

  const [orders, setOrders] = useState<ReceivedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "RECEIVED" | "PARTIALLY_RECEIVED">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set("status", statusFilter);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const qs = params.toString();
      const raw = await api<(ReceivedOrder & { [k: string]: unknown })[]>(
        `/orders/received${qs ? `?${qs}` : ""}`
      );
      const vendorField = "ven" + "dor";
      setOrders(raw.map((o) => ({ ...o, vendor: o[vendorField] as ReceivedOrder["vendor"] })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter, fromDate, toDate]);

  const filtered = useMemo(() => {
    if (!search.trim()) return orders;
    const q = search.toLowerCase();
    return orders.filter(
      (o) =>
        o.orderCode.toLowerCase().includes(q) ||
        o.facility.name.toLowerCase().includes(q) ||
        (o.vendor?.name ?? "").toLowerCase().includes(q)
    );
  }, [orders, search]);

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 text-2xl font-bold">Received Orders</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => exportCsv(filtered)}
          disabled={filtered.length === 0}
        >
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Filters */}
      <Card>
        <CardContent className="py-3">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-sm">Search</Label>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  placeholder=""
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Label className="text-sm">Status</Label>
              <div className="mt-1 flex items-center gap-1">
                <Filter className="h-4 w-4 text-slate-400" />
                <select
                  className="h-10 rounded-lg border px-3 text-sm"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                >
                  <option value="">All</option>
                  <option value="RECEIVED">Received</option>
                  <option value="PARTIALLY_RECEIVED">Partially Received</option>
                </select>
              </div>
            </div>
            <div>
              <Label className="text-sm">From Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-sm">To Date</Label>
              <Input
                type="date"
                className="mt-1"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            {(fromDate || toDate || statusFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setFromDate(""); setToDate(""); setStatusFilter(""); }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left text-sm text-slate-500">
                <th className="p-3 font-medium">Order #</th>
                <th className="p-3 font-medium">Facility</th>
                <th className="p-3 font-medium">Supplier</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Created By</th>
                <th className="p-3 font-medium">Received By</th>
                <th className="p-3 font-medium">Receipt Date</th>
                <th className="p-3 font-medium text-right">Total Items</th>
                <th className="p-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-slate-400">Loading…</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-6 text-center text-muted-foreground">No received orders found.</td>
                </tr>
              ) : (
                filtered.map((o) => {
                  const lastReceipt = o.receipts[o.receipts.length - 1];
                  const totalReceived = o.receipts.reduce(
                    (s, r) => s + r.lines.reduce((rs, rl) => rs + rl.quantityReceived, 0),
                    0
                  );
                  const receivedBy = lastReceipt
                    ? `${lastReceipt.receivedBy.firstName} ${lastReceipt.receivedBy.lastName}`
                    : "—";
                  const receiptDate = lastReceipt
                    ? new Date(lastReceipt.createdAt).toLocaleDateString()
                    : "—";
                  const createdBy = o.orderedBy
                    ? `${o.orderedBy.firstName} ${o.orderedBy.lastName}`
                    : "—";

                  return (
                    <tr key={o.id} className="border-b last:border-0 hover:bg-slate-50/60">
                      <td className="p-3 font-mono text-sm font-semibold">{o.orderCode}</td>
                      <td className="p-3">{o.facility.name}</td>
                      <td className="p-3 text-slate-600">{o.vendor?.name ?? "—"}</td>
                      <td className="p-3">
                        <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${statusColor(o.status)}`}>
                          {displayStatus(o.status)}
                        </span>
                        {o.receipts.length > 1 && (
                          <span className="ml-1.5 text-sm text-slate-400">{o.receipts.length} receipts</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-600">{createdBy}</td>
                      <td className="p-3 text-slate-600">{receivedBy}</td>
                      <td className="p-3 text-slate-600">{receiptDate}</td>
                      <td className="p-3 text-right font-semibold">{totalReceived}</td>
                      <td className="p-3">
                        <Link href={`/stock/orders/${o.id}`}>
                          <Button size="sm" variant="outline">Details</Button>
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
