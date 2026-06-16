"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { PackageCheck, Printer } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime, formatDate } from "@/lib/datetime";

interface ReceiptLine {
  id: string;
  medicine: { id: string; medicineName: string };
  quantityReceived: number;
  batchNumber: string;
  expiryDate: string;
  notes?: string | null;
  batch?: { id: string; quantity: number } | null;
}

interface Receipt {
  id: string;
  receiptCode: string;
  createdAt: string;
  notes?: string | null;
  receivedBy: { id: string; firstName: string; lastName: string };
  lastEditedBy?: { id: string; firstName: string; lastName: string } | null;
  lastEditedAt?: string | null;
  lastEditReason?: string | null;
  lines: ReceiptLine[];
}

interface OrderLine {
  id: string;
  quantityOrdered: number;
  quantityReceived?: number | null;
  notes?: string | null;
  medicine: { id: string; medicineName: string };
}

interface StockOrder {
  id: string;
  orderCode: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  facility?: { id: string; name: string; code: string };
  vendor?: { id: string; name: string };
  orderedBy?: { id: string; firstName: string; lastName: string };
  lines: OrderLine[];
  receipts: Receipt[];
}

type ReceiveFormLine = { batchNumber: string; expiryDate: string; quantityReceived: number; notes: string };
type EditFormLine = { lineId: string; quantityReceived: number; batchNumber: string; expiryDate: string; notes: string };

interface AuditLineChange {
  lineId: string;
  medicine: string;
  previous: { quantityReceived: number; batchNumber: string; expiryDate: string };
  current: { quantityReceived: number; batchNumber: string; expiryDate: string };
}

interface AuditEntry {
  id: string;
  action: string;
  createdAt: string;
  user?: { id: string; firstName: string; lastName: string } | null;
  details?: { reasonForChange?: string; changes?: AuditLineChange[] } | null;
}

function displayStatus(s: string) {
  if (s === "CONFIRMED" || s === "IN_TRANSIT") return "SUBMITTED";
  return s;
}

function statusLabel(s: string) {
  const ns = displayStatus(s);
  if (ns === "SUBMITTED") return "Awaiting Receipt";
  if (ns === "PARTIALLY_RECEIVED") return "Partially Received";
  if (ns === "RECEIVED") return "Received";
  if (ns === "CANCELLED") return "Cancelled";
  return ns.replace(/_/g, " ");
}

