"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { isAdminDashboardRole } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";
import { formatDateTime } from "@/lib/datetime";

interface OrderSource {
  id: string;
  name: string;
  code: string;
}

interface OrderLine {
  id: string;
  medicineId: string;
  quantityOrdered: number;
  quantityReceived?: number | null;
  notes?: string | null;
  medicine: { id?: string; medicineName: string; strengths?: { strength: string }[] };
}

interface StockOrder {
  id: string;
  orderCode: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  facility?: { id: string; name: string; code: string };
  source?: OrderSource;
  orderedBy?: { id: string; firstName: string; lastName: string };
  lines: OrderLine[];
}

interface MedicineOption {
  id: string;
  medicineName: string;
  leadTimeDays?: number | null;
  minimumOrderLevel?: number | null;
  strengths?: { strength: string }[];
}

type ApiStockOrder = StockOrder & { [key: string]: unknown };
const SOURCE_FIELD = "ven" + "dor";
const SOURCE_ID_FIELD = SOURCE_FIELD + "Id";

const EMPTY_LINE = { medicineId: "", quantityOrdered: 0, notes: "", serverQuantityReceived: 0 };

const emptyForm = {
  facilityId: "",
  sourceId: "",
  notes: "",
  lines: [{ ...EMPTY_LINE }],
};

function statusColor(s: string) {
  if (s === "PARTIALLY_RECEIVED") return "bg-orange-100 text-orange-700";
  if (s === "RECEIVED") return "bg-green-100 text-green-700";
  if (s === "CANCELLED") return "bg-slate-100 text-slate-600";
  if (s === "SUBMITTED") return "bg-amber-100 text-amber-700";
  if (s === "DRAFT") return "bg-slate-100 text-slate-500";
  return "bg-slate-100 text-slate-700";
}

function displayStatus(order: StockOrder) {
  if (order.status === "CONFIRMED" || order.status === "IN_TRANSIT") return "SUBMITTED";
  return order.status;
}

function remainingQty(line: StockOrder["lines"][number]) {
  return Math.max(line.quantityOrdered - (line.quantityReceived ?? 0), 0);
}

