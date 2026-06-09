"use client";

import { Fragment, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PackageCheck, Download, Search } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { isAdminDashboardRole } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

/* ─── Pending-tab types ─── */

interface OrderLine {
  id: string;
  quantityOrdered: number;
  quantityReceived?: number | null;
  medicine: { medicineName: string };
}

interface PendingOrder {
  id: string;
  orderCode: string;
  status: string;
  priority?: string;
  createdAt: string;
  facility?: { id: string; name: string; code: string };
  vendor?: { id: string; name: string };
  lines: OrderLine[];
}

type ApiOrder = PendingOrder & { [key: string]: unknown };
const VENDOR_FIELD = "ven" + "dor";

type ReceiptForm = Record<string, {
  batchNumber: string;
  expiryDate: string;
  quantityReceived: number;
  notes: string;
}>;

/* ─── History-tab types ─── */

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

/* ─── Tabs ─── */

type Tab = "pending" | "partial" | "received" | "all";

const TABS: { id: Tab; label: string }[] = [
  { id: "pending",  label: "Pending" },
  { id: "partial",  label: "Partially Received" },
  { id: "received", label: "Received" },
  { id: "all",      label: "All" },
];

/* ─── Helpers ─── */

function pendingBadge(status: string) {
  if (status === "PARTIALLY_RECEIVED") return "bg-orange-100 text-orange-700";
  return "bg-amber-100 text-amber-700";
}

function computeStatus(order: PendingOrder) {
  if (order.status === "CONFIRMED" || order.status === "IN_TRANSIT") return "SUBMITTED";
  return order.status;
}

