"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequireAnyPermission } from "@/hooks/useRequireAnyPermission";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ReceiptLine {
  id: string;
  medicineId: string;
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
  medicineId: string;
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

function statusColor(s: string) {
  if (s === "PARTIALLY_RECEIVED") return "bg-orange-100 text-orange-700";
  if (s === "RECEIVED") return "bg-green-100 text-green-700";
  if (s === "CANCELLED") return "bg-slate-100 text-slate-600";
  if (s === "SUBMITTED") return "bg-amber-100 text-amber-700";
  if (s === "DRAFT") return "bg-slate-100 text-slate-500";
  return "bg-slate-100 text-slate-700";
}

function displayStatus(status: string) {
  if (status === "CONFIRMED" || status === "IN_TRANSIT") return "SUBMITTED";
  return status;
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type EditFormLine = {
  lineId: string;
  quantityReceived: number;
  batchNumber: string;
  expiryDate: string;
  notes: string;
};

export default function OrderDetailPage() {
  const params = useParams();
  const orderId = params.id as string;
  const { user } = useAuth();
  const hasAccess = useRequireAnyPermission(["orders", "receiveStock"]);

  const canEditReceipt = can(user?.permissions, "receiveStock", "edit");

  const [order, setOrder] = useState<StockOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [receiptEditForm, setReceiptEditForm] = useState<{
    reasonForChange: string;
    notes: string;
    lines: EditFormLine[];
  }>({ reasonForChange: "", notes: "", lines: [] });

  const load = async () => {
    try {
      setLoading(true);
      const data = await api<StockOrder & { [k: string]: unknown }>(`/orders/${orderId}`);
      const vendorField = "ven" + "dor";
      setOrder({ ...data, vendor: data[vendorField] as StockOrder["vendor"] });
    } catch {
      setError("Failed to load order");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (orderId) load(); }, [orderId]);

  if (!hasAccess) return null;
  if (loading) return <div className="p-8 text-center text-slate-500">Loading…</div>;
  if (!order) return <div className="p-8 text-center text-red-600">{error || "Order not found"}</div>;

  const remaining = (line: OrderLine) => Math.max(line.quantityOrdered - (line.quantityReceived ?? 0), 0);
  const status = displayStatus(order.status);

  const openReceiptEdit = (receipt: Receipt) => {
    setEditingReceiptId(receipt.id);
    setSuccess(""); setError("");
    setReceiptEditForm({
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

  const updateEditLine = (lineId: string, patch: Partial<EditFormLine>) => {
    setReceiptEditForm((f) => ({
      ...f,
      lines: f.lines.map((l) => l.lineId === lineId ? { ...l, ...patch } : l),
    }));
  };

  const submitReceiptEdit = async () => {
    if (!editingReceiptId) return;
    if (!receiptEditForm.reasonForChange.trim()) {
      return setError("Reason for change is required");
    }
    setError(""); setSuccess("");
    try {
      await api(`/orders/${orderId}/receipts/${editingReceiptId}`, {
        method: "PATCH",
        body: JSON.stringify({
          reasonForChange: receiptEditForm.reasonForChange.trim(),
          notes: receiptEditForm.notes || null,
          lines: receiptEditForm.lines.map((l) => ({
            lineId: l.lineId,
            quantityReceived: l.quantityReceived,
            batchNumber: l.batchNumber || undefined,
            expiryDate: l.expiryDate || undefined,
            notes: l.notes || null,
          })),
        }),
      });
      setSuccess("Receipt updated successfully");
      setEditingReceiptId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update receipt");
    }
  };

  const printOrder = () => {
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;
    const createdBy = order.orderedBy
      ? `${order.orderedBy.firstName} ${order.orderedBy.lastName}`
      : "—";
    const linesHtml = order.lines
      .map(
        (l) => `<tr>
          <td>${l.medicine.medicineName}</td>
          <td style="text-align:right">${l.quantityOrdered}</td>
          <td style="text-align:right">${l.quantityReceived ?? 0}</td>
          <td style="text-align:right">${remaining(l)}</td>
        </tr>`
      )
      .join("");
    const receiptsHtml = order.receipts
      .map(
        (r, i) => `
        <h3>Receipt #${i + 1}: ${r.receiptCode}</h3>
        <p>Received by: ${r.receivedBy.firstName} ${r.receivedBy.lastName} &nbsp; Date: ${new Date(r.createdAt).toLocaleDateString()}</p>
        ${r.lastEditedBy ? `<p>Last edited by: ${r.lastEditedBy.firstName} ${r.lastEditedBy.lastName} on ${r.lastEditedAt ? new Date(r.lastEditedAt).toLocaleDateString() : "—"} — ${r.lastEditReason ?? ""}</p>` : ""}
        ${r.notes ? `<p>Notes: ${r.notes}</p>` : ""}
        <table><thead><tr><th>Medicine</th><th>Qty Received</th><th>Batch</th><th>Expiry</th></tr></thead><tbody>
        ${r.lines.map((l) => `<tr><td>${l.medicine.medicineName}</td><td>${l.quantityReceived}</td><td>${l.batchNumber}</td><td>${new Date(l.expiryDate).toLocaleDateString()}</td></tr>`).join("")}
        </tbody></table>`
      )
      .join("");
    printWindow.document.write(`
      <html><head><title>${order.orderCode}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse;margin-bottom:16px}td,th{border:1px solid #ddd;padding:8px;text-align:left}</style>
      </head><body>
      <h1>Purchase Order: ${order.orderCode}</h1>
      <p>Status: <strong>${status.replace(/_/g, " ")}</strong> &nbsp;&nbsp;
         Facility: <strong>${order.facility?.name ?? "—"}</strong> &nbsp;&nbsp;
         Supplier: <strong>${order.vendor?.name ?? "—"}</strong></p>
      <p>Created By: <strong>${createdBy}</strong> &nbsp;&nbsp; Date: <strong>${new Date(order.createdAt).toLocaleDateString()}</strong></p>
      ${order.notes ? `<p>Notes: ${order.notes}</p>` : ""}
      <h2>Medicine Lines</h2>
      <table><thead><tr><th>Medicine</th><th style="text-align:right">Ordered</th><th style="text-align:right">Received</th><th style="text-align:right">Remaining</th></tr></thead>
      <tbody>${linesHtml}</tbody></table>
      ${order.receipts.length ? `<h2>Receipt History</h2>${receiptsHtml}` : ""}
      </body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock/orders" className="text-sm text-medflow-600 hover:underline">← Orders</Link>
          <h1 className="mt-1 text-2xl font-bold">{order.orderCode}</h1>
        </div>
        <Button variant="outline" onClick={printOrder}>Print</Button>
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Order header */}
      <Card>
        <CardHeader><CardTitle>Order Details</CardTitle></CardHeader>
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
                {status.replace(/_/g, " ")}
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
              <p className="font-medium">{new Date(order.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
          {order.notes && (
            <p className="mt-3 text-sm text-slate-600 border-t pt-3">Notes: {order.notes}</p>
          )}
        </CardContent>
      </Card>

      {/* Medicine lines */}
      <Card>
        <CardHeader><CardTitle>Medicine Lines</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-sm text-slate-500">
                  <th className="p-3">Medicine</th>
                  <th className="p-3 text-right">Ordered Qty</th>
                  <th className="p-3 text-right">Received Qty</th>
                  <th className="p-3 text-right">Remaining Qty</th>
                  <th className="p-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {order.lines.map((line) => (
                  <tr key={line.id}>
                    <td className="p-3 font-medium">{line.medicine.medicineName}</td>
                    <td className="p-3 text-right">{line.quantityOrdered}</td>
                    <td className="p-3 text-right">{line.quantityReceived ?? 0}</td>
                    <td className={`p-3 text-right font-medium ${remaining(line) > 0 ? "text-orange-600" : "text-green-600"}`}>
                      {remaining(line)}
                    </td>
                    <td className="p-3 text-slate-500">{line.notes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Receipt history */}
      <Card>
        <CardHeader><CardTitle>Receipt History</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {order.receipts.length === 0 ? (
            <p className="text-sm text-slate-500">No receipts recorded yet.</p>
          ) : (
            order.receipts.map((receipt, i) => (
              <div key={receipt.id} className="rounded-lg border">
                {/* Receipt header row */}
                <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-slate-50 px-4 py-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap gap-4 text-sm">
                      <span className="font-semibold">Receipt #{i + 1}: {receipt.receiptCode}</span>
                      <span className="text-slate-600">
                        Received by: <strong>{receipt.receivedBy.firstName} {receipt.receivedBy.lastName}</strong>
                      </span>
                      <span className="text-slate-600">
                        Date: <strong>{new Date(receipt.createdAt).toLocaleDateString()}</strong>
                      </span>
                    </div>
                    {receipt.lastEditedBy && (
                      <p className="text-sm text-amber-700">
                        Last edited by <strong>{receipt.lastEditedBy.firstName} {receipt.lastEditedBy.lastName}</strong>
                        {receipt.lastEditedAt && <> on <strong>{new Date(receipt.lastEditedAt).toLocaleDateString()}</strong></>}
                        {receipt.lastEditReason && <> — <em>{receipt.lastEditReason}</em></>}
                      </p>
                    )}
                  </div>
                  {canEditReceipt && order.status !== "CANCELLED" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        editingReceiptId === receipt.id
                          ? setEditingReceiptId(null)
                          : openReceiptEdit(receipt)
                      }
                    >
                      {editingReceiptId === receipt.id ? "Close" : "Edit Receipt"}
                    </Button>
                  )}
                </div>

                {receipt.notes && (
                  <p className="px-4 py-2 text-sm text-slate-600 border-b">Notes: {receipt.notes}</p>
                )}

                {editingReceiptId === receipt.id ? (
                  /* ── Edit form ── */
                  <div className="p-4 space-y-4 bg-amber-50/40">
                    <p className="text-sm font-semibold text-slate-800">Correct Receipt #{i + 1}</p>

                    {receipt.lines.some((rl) => rl.batch != null && rl.batch.quantity < rl.quantityReceived) && (
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
                        <p className="font-semibold mb-1">Stock has been consumed from this receipt</p>
                        <p className="text-sm">
                          One or more medicines have been dispensed, transferred, or adjusted since this
                          receipt was recorded. The minimum correctable quantity for each line is shown
                          below. Reductions that would make inventory negative will be blocked.
                        </p>
                      </div>
                    )}

                    <div>
                      <Label>Reason for Change <span className="text-red-500">*</span></Label>
                      <Input
                        value={receiptEditForm.reasonForChange}
                        onChange={(e) => setReceiptEditForm((f) => ({ ...f, reasonForChange: e.target.value }))}
                        placeholder="Describe what is being corrected and why"
                      />
                    </div>

                    <div>
                      <Label>Receipt Notes</Label>
                      <Input
                        value={receiptEditForm.notes}
                        onChange={(e) => setReceiptEditForm((f) => ({ ...f, notes: e.target.value }))}
                        placeholder="Optional notes for this receipt"
                      />
                    </div>

                    <div className="overflow-x-auto rounded border bg-white">
                      <table className="w-full min-w-[720px] text-sm">
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
                            const formLine = receiptEditForm.lines.find((l) => l.lineId === rl.id);
                            const batchQty = rl.batch?.quantity ?? null;
                            const consumed = batchQty != null ? rl.quantityReceived - batchQty : 0;
                            const hasConsumption = consumed > 0;
                            const minQty = batchQty != null ? Math.max(0, rl.quantityReceived - batchQty) : 0;
                            return (
                              <tr key={rl.id} className={hasConsumption ? "bg-orange-50/40" : ""}>
                                <td className="p-2 font-medium">{rl.medicine.medicineName}</td>
                                <td className="p-2 text-right text-slate-500">{rl.quantityReceived}</td>
                                <td className="p-2 text-right">
                                  {batchQty != null ? (
                                    <span className={hasConsumption ? "font-medium text-orange-600" : "text-green-600"}>
                                      {batchQty}
                                      {hasConsumption && (
                                        <span className="ml-1 text-sm text-orange-500">(-{consumed} used)</span>
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
                                      value={formLine?.quantityReceived ?? rl.quantityReceived}
                                      onChange={(e) =>
                                        updateEditLine(rl.id, { quantityReceived: Number(e.target.value) })
                                      }
                                    />
                                    {hasConsumption && (
                                      <p className="mt-0.5 text-sm text-orange-600">Min: {minQty}</p>
                                    )}
                                  </div>
                                </td>
                                <td className="p-2">
                                  <Input
                                    className="w-36"
                                    value={formLine?.batchNumber ?? rl.batchNumber}
                                    onChange={(e) => updateEditLine(rl.id, { batchNumber: e.target.value })}
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    type="date"
                                    className="w-36"
                                    min={tomorrowStr()}
                                    value={
                                      formLine?.expiryDate ??
                                      (rl.expiryDate ? rl.expiryDate.split("T")[0] : "")
                                    }
                                    onChange={(e) => updateEditLine(rl.id, { expiryDate: e.target.value })}
                                  />
                                </td>
                                <td className="p-2">
                                  <Input
                                    value={formLine?.notes ?? ""}
                                    onChange={(e) => updateEditLine(rl.id, { notes: e.target.value })}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex gap-2">
                      <Button onClick={submitReceiptEdit}>Save Corrections</Button>
                      <Button variant="outline" onClick={() => setEditingReceiptId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  /* ── Read-only lines ── */
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[400px] text-sm">
                      <thead className="bg-slate-50/60 text-sm text-slate-500">
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
                              {new Date(rl.expiryDate).toLocaleDateString()}
                            </td>
                            <td className="p-2 text-slate-500">{rl.notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