function statusColor(s: string) {
  if (s === "PARTIALLY_RECEIVED") return "bg-orange-100 text-orange-700";
  if (s === "RECEIVED") return "bg-green-100 text-green-700";
  if (s === "CANCELLED") return "bg-slate-100 text-slate-600";
  if (s === "SUBMITTED") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-500";
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

export default function OrderReceivingPage() {
  const params = useParams();
  const orderId = params.id as string;
  const { user } = useAuth();
  const hasAccess = useRequirePermission("receiveStock");

  const canCreate = can(user?.permissions, "receiveStock", "create");
  const canEditReceipt = can(user?.permissions, "receiveStock", "edit");

  const [order, setOrder] = useState<StockOrder | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [receiveForm, setReceiveForm] = useState<Record<string, ReceiveFormLine>>({});
  const [expandedReceiptId, setExpandedReceiptId] = useState<string | null>(null);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ reasonForChange: string; notes: string; lines: EditFormLine[] }>({
    reasonForChange: "",
    notes: "",
    lines: [],
  });
  const [receiptHistory, setReceiptHistory] = useState<Record<string, AuditEntry[]>>({});
  const [showingHistoryId, setShowingHistoryId] = useState<string | null>(null);
  const [loadingHistoryId, setLoadingHistoryId] = useState<string | null>(null);

  const load = async () => {
    try {
      setPageLoading(true);
      const data = await api<StockOrder & { [k: string]: unknown }>(`/orders/${orderId}`);
      const vendorField = "ven" + "dor";
      const loaded: StockOrder = { ...data, vendor: data[vendorField] as StockOrder["vendor"] };
      setOrder(loaded);
      const form: Record<string, ReceiveFormLine> = {};
      for (const line of loaded.lines) {
        form[line.id] = { batchNumber: "", expiryDate: "", quantityReceived: 0, notes: "" };
      }
      setReceiveForm(form);
    } catch {
      setPageError("Failed to load order");
    } finally {
      setPageLoading(false);
    }
  };

  useEffect(() => { if (orderId) load(); }, [orderId]);

  if (!hasAccess) return null;
  if (pageLoading) return <div className="p-8 text-center text-slate-500">Loading…</div>;
  if (!order) return <div className="p-8 text-center text-red-600">{pageError || "Order not found"}</div>;

  const remaining = (line: OrderLine) => Math.max(line.quantityOrdered - (line.quantityReceived ?? 0), 0);
  const status = displayStatus(order.status);
  const canReceiveMore = order.status !== "RECEIVED" && order.status !== "CANCELLED";
  const minExpiry = tomorrowStr();

  const updateReceiveLine = (lineId: string, patch: Partial<ReceiveFormLine>) =>
    setReceiveForm((f) => ({ ...f, [lineId]: { ...f[lineId], ...patch } }));

  const submitReceive = async () => {
    setError(""); setSuccess("");
    const lines = order.lines
      .filter((l) => remaining(l) > 0 && (receiveForm[l.id]?.quantityReceived ?? 0) > 0)
      .map((l) => ({
        lineId: l.id,
        batchNumber: receiveForm[l.id].batchNumber.trim(),
        expiryDate: receiveForm[l.id].expiryDate,
        quantityReceived: Number(receiveForm[l.id].quantityReceived),
        notes: receiveForm[l.id].notes?.trim() || undefined,
      }));
    if (!lines.length) return setError("Enter at least one quantity to receive.");
    for (const l of lines) {
      if (!l.batchNumber) return setError("Batch number is required for all lines being received.");
      if (!l.expiryDate) return setError("Expiry date is required for all lines being received.");
      if (l.expiryDate <= todayStr()) return setError("Expiry date must be a future date.");
    }
    try {
      setSubmitting(true);
      await api(`/orders/${order.id}/receive`, { method: "POST", body: JSON.stringify({ lines }) });
      setSuccess("Stock received successfully. Inventory updated.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to receive stock");
    } finally {
      setSubmitting(false);
    }
  };

  const openReceiptEdit = (receipt: Receipt) => {
    setEditingReceiptId(receipt.id);
    setExpandedReceiptId(null);
    setError(""); setSuccess("");
    setEditForm({
      reasonForChange: "",
      notes: receipt.notes ?? "",
      lines: receipt.lines.map((l) => ({
        lineId: l.id,
        quantityReceived: l.quantityReceived,
        batchNumber: l.batchNumber,
        expiryDate: l.expiryDate ? l.expiryDate.split("T")[0] : "",
        notes: l.notes ?? "",
      })),
    });
  };

  const updateEditLine = (lineId: string, patch: Partial<EditFormLine>) =>
    setEditForm((f) => ({
      ...f,
      lines: f.lines.map((l) => (l.lineId === lineId ? { ...l, ...patch } : l)),
    }));

  const submitEdit = async () => {
    if (!editingReceiptId) return;
    if (!editForm.reasonForChange.trim()) return setError("Reason for change is required");
    setError(""); setSuccess("");
    try {
      await api(`/orders/${orderId}/receipts/${editingReceiptId}`, {
        method: "PATCH",
        body: JSON.stringify({
          reasonForChange: editForm.reasonForChange.trim(),
          notes: editForm.notes || null,
          lines: editForm.lines.map((l) => ({
            lineId: l.lineId,
            quantityReceived: l.quantityReceived,
            batchNumber: l.batchNumber || undefined,
            expiryDate: l.expiryDate || undefined,
            notes: l.notes || null,
          })),
        }),
      });
      setSuccess("Receipt updated successfully.");
      setEditingReceiptId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update receipt");
    }
  };

  const printReceipt = (receipt: Receipt) => {
    const totalItems = receipt.lines.reduce((s, l) => s + l.quantityReceived, 0);
    const editNote = receipt.lastEditedBy
      ? `<div class="edit-note">Edited by ${receipt.lastEditedBy.firstName} ${receipt.lastEditedBy.lastName}${receipt.lastEditedAt ? ` on ${new Date(receipt.lastEditedAt).toLocaleString()}` : ""}${receipt.lastEditReason ? ` — ${receipt.lastEditReason}` : ""}</div>`
      : "";
    const rows = receipt.lines
      .map(
        (l) =>
          `<tr><td>${l.medicine.medicineName}</td><td style="text-align:right;font-weight:700">${l.quantityReceived}</td><td>${l.batchNumber}</td><td>${l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : ""}</td><td>${l.notes ?? ""}</td></tr>`
      )
      .join("");
    const html = `<!DOCTYPE html><html><head><title>Receipt ${receipt.receiptCode}</title><style>
      body{font-family:Arial,sans-serif;padding:28px;color:#111;font-size:13px}
      h1{font-size:18px;margin-bottom:2px}
      .sub{color:#555;margin-bottom:16px}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}
      .meta label{font-weight:700;font-size:10px;text-transform:uppercase;color:#666;display:block}
      table{width:100%;border-collapse:collapse}
      th{background:#f3f4f6;text-align:left;padding:7px 8px;border-bottom:2px solid #d1d5db;font-size:11px;text-transform:uppercase}
      td{padding:7px 8px;border-bottom:1px solid #e5e7eb}
      .total{font-weight:700;text-align:right;margin-top:14px}
      .edit-note{background:#fffbeb;border:1px solid #fbbf24;padding:7px 12px;border-radius:4px;margin-bottom:14px;font-size:12px}
      .footer{margin-top:36px;font-size:10px;color:#9ca3af}
      @media print{body{padding:12px}}
    </style></head><body>
      <h1>Stock Receipt — ${receipt.receiptCode}</h1>
      <p class="sub">Order: ${order!.orderCode} &nbsp;|&nbsp; ${order!.facility?.name ?? ""} &nbsp;|&nbsp; Supplier: ${order!.vendor?.name ?? ""}</p>
      <div class="meta">
        <div><label>Receipt Number</label>${receipt.receiptCode}</div>
        <div><label>Date Received</label>${new Date(receipt.createdAt).toLocaleString()}</div>
        <div><label>Received By</label>${receipt.receivedBy.firstName} ${receipt.receivedBy.lastName}</div>
        <div><label>Total Quantity</label>${totalItems}</div>
      </div>
      ${editNote}
      <table><thead><tr><th>Medicine</th><th style="text-align:right">Qty</th><th>Batch No.</th><th>Expiry Date</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="total">Total: ${totalItems} units</p>
      <div class="footer">Printed ${new Date().toLocaleString()} &nbsp;|&nbsp; MediTrack</div>
      <script>window.onload=()=>window.print();</script>
    </body></html>`;
    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); }
  };

  const toggleReceiptHistory = async (receiptId: string) => {
    if (showingHistoryId === receiptId) { setShowingHistoryId(null); return; }
    if (receiptHistory[receiptId]) { setShowingHistoryId(receiptId); return; }
    try {
      setLoadingHistoryId(receiptId);
      const data = await api<AuditEntry[]>(`/orders/${orderId}/receipts/${receiptId}/history`);
      setReceiptHistory((h) => ({ ...h, [receiptId]: data }));
      setShowingHistoryId(receiptId);
    } catch {
      setReceiptHistory((h) => ({ ...h, [receiptId]: [] }));
      setShowingHistoryId(receiptId);
    } finally {
      setLoadingHistoryId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock/receipt" className="text-sm text-medflow-600 hover:underline">← Receive Stock</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <PackageCheck className="h-6 w-6 text-medflow-600" /> {order.orderCode}
          </h1>
        </div>
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Section A: Order Summary */}
      <Card>
        <CardHeader><CardTitle>Order Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Order Number</p>
              <p className="font-semibold">{order.orderCode}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Facility</p>
              <p className="font-medium">{order.facility?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Supplier</p>
              <p className="font-medium">{order.vendor?.name ?? "—"}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Status</p>
              <span className={`inline-block rounded-full px-2 py-0.5 text-sm font-medium ${statusColor(status)}`}>
                {statusLabel(order.status)}
              </span>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Created By</p>
              <p className="font-medium">
                {order.orderedBy ? `${order.orderedBy.firstName} ${order.orderedBy.lastName}` : "—"}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">Created Date</p>
              <p className="font-medium">{formatDateTime(order.createdAt)}</p>
            </div>
          </div>
          {order.notes && (
            <p className="mt-3 border-t pt-3 text-sm text-slate-600">Notes: {order.notes}</p>
          )}
        </CardContent>
      </Card>

      {/* Section B: Order Lines + Receive Form */}
      <Card>
        <CardHeader>
          <CardTitle>{canReceiveMore ? "Receive Stock" : "Order Lines"}</CardTitle>
          {canReceiveMore && canCreate && (
            <p className="text-sm text-slate-500">
              Enter quantities to receive — lines with 0 are skipped. Batch and expiry required when quantity &gt; 0.
            </p>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: canReceiveMore && canCreate ? "880px" : "480px" }}>
              <thead>
                <tr className="border-b bg-slate-50 text-left text-sm text-slate-500">
                  <th className="p-3">Medicine</th>
                  <th className="p-3 text-right">Ordered Qty</th>
                  <th className="p-3 text-right">Previously Received</th>
                  <th className="p-3 text-right">Remaining Qty</th>
                  {canReceiveMore && canCreate && (
                    <>
                      <th className="p-3 text-right w-28">Receive Qty</th>
                      <th className="p-3 w-44">Batch No.</th>
                      <th className="p-3 w-48">Expiry Date</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y">
                {order.lines.map((line) => {
                  const rem = remaining(line);
                  const formLine = receiveForm[line.id];
                  const qty = formLine?.quantityReceived ?? 0;
                  const isReceiving = qty > 0;

                  return (
                    <tr key={line.id} className={rem === 0 ? "bg-green-50/40" : ""}>
                      <td className="p-3 font-medium">{line.medicine.medicineName}</td>
                      <td className="p-3 text-right">{line.quantityOrdered}</td>
                      <td className="p-3 text-right text-slate-500">{line.quantityReceived ?? 0}</td>
                      <td className={`p-3 text-right font-medium ${rem > 0 ? "text-orange-600" : "text-green-600"}`}>
                        {rem}
                      </td>
                      {canReceiveMore && canCreate && (
                        rem === 0 ? (
                          <td colSpan={3} className="p-3 text-center text-sm text-green-600">
                            Fully received
                          </td>
                        ) : (
                          <>
                            <td className="p-3">
                              <Input
                                type="number"
                                min={0}
                                max={rem}
                                className="text-right"
                                placeholder="0"
                                value={qty || ""}
                                onChange={(e) => updateReceiveLine(line.id, { quantityReceived: Number(e.target.value) })}
                              />
                            </td>
                            <td className="p-3">
                              <Input
                                placeholder={isReceiving ? "Batch number" : "Enter qty first"}
                                disabled={!isReceiving}
                                value={formLine?.batchNumber ?? ""}
                                className="w-full"
                                onChange={(e) => updateReceiveLine(line.id, { batchNumber: e.target.value })}
                              />
                            </td>
                            <td className="p-3">
                              <Input
                                type="date"
                                min={minExpiry}
                                disabled={!isReceiving}
                                value={formLine?.expiryDate ?? ""}
                                className="w-full"
                                aria-label="Expiry date"
                                onChange={(e) => updateReceiveLine(line.id, { expiryDate: e.target.value })}
                              />
                              {isReceiving && formLine?.expiryDate && (
                                <p className="mt-0.5 text-xs text-slate-500">Expires {formatDate(formLine.expiryDate)}</p>
                              )}
                            </td>
                          </>
                        )
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {canReceiveMore && canCreate && (
            <div className="flex gap-2 border-t p-4">
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={submitReceive}
                disabled={submitting}
              >
                {submitting ? "Saving…" : "Confirm Receipt"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section C: Receipt History */}
      <Card>
        <CardHeader><CardTitle>Receipt History</CardTitle></CardHeader>
        <CardContent className="p-0">
          {order.receipts.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No receipts recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[580px] text-sm">
                <thead>
                  <tr className="border-b bg-slate-50 text-left text-sm text-slate-500">
                    <th className="p-3 font-medium">Receipt Number</th>
                    <th className="p-3 font-medium">Date</th>
                    <th className="p-3 font-medium">Received By</th>
                    <th className="p-3 font-medium text-right">Total Items</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {order.receipts.map((receipt) => {
                    const totalItems = receipt.lines.reduce((s, l) => s + l.quantityReceived, 0);
                    const isViewing = expandedReceiptId === receipt.id;
                    const isEditing = editingReceiptId === receipt.id;

                    return (
                      <Fragment key={receipt.id}>
                        <tr className="border-b last:border-0 hover:bg-slate-50/60">
                          <td className="p-3 font-mono font-semibold">
                            {receipt.receiptCode}
                            {receipt.lastEditedBy && (
                              <span className="ml-2 text-xs font-normal text-amber-600">(edited)</span>
                            )}
                          </td>
                          <td className="p-3 text-slate-600 whitespace-nowrap">
                            {formatDateTime(receipt.createdAt)}
                          </td>
                          <td className="p-3 text-slate-600">
                            {receipt.receivedBy.firstName} {receipt.receivedBy.lastName}
                          </td>
                          <td className="p-3 text-right font-semibold">{totalItems}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  if (isViewing) {
                                    setExpandedReceiptId(null);
                                  } else {
                                    setExpandedReceiptId(receipt.id);
                                    setEditingReceiptId(null);
                                  }
                                }}
                              >
                                {isViewing ? "Hide" : "View"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-slate-600 hover:text-slate-800"
                                onClick={() => printReceipt(receipt)}
                                title="Print receipt"
                              >
                                <Printer className="h-3.5 w-3.5 mr-1" /> Print
                              </Button>
                              {canEditReceipt && order.status !== "CANCELLED" && (
                                <Button
                                  size="sm"
                                  variant={isEditing ? "outline" : "ghost"}
                                  className={isEditing ? "" : "text-slate-600 hover:text-slate-800"}
                                  onClick={() => {
                                    if (isEditing) {
                                      setEditingReceiptId(null);
                                    } else {
                                      openReceiptEdit(receipt);
                                    }
                                  }}
                                >
                                  {isEditing ? "Cancel Edit" : "Edit Receipt"}
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* View: expanded read-only lines */}
                        {isViewing && (
                          <tr>
                            <td colSpan={5} className="bg-slate-50/60 p-4">
                              {receipt.lastEditedBy && (
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                  <span>
                                    Last edited by{" "}
                                    <strong>
                                      {receipt.lastEditedBy.firstName} {receipt.lastEditedBy.lastName}
                                    </strong>
                                    {receipt.lastEditedAt && (
                                      <> on <strong>{formatDateTime(receipt.lastEditedAt)}</strong></>
                                    )}
                                    {receipt.lastEditReason && <> — <em>{receipt.lastEditReason}</em></>}
                                  </span>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 border-amber-300 text-amber-800 hover:bg-amber-100"
                                    onClick={() => toggleReceiptHistory(receipt.id)}
                                    disabled={loadingHistoryId === receipt.id}
                                  >
                                    {loadingHistoryId === receipt.id
                                      ? "Loading…"
                                      : showingHistoryId === receipt.id
                                      ? "Hide Edit History"
                                      : "View Edit History"}
                                  </Button>
                                </div>
                              )}

                              {/* Edit history */}
                              {showingHistoryId === receipt.id && receiptHistory[receipt.id] && (
                                <div className="mb-3 space-y-3">
                                  {receiptHistory[receipt.id].length === 0 ? (
                                    <p className="text-sm text-slate-500">No edit history found.</p>
                                  ) : (
                                    receiptHistory[receipt.id].map((entry) => (
                                      <div key={entry.id} className="rounded border border-slate-200 bg-white p-3 text-sm">
                                        <div className="mb-2 flex flex-wrap items-center gap-2 text-slate-600">
                                          <span className="font-medium text-slate-800">
                                            {entry.user ? `${entry.user.firstName} ${entry.user.lastName}` : "Unknown"}
                                          </span>
                                          <span className="text-slate-400">—</span>
                                          <span>{formatDateTime(entry.createdAt)}</span>
                                          {entry.details?.reasonForChange && (
                                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                                              {entry.details.reasonForChange}
                                            </span>
                                          )}
                                        </div>
                                        {entry.details?.changes && entry.details.changes.length > 0 && (
                                          <div className="overflow-x-auto rounded border bg-slate-50">
                                            <table className="w-full min-w-[520px] text-xs">
                                              <thead>
                                                <tr className="border-b bg-slate-100 text-slate-500">
                                                  <th className="p-1.5 text-left font-medium">Medicine</th>
                                                  <th className="p-1.5 text-right font-medium">Qty Before</th>
                                                  <th className="p-1.5 text-right font-medium">Qty After</th>
                                                  <th className="p-1.5 text-left font-medium">Batch Before</th>
                                                  <th className="p-1.5 text-left font-medium">Batch After</th>
                                                  <th className="p-1.5 text-left font-medium">Expiry Before</th>
                                                  <th className="p-1.5 text-left font-medium">Expiry After</th>
                                                </tr>
                                              </thead>
                                              <tbody className="divide-y">
                                                {entry.details.changes.map((ch) => {
                                                  const qtyChanged = ch.previous.quantityReceived !== ch.current.quantityReceived;
                                                  const batchChanged = ch.previous.batchNumber !== ch.current.batchNumber;
                                                  const expiryChanged = ch.previous.expiryDate !== ch.current.expiryDate;
                                                  return (
                                                    <tr key={ch.lineId}>
                                                      <td className="p-1.5 font-medium">{ch.medicine}</td>
                                                      <td className={`p-1.5 text-right ${qtyChanged ? "text-red-600 line-through" : "text-slate-500"}`}>
                                                        {ch.previous.quantityReceived}
                                                      </td>
                                                      <td className={`p-1.5 text-right font-semibold ${qtyChanged ? "text-green-700" : "text-slate-500"}`}>
                                                        {ch.current.quantityReceived}
                                                      </td>
                                                      <td className={`p-1.5 ${batchChanged ? "text-red-600 line-through" : "text-slate-500"}`}>
                                                        {ch.previous.batchNumber}
                                                      </td>
                                                      <td className={`p-1.5 font-medium ${batchChanged ? "text-green-700" : "text-slate-500"}`}>
                                                        {ch.current.batchNumber}
                                                      </td>
                                                      <td className={`p-1.5 ${expiryChanged ? "text-red-600 line-through" : "text-slate-500"}`}>
                                                        {formatDate(ch.previous.expiryDate)}
                                                      </td>
                                                      <td className={`p-1.5 font-medium ${expiryChanged ? "text-green-700" : "text-slate-500"}`}>
                                                        {formatDate(ch.current.expiryDate)}
                                                      </td>
                                                    </tr>
                                                  );
                                                })}
                                              </tbody>
                                            </table>
                                          </div>
                                        )}
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}

                              <div className="overflow-x-auto rounded border bg-white">
                                <table className="w-full text-sm">
                                  <thead className="bg-slate-50 text-sm text-slate-500">
                                    <tr>
                                      <th className="p-2 text-left">Medicine</th>
                                      <th className="p-2 text-right">Qty Received</th>
                                      <th className="p-2 text-left">Batch</th>
                                      <th className="p-2 text-left">Expiry</th>
                                      <th className="p-2 text-left">Notes</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {receipt.lines.map((rl) => (
                                      <tr key={rl.id}>
                                        <td className="p-2 font-medium">{rl.medicine.medicineName}</td>
                                        <td className="p-2 text-right font-semibold">{rl.quantityReceived}</td>
                                        <td className="p-2 text-slate-500">{rl.batchNumber}</td>
                                        <td className="p-2 text-slate-500">
                                          {formatDate(rl.expiryDate)}
                                        </td>
                                        <td className="p-2 text-slate-500">{rl.notes ?? "—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Edit: inline edit form */}
                        {isEditing && (
                          <tr>
                            <td colSpan={5} className="bg-amber-50/40 p-4">
                              <div className="space-y-4">
                                <p className="text-sm font-semibold text-slate-800">
                                  Edit Receipt {receipt.receiptCode}
                                </p>

                                {receipt.lines.some(
                                  (rl) => rl.batch != null && rl.batch.quantity < rl.quantityReceived
                                ) && (
                                  <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                                    <p className="mb-1 font-semibold">Stock has been consumed from this receipt</p>
                                    <p>
                                      One or more medicines have been dispensed or adjusted since this receipt was
                                      recorded. Minimum correctable quantities are shown below.
                                    </p>
                                  </div>
                                )}

                                <div className="grid gap-3 sm:grid-cols-2">
                                  <div>
                                    <Label>
                                      Reason for Change <span className="text-red-500">*</span>
                                    </Label>
                                    <Input
                                      value={editForm.reasonForChange}
                                      onChange={(e) =>
                                        setEditForm((f) => ({ ...f, reasonForChange: e.target.value }))
                                      }
                                      placeholder="Describe what is being corrected and why"
                                    />
                                  </div>
                                  <div>
                                    <Label>Receipt Notes</Label>
                                    <Input
                                      value={editForm.notes}
                                      onChange={(e) =>
                                        setEditForm((f) => ({ ...f, notes: e.target.value }))
                                      }
                                      placeholder="Optional notes"
                                    />
                                  </div>
                                </div>

                                <div className="overflow-x-auto rounded border bg-white">
                                  <table className="w-full min-w-[700px] text-sm">
                                    <thead className="bg-slate-50 text-sm text-slate-500">
                                      <tr>
                                        <th className="p-2 text-left">Medicine</th>
                                        <th className="p-2 text-right">Recorded Qty</th>
                                        <th className="p-2 text-right">Batch Stock</th>
                                        <th className="p-2 text-right">Corrected Qty</th>
                                        <th className="p-2 text-left">Batch No.</th>
                                        <th className="p-2 text-left">Expiry Date</th>
                                        <th className="p-2 text-left">Notes</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y">
                                      {receipt.lines.map((rl) => {
                                        const formLine = editForm.lines.find((l) => l.lineId === rl.id);
                                        const batchQty = rl.batch?.quantity ?? null;
                                        const consumed =
                                          batchQty != null ? rl.quantityReceived - batchQty : 0;
                                        const hasConsumption = consumed > 0;
                                        const minQty =
                                          batchQty != null
                                            ? Math.max(0, rl.quantityReceived - batchQty)
                                            : 0;
                                        return (
                                          <tr key={rl.id} className={hasConsumption ? "bg-orange-50/40" : ""}>
                                            <td className="p-2 font-medium">{rl.medicine.medicineName}</td>
                                            <td className="p-2 text-right text-slate-500">
                                              {rl.quantityReceived}
                                            </td>
                                            <td className="p-2 text-right">
                                              {batchQty != null ? (
                                                <span
                                                  className={
                                                    hasConsumption
                                                      ? "font-medium text-orange-600"
                                                      : "text-green-600"
                                                  }
                                                >
                                                  {batchQty}
                                                  {hasConsumption && (
                                                    <span className="ml-1 text-sm text-orange-500">
                                                      (-{consumed} used)
                                                    </span>
                                                  )}
                                                </span>
                                              ) : (
                                                <span className="text-slate-400">—</span>
                                              )}
                                            </td>
                                            <td className="p-2">
                                              <div>
                                                <Input
                                                  type="number"
                                                  min={minQty}
                                                  className="w-24 text-right"
                                                  value={
                                                    formLine?.quantityReceived ?? rl.quantityReceived
                                                  }
                                                  onChange={(e) =>
                                                    updateEditLine(rl.id, {
                                                      quantityReceived: Number(e.target.value),
                                                    })
                                                  }
                                                />
                                                {hasConsumption && (
                                                  <p className="mt-0.5 text-sm text-orange-600">
                                                    Min: {minQty}
                                                  </p>
                                                )}
                                              </div>
                                            </td>
                                            <td className="p-2">
                                              <Input
                                                className="w-44"
                                                value={formLine?.batchNumber ?? rl.batchNumber}
                                                onChange={(e) =>
                                                  updateEditLine(rl.id, { batchNumber: e.target.value })
                                                }
                                              />
                                            </td>
                                            <td className="p-2">
                                              <Input
                                                type="date"
                                                className="w-48"
                                                min={tomorrowStr()}
                                                aria-label="Expiry date"
                                                value={
                                                  formLine?.expiryDate ??
                                                  (rl.expiryDate ? rl.expiryDate.split("T")[0] : "")
                                                }
                                                onChange={(e) =>
                                                  updateEditLine(rl.id, { expiryDate: e.target.value })
                                                }
                                              />
                                            </td>
                                            <td className="p-2">
                                              <Input
                                                value={formLine?.notes ?? ""}
                                                onChange={(e) =>
                                                  updateEditLine(rl.id, { notes: e.target.value })
                                                }
                                              />
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>

                                <div className="flex gap-2">
                                  <Button onClick={submitEdit}>Save Corrections</Button>
                                  <Button
                                    variant="outline"
                                    onClick={() => setEditingReceiptId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