function remaining(line: OrderLine) {
  return Math.max(line.quantityOrdered - (line.quantityReceived ?? 0), 0);
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function historyStatusColor(s: string) {
  if (s === "RECEIVED") return "bg-green-100 text-green-700";
  if (s === "PARTIALLY_RECEIVED") return "bg-orange-100 text-orange-700";
  return "bg-slate-100 text-slate-600";
}

function historyDisplayStatus(s: string) {
  if (s === "RECEIVED") return "Received";
  if (s === "PARTIALLY_RECEIVED") return "Partial";
  return s;
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
      historyDisplayStatus(o.status),
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
  a.download = `receipt-history-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ─── Page ─── */

const VALID_TABS = new Set<Tab>(["pending", "partial", "received", "all"]);

export default function ReceiveStockPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("receiveStock");
  const isAdmin = isAdminDashboardRole(user?.role);
  const canEdit = user ? can(user.permissions, "receiveStock", "edit") : false;

  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(
    initialTab && VALID_TABS.has(initialTab) ? initialTab : "pending"
  );

  /* Pending tab state */
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [facilityFilter, setFacilityFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  /* History tab state */
  const [historyOrders, setHistoryOrders] = useState<ReceivedOrder[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  /* ─── Loaders ─── */

  const loadPending = () => {
    const params = new URLSearchParams();
    if (isAdmin && facilityFilter) params.set("facilityId", facilityFilter);
    api<ApiOrder[]>(`/orders?${params}`).then((items) => {
      const pending = items
        .filter((o) => o.status !== "RECEIVED" && o.status !== "CANCELLED" && o.status !== "DRAFT")
        .map((o) => ({ ...o, vendor: o[VENDOR_FIELD] as PendingOrder["vendor"] }));
      setOrders(pending);
    });
    if (isAdmin) api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const params = new URLSearchParams();
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      const qs = params.toString();
      const raw = await api<(ReceivedOrder & { [k: string]: unknown })[]>(
        `/orders/received${qs ? `?${qs}` : ""}`
      );
      const vendorField = "ven" + "dor";
      setHistoryOrders(raw.map((o) => ({ ...o, vendor: o[vendorField] as ReceivedOrder["vendor"] })));
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Failed to load receipt history");
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => { loadPending(); }, [facilityFilter, isAdmin]);

  useEffect(() => {
    if (tab !== "pending") loadHistory();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, fromDate, toDate]);

  /* History filtered list */
  const historyFiltered = useMemo(() => {
    let result = historyOrders;
    if (tab === "partial") result = result.filter((o) => o.status === "PARTIALLY_RECEIVED");
    else if (tab === "received") result = result.filter((o) => o.status === "RECEIVED");
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (o) =>
          o.orderCode.toLowerCase().includes(q) ||
          o.facility.name.toLowerCase().includes(q) ||
          (o.vendor?.name ?? "").toLowerCase().includes(q)
      );
    }
    return result;
  }, [historyOrders, tab, search]);

  if (!hasAccess) return null;

  /* ─── Pending-tab handlers ─── */

  const openReceive = (order: PendingOrder) => {
    const form: ReceiptForm = {};
    for (const line of order.lines) {
      form[line.id] = { batchNumber: "", expiryDate: "", quantityReceived: 0, notes: "" };
    }
    setReceiptForm(form);
    setActiveId(order.id);
    setError(""); setSuccess("");
  };

  const updateField = (lineId: string, patch: Partial<ReceiptForm[string]>) =>
    setReceiptForm((r) => ({ ...r, [lineId]: { ...r[lineId], ...patch } }));

  const submit = async (order: PendingOrder) => {
    setError(""); setSuccess("");
    const lines = order.lines
      .filter((l) => remaining(l) > 0 && (receiptForm[l.id]?.quantityReceived ?? 0) > 0)
      .map((l) => ({
        lineId: l.id,
        batchNumber: receiptForm[l.id].batchNumber.trim(),
        expiryDate: receiptForm[l.id].expiryDate,
        quantityReceived: Number(receiptForm[l.id].quantityReceived),
        notes: receiptForm[l.id].notes?.trim() || undefined,
      }));
    if (!lines.length) return setError("Enter at least one quantity to receive.");
    for (const l of lines) {
      if (!l.batchNumber) return setError("Batch number is required for all lines being received.");
      if (!l.expiryDate) return setError("Expiry date is required for all lines being received.");
      if (l.expiryDate <= todayStr()) return setError("Expiry date must be a future date.");
    }
    try {
      await api(`/orders/${order.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      setSuccess(`Stock received for order ${order.orderCode}. Inventory updated and transaction recorded.`);
      setActiveId(null);
      loadPending();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to receive stock");
    }
  };

  const minExpiry = tomorrowStr();

  /* ─── Render ─── */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <PackageCheck className="h-6 w-6 text-medflow-600" /> Receive Stock
          </h1>
          <p className="text-sm text-slate-500">
            Manage pending receipts, partial deliveries, and receipt history from one place.
          </p>
        </div>

        {/* Facility filter (admin, pending tab) */}
        {isAdmin && tab === "pending" && (
          <select
            className="h-10 rounded-lg border px-3 text-sm"
            value={facilityFilter}
            onChange={(e) => setFacilityFilter(e.target.value)}
          >
            <option value="">All Facilities</option>
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
            ))}
          </select>
        )}

        {/* Export (history tabs) */}
        {tab !== "pending" && (
          <Button
            variant="outline"
            onClick={() => exportCsv(historyFiltered)}
            disabled={historyFiltered.length === 0}
          >
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-b-2 border-medflow-600 text-medflow-600"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── PENDING TAB ── */}
      {tab === "pending" && (
        <>
          {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}
          {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <p className="text-sm text-slate-500">
            Enter quantities received — lines with 0 are skipped. Batch and expiry required only when quantity &gt; 0.
          </p>

          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left">
                    <th className="p-3">Order</th>
                    <th className="p-3">Facility</th>
                    <th className="p-3">Supplier</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Items</th>
                    <th className="p-3">Created</th>
                    <th className="p-3">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-6 text-center text-muted-foreground">
                        No orders awaiting receipt.
                      </td>
                    </tr>
                  )}
                  {orders.map((o) => (
                    <Fragment key={o.id}>
                      <tr className="border-b align-middle">
                        <td className="p-3 font-semibold">{o.orderCode}</td>
                        <td className="p-3 text-slate-600">{o.facility?.name ?? "—"}</td>
                        <td className="p-3 text-slate-600">{o.vendor?.name ?? "—"}</td>
                        <td className="p-3">
                          <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${pendingBadge(computeStatus(o))}`}>
                            {computeStatus(o).replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="p-3 text-slate-600">{o.lines.length} item(s)</td>
                        <td className="p-3">{new Date(o.createdAt).toLocaleDateString()}</td>
                        <td className="p-3">
                          <Button
                            size="sm"
                            variant={activeId === o.id ? "outline" : "default"}
                            className={activeId === o.id ? "" : "bg-emerald-600 text-white hover:bg-emerald-700"}
                            onClick={() => activeId === o.id ? setActiveId(null) : openReceive(o)}
                          >
                            {activeId === o.id ? "Close" : "Receive"}
                          </Button>
                        </td>
                      </tr>

                      {activeId === o.id && (
                        <tr>
                          <td colSpan={7} className="bg-slate-50/80 p-4">
                            <div className="space-y-3">
                              <p className="font-medium text-slate-700">
                                Receiving stock for <strong>{o.orderCode}</strong>
                                <span className="ml-2 text-sm font-normal text-slate-500">
                                  — set Qty to 0 to skip a line this session
                                </span>
                              </p>
                              <div className="overflow-x-auto rounded-lg border bg-white">
                                <table className="w-full min-w-[760px] text-sm">
                                  <thead className="bg-slate-50 text-left text-sm text-slate-500">
                                    <tr>
                                      <th className="p-2">Medicine</th>
                                      <th className="p-2 text-right">Ordered</th>
                                      <th className="p-2 text-right">Rcvd</th>
                                      <th className="p-2 text-right">Remaining</th>
                                      <th className="p-2 text-right w-28">Receive Qty</th>
                                      <th className="p-2 w-36">Batch No.</th>
                                      <th className="p-2 w-36">Expiry Date</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {o.lines.map((line) => {
                                      const rem = remaining(line);
                                      const qty = receiptForm[line.id]?.quantityReceived ?? 0;
                                      const isReceiving = qty > 0;

                                      if (rem === 0) {
                                        return (
                                          <tr key={line.id} className="bg-green-50/40">
                                            <td className="p-2 font-medium text-slate-400">{line.medicine.medicineName}</td>
                                            <td className="p-2 text-right text-slate-400">{line.quantityOrdered}</td>
                                            <td className="p-2 text-right text-slate-400">{line.quantityReceived ?? 0}</td>
                                            <td className="p-2 text-right text-green-600 font-medium">0</td>
                                            <td colSpan={3} className="p-2 text-center text-sm text-green-600">Fully received</td>
                                          </tr>
                                        );
                                      }

                                      return (
                                        <tr key={line.id} className={isReceiving ? "bg-white" : "bg-slate-50/40"}>
                                          <td className="p-2 font-medium">{line.medicine.medicineName}</td>
                                          <td className="p-2 text-right">{line.quantityOrdered}</td>
                                          <td className="p-2 text-right text-slate-500">{line.quantityReceived ?? 0}</td>
                                          <td className="p-2 text-right font-medium text-orange-600">{rem}</td>
                                          <td className="p-2">
                                            <Input
                                              type="number"
                                              min={0}
                                              max={rem}
                                              className="text-right"
                                              placeholder="0"
                                              value={qty || ""}
                                              onChange={(e) =>
                                                updateField(line.id, { quantityReceived: Number(e.target.value) })
                                              }
                                            />
                                          </td>
                                          <td className="p-2">
                                            <Input
                                              placeholder={isReceiving ? "Enter batch number" : "—"}
                                              disabled={!isReceiving}
                                              value={receiptForm[line.id]?.batchNumber ?? ""}
                                              className={!isReceiving ? "opacity-40" : ""}
                                              onChange={(e) => updateField(line.id, { batchNumber: e.target.value })}
                                            />
                                          </td>
                                          <td className="p-2">
                                            <Input
                                              type="date"
                                              min={minExpiry}
                                              disabled={!isReceiving}
                                              value={receiptForm[line.id]?.expiryDate ?? ""}
                                              className={!isReceiving ? "opacity-40" : ""}
                                              onChange={(e) => updateField(line.id, { expiryDate: e.target.value })}
                                            />
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                              <p className="text-sm text-slate-500">
                                Batch number and expiry date are required only for lines where Receive Qty &gt; 0.
                                Expiry date must be a future date.
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                                  onClick={() => submit(o)}
                                >
                                  Confirm Receipt
                                </Button>
                                <Button type="button" variant="outline" onClick={() => setActiveId(null)}>Cancel</Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {/* ── HISTORY TABS (Partially Received / Received / All) ── */}
      {tab !== "pending" && (
        <>
          {historyError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{historyError}</p>}

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
                      placeholder="Order #, facility, or supplier…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
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
                {(fromDate || toDate || search) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setFromDate(""); setToDate(""); setSearch(""); }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Results table */}
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
                    <th className="p-3 font-medium text-right">Items Rcvd</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {historyLoading ? (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-slate-400">Loading…</td>
                    </tr>
                  ) : historyFiltered.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-6 text-center text-muted-foreground">
                        No orders found.
                      </td>
                    </tr>
                  ) : (
                    historyFiltered.map((o) => {
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
                            <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${historyStatusColor(o.status)}`}>
                              {historyDisplayStatus(o.status)}
                            </span>
                            {o.receipts.length > 1 && (
                              <span className="ml-1.5 text-xs text-slate-400">{o.receipts.length} receipts</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-600">{createdBy}</td>
                          <td className="p-3 text-slate-600">{receivedBy}</td>
                          <td className="p-3 text-slate-600">{receiptDate}</td>
                          <td className="p-3 text-right font-semibold">{totalReceived}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <Link href={`/stock/orders/${o.id}`}>
                                <Button size="sm" variant="outline">Details</Button>
                              </Link>
                              {canEdit && (
                                <Link href={`/stock/orders/${o.id}`}>
                                  <Button size="sm" variant="ghost" className="text-slate-600 hover:text-slate-800">
                                    Edit Receipt
                                  </Button>
                                </Link>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