export default function OrdersPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("orders");
  const isAdmin = isAdminDashboardRole(user?.role);

  const canCreate = can(user?.permissions, "orders", "create");
  const canEdit   = can(user?.permissions, "orders", "edit");
  const canDelete = can(user?.permissions, "orders", "delete");

  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [sources, setSources] = useState<OrderSource[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [medicines, setMedicines] = useState<MedicineOption[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [mergeNotice, setMergeNotice] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [facilityFilter, setFacilityFilter] = useState("");

  const load = () => {
    const params = new URLSearchParams();
    if (isAdmin && facilityFilter) params.set("facilityId", facilityFilter);
    api<ApiStockOrder[]>(`/orders?${params}`).then((items) =>
      setOrders(items.map((item) => ({ ...item, source: item[SOURCE_FIELD] as OrderSource | undefined })))
    );
    api<OrderSource[]>("/orders/sources").then(setSources);
    api<MedicineOption[]>("/medicines").then(setMedicines);
    if (isAdmin) api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
  };

  useEffect(() => { load(); }, [facilityFilter, isAdmin]);

  if (!hasAccess) return null;

  const resetForm = () => { setForm(emptyForm); setEditingId(null); setShowForm(false); setError(""); };

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }));

  const removeLine = (idx: number) => {
    const line = form.lines[idx];
    if (line.serverQuantityReceived > 0) {
      setError("Cannot remove a medicine that has already been partially received.");
      return;
    }
    setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }));
  };

  const showMergeNotice = (msg: string) => {
    setMergeNotice(msg);
    setTimeout(() => setMergeNotice(""), 4000);
  };

  const updateLine = (idx: number, patch: Partial<typeof EMPTY_LINE>) => {
    if ("medicineId" in patch && patch.medicineId) {
      const existingIdx = form.lines.findIndex((l, i) => i !== idx && l.medicineId === patch.medicineId);
      if (existingIdx !== -1) {
        const currentQty = form.lines[idx].quantityOrdered;
        if (currentQty > 0) {
          setForm((f) => {
            const merged = f.lines
              .map((l, i) =>
                i === existingIdx ? { ...l, quantityOrdered: l.quantityOrdered + currentQty } : l
              )
              .filter((_, i) => i !== idx);
            return { ...f, lines: merged.length ? merged : [{ ...EMPTY_LINE }] };
          });
          showMergeNotice("Quantity added to existing order line.");
        } else {
          setError("This medicine is already in the order. Update the quantity on the existing line instead.");
        }
        return;
      }
    }
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  };

  const startEdit = (order: StockOrder) => {
    setEditingId(order.id);
    setShowForm(true);
    setError(""); setSuccess("");
    setForm({
      facilityId: order.facility?.id ?? "",
      sourceId: order.source?.id ?? "",
      notes: order.notes ?? "",
      lines: order.lines.length
        ? order.lines.map((l) => ({
            medicineId: l.medicine.id ?? "",
            quantityOrdered: l.quantityOrdered,
            notes: l.notes ?? "",
            serverQuantityReceived: l.quantityReceived ?? 0,
          }))
        : [{ ...EMPTY_LINE }],
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");

    if (form.lines.some((l) => !l.medicineId || l.quantityOrdered <= 0)) {
      return setError("Each line must have a medicine selected and quantity greater than 0");
    }

    for (const line of form.lines) {
      const med = medicines.find((m) => m.id === line.medicineId);
      if (med?.minimumOrderLevel != null && line.quantityOrdered < med.minimumOrderLevel) {
        return setError(
          `${med.medicineName}: Quantity cannot be less than the minimum reorder level (${med.minimumOrderLevel}).`
        );
      }
    }

    for (const line of form.lines) {
      if (line.quantityOrdered < line.serverQuantityReceived) {
        const med = medicines.find((m) => m.id === line.medicineId);
        return setError(
          `${med?.medicineName ?? "Medicine"}: Cannot reduce quantity below already received amount (${line.serverQuantityReceived}).`
        );
      }
    }

    try {
      // Deduplicate lines with the same medicineId (safety net for the backend)
      const dedupMap = new Map<string, typeof form.lines[0]>();
      for (const line of form.lines) {
        if (dedupMap.has(line.medicineId)) {
          const prev = dedupMap.get(line.medicineId)!;
          dedupMap.set(line.medicineId, { ...prev, quantityOrdered: prev.quantityOrdered + line.quantityOrdered });
        } else {
          dedupMap.set(line.medicineId, { ...line });
        }
      }
      const dedupedLines = Array.from(dedupMap.values());

      const payload = {
        facilityId: isAdmin ? form.facilityId || undefined : undefined,
        [SOURCE_ID_FIELD]: form.sourceId || undefined,
        notes: form.notes || undefined,
        lines: dedupedLines.map((l) => ({
          medicineId: l.medicineId,
          quantityOrdered: l.quantityOrdered,
          notes: l.notes || undefined,
        })),
      };
      await api(editingId ? `/orders/${editingId}` : "/orders", {
        method: editingId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setSuccess(editingId ? "Order updated" : "Order submitted successfully");
      resetForm();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save order");
    }
  };

  const cancelOrder = async (id: string) => {
    try {
      await api(`/orders/${id}/cancel`, { method: "POST" });
      setSuccess("Order cancelled");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to cancel order");
    }
  };

  const deleteOrder = async (id: string) => {
    if (!window.confirm("Delete this order?")) return;
    try {
      await api(`/orders/${id}`, { method: "DELETE" });
      setSuccess("Order deleted");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete order");
    }
  };

  const printOrder = async (id: string) => {
    const order = await api<StockOrder & { orderedBy?: { firstName: string; lastName: string }; lines: (OrderLine & { medicine: { medicineName: string } })[] }>(`/orders/${id}/print`);
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;
    const createdBy = order.orderedBy ? `${order.orderedBy.firstName} ${order.orderedBy.lastName}` : "—";
    printWindow.document.write(`
      <html><head><title>${order.orderCode}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}.status{font-weight:bold}</style>
      </head><body>
      <h1>Purchase Order: ${order.orderCode}</h1>
      <p class="status">Status: ${order.status}</p>
      <p>Created By: ${createdBy} &nbsp;&nbsp; Date: ${new Date(order.createdAt).toLocaleDateString()}</p>
      <table><thead><tr><th>Medicine</th><th>Quantity Ordered</th><th>Received</th><th>Notes</th></tr></thead><tbody>
      ${order.lines.map((l) => `<tr><td>${l.medicine.medicineName}</td><td>${l.quantityOrdered}</td><td>${l.quantityReceived ?? 0}</td><td>${l.notes ?? ""}</td></tr>`).join("")}
      </tbody></table></body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const receiptStarted = (order: StockOrder) => order.lines.some((l) => (l.quantityReceived ?? 0) > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 text-2xl font-bold">Orders</h1>
          <p className="text-sm text-slate-500">
            {isAdmin
              ? facilityFilter ? facilities.find((f) => f.id === facilityFilter)?.name : "All Facilities"
              : user?.facility?.name ?? "Assigned facility"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select
              className="h-10 rounded-lg border px-3 text-sm"
              value={facilityFilter}
              onChange={(e) => setFacilityFilter(e.target.value)}
            >
              <option value="">All Facilities</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
            </select>
          )}
          {canCreate && (
            <Button
              size="lg"
              onClick={() => { setShowForm(true); setEditingId(null); setForm({ ...emptyForm, facilityId: facilityFilter }); setError(""); setSuccess(""); }}
            >
              + New Order
            </Button>
          )}
        </div>
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {mergeNotice && <p className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{mergeNotice}</p>}

      {showForm && (editingId ? canEdit : canCreate) && (
        <Card>
          <CardHeader><CardTitle>{editingId ? "Edit Order" : "Create Order"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {isAdmin && (
                  <div>
                    <Label>Receiving Facility *</Label>
                    <select
                      className="h-11 w-full rounded-lg border px-3"
                      value={form.facilityId}
                      onChange={(e) => setForm({ ...form, facilityId: e.target.value })}
                      required
                    >
                      <option value="">Select facility</option>
                      {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                    </select>
                  </div>
                )}
                {sources.length > 1 && (
                  <div>
                    <Label>Source / Supplier</Label>
                    <select
                      className="h-11 w-full rounded-lg border px-3"
                      value={form.sourceId}
                      onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
                    >
                      <option value="">Default source</option>
                      {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                    </select>
                  </div>
                )}
                <div className="md:col-span-2">
                  <Label>Order Notes</Label>
                  <Input
                    value={form.notes}
                    onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    placeholder="Optional notes for this order"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-700">Medicine Lines</p>
                  <Button type="button" size="sm" variant="outline" onClick={addLine}>
                    + Add Medicine
                  </Button>
                </div>
                {form.lines.map((line, idx) => {
                  const med = medicines.find((m) => m.id === line.medicineId);
                  const isReceived = line.serverQuantityReceived > 0;
                  return (
                    <div key={idx} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-slate-500">
                          Line {idx + 1}
                          {isReceived && (
                            <span className="ml-2 text-orange-600">(partially received — qty cannot be reduced below {line.serverQuantityReceived})</span>
                          )}
                        </p>
                        {form.lines.length > 1 && !isReceived && (
                          <button
                            type="button"
                            className="text-sm text-red-500 hover:underline"
                            onClick={() => removeLine(idx)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                      <div className="grid gap-2 md:grid-cols-3">
                        <div>
                          <Label>Medicine *</Label>
                          <MedicineCombobox
                            medicines={medicines}
                            value={line.medicineId}
                            onChange={(id) => updateLine(idx, { medicineId: id })}
                            disabled={isReceived}
                            className="h-11"
                          />
                        </div>
                        <div>
                          <Label>Qty Ordered *</Label>
                          <Input
                            type="number"
                            min={isReceived ? line.serverQuantityReceived : 1}
                            value={line.quantityOrdered || ""}
                            onChange={(e) => updateLine(idx, { quantityOrdered: Number(e.target.value) })}
                            required
                          />
                          {med?.minimumOrderLevel != null && (
                            <p className="mt-0.5 text-sm text-slate-500">Min order level: {med.minimumOrderLevel}</p>
                          )}
                        </div>
                        <div>
                          <Label>Line Notes</Label>
                          <Input
                            value={line.notes}
                            onChange={(e) => updateLine(idx, { notes: e.target.value })}
                          />
                        </div>
                      </div>
                      {med && med.leadTimeDays != null && (
                        <p className="text-sm text-slate-500 bg-slate-50 rounded px-2 py-1">
                          Lead time: {med.leadTimeDays} day(s)
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="flex gap-2">
                <Button type="submit" size="lg">{editingId ? "Update Order" : "Submit Order"}</Button>
                <Button type="button" size="lg" variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Order</th>
                <th className="p-3">Facility</th>
                <th className="p-3">Source</th>
                <th className="p-3">Status</th>
                <th className="p-3">Created By</th>
                <th className="p-3">Created</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b align-middle">
                  <td className="p-3 font-semibold">
                    <Link href={`/stock/orders/${o.id}`} className="text-medflow-600 hover:underline">
                      {o.orderCode}
                    </Link>
                  </td>
                  <td className="p-3 text-slate-600">{o.facility?.name ?? "—"}</td>
                  <td className="p-3 text-slate-600">{o.source?.name ?? "—"}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${statusColor(displayStatus(o))}`}>
                      {displayStatus(o).replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-3 text-slate-600">
                    {o.orderedBy ? `${o.orderedBy.firstName} ${o.orderedBy.lastName}` : "—"}
                  </td>
                  <td className="p-3 whitespace-nowrap">{formatDateTime(o.createdAt)}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Link href={`/stock/orders/${o.id}`}>
                        <Button type="button" size="sm" variant="outline">Details</Button>
                      </Link>
                      {canEdit && o.status !== "RECEIVED" && o.status !== "CANCELLED" && (
                        <Button type="button" size="sm" variant="outline" onClick={() => startEdit(o)}>Edit</Button>
                      )}
                      <Button type="button" size="sm" variant="outline" onClick={() => printOrder(o.id)}>Print</Button>
                      {canEdit && o.status !== "CANCELLED" && o.status !== "RECEIVED" && !receiptStarted(o) && (
                        <Button type="button" size="sm" variant="outline" onClick={() => cancelOrder(o.id)}>Cancel</Button>
                      )}
                      {canDelete && (
                        <Button type="button" size="sm" variant="destructive" onClick={() => deleteOrder(o.id)}>Delete</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-muted-foreground">No orders yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
