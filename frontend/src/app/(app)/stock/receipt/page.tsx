"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { PackageCheck } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { isAdminDashboardRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

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

function statusBadge(status: string) {
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

export default function ReceiveStockPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("receiveStock");
  const isAdmin = isAdminDashboardRole(user?.role);

  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [facilityFilter, setFacilityFilter] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [receiptForm, setReceiptForm] = useState<ReceiptForm>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = () => {
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

  useEffect(() => { load(); }, [facilityFilter, isAdmin]);

  if (!hasAccess) return null;

  const openReceive = (order: PendingOrder) => {
    const form: ReceiptForm = {};
    for (const line of order.lines) {
      // Start at 0 — user explicitly enters what they are receiving this session
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

    if (!lines.length) {
      return setError("Enter at least one quantity to receive.");
    }

    for (const l of lines) {
      if (!l.batchNumber) {
        return setError("Batch number is required for all lines being received.");
      }
      if (!l.expiryDate) {
        return setError("Expiry date is required for all lines being received.");
      }
      if (l.expiryDate <= todayStr()) {
        return setError("Expiry date must be a future date.");
      }
    }

    try {
      await api(`/orders/${order.id}/receive`, {
        method: "POST",
        body: JSON.stringify({ lines }),
      });
      setSuccess(`Stock received for order ${order.orderCode}. Inventory updated and transaction recorded.`);
      setActiveId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to receive stock");
    }
  };

  const minExpiry = tomorrowStr();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            <PackageCheck className="h-6 w-6 text-medflow-600" /> Receive Stock
          </h1>
          <p className="text-sm text-slate-500">
            Enter quantities received — lines with 0 are skipped. Batch and expiry required only when quantity &gt; 0.
          </p>
        </div>
        {isAdmin && (
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
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

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
                      <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${statusBadge(computeStatus(o))}`}>
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
    </div>
  );
}
