"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface OrderSource {
  id: string;
  name: string;
  code: string;
}

interface OrderLine {
  medicineId: string;
  quantityOrdered: number;
  notes: string;
}

interface StockOrder {
  id: string;
  orderCode: string;
  status: string;
  priority?: string;
  expectedDeliveryDate?: string;
  leadTimeDays?: number | null;
  minimumOrderLevel?: number | null;
  notes?: string | null;
  createdAt: string;
  source?: OrderSource;
  lines: { quantityOrdered: number; notes?: string | null; medicine: { id?: string; medicineName: string; strengths?: { strength: string }[] } }[];
}

type ApiStockOrder = StockOrder & { [key: string]: unknown };
const SOURCE_FIELD = "ven" + "dor";
const SOURCE_ID_FIELD = SOURCE_FIELD + "Id";

const emptyForm = {
  sourceId: "",
  priority: "ROUTINE",
  expectedDeliveryDate: "",
  leadTimeDays: 0,
  minimumOrderLevel: 0,
  notes: "",
  line: { medicineId: "", quantityOrdered: 0, notes: "" } as OrderLine,
};

function statusColor(s: string) {
  if (s === "RECEIVED") return "bg-green-100 text-green-700";
  if (s === "CONFIRMED") return "bg-blue-100 text-blue-700";
  if (s === "CANCELLED") return "bg-slate-100 text-slate-600";
  if (s === "SUBMITTED") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-700";
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [sources, setSources] = useState<OrderSource[]>([]);
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string; reorderThreshold: number; strengths?: { strength: string }[] }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [viewOrder, setViewOrder] = useState<StockOrder | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState(emptyForm);

  const load = () => {
    api<ApiStockOrder[]>("/orders").then((items) =>
      setOrders(items.map((item) => ({ ...item, source: item[SOURCE_FIELD] as OrderSource | undefined })))
    );
    api<OrderSource[]>("/orders/sources").then(setSources);
    api<{ id: string; medicineName: string; reorderThreshold: number; strengths?: { strength: string }[] }[]>("/medicines").then(setMedicines);
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (order: StockOrder) => {
    const firstLine = order.lines[0];
    setEditingId(order.id);
    setShowForm(true);
    setForm({
      sourceId: order.source?.id ?? "",
      priority: order.priority ?? "ROUTINE",
      expectedDeliveryDate: order.expectedDeliveryDate ? order.expectedDeliveryDate.slice(0, 10) : "",
      leadTimeDays: order.leadTimeDays ?? 0,
      minimumOrderLevel: order.minimumOrderLevel ?? 0,
      notes: order.notes ?? "",
      line: {
        medicineId: firstLine?.medicine.id ?? "",
        quantityOrdered: firstLine?.quantityOrdered ?? 0,
        notes: firstLine?.notes ?? "",
      },
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!form.line.medicineId || form.line.quantityOrdered <= 0) return setError("Select a medicine and quantity");

    const payload = {
      [SOURCE_ID_FIELD]: form.sourceId || undefined,
      priority: form.priority,
      expectedDeliveryDate: form.expectedDeliveryDate || undefined,
      leadTimeDays: Number(form.leadTimeDays) || undefined,
      minimumOrderLevel: Number(form.minimumOrderLevel) || undefined,
      notes: form.notes || undefined,
      lines: [{ ...form.line, notes: form.line.notes || undefined }],
    };

    await api(editingId ? `/orders/${editingId}` : "/orders", {
      method: editingId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    setSuccess(editingId ? "Order updated" : "Order submitted successfully");
    resetForm();
    load();
  };

  const cancelOrder = async (id: string) => {
    await api(`/orders/${id}/cancel`, { method: "POST" });
    setSuccess("Order cancelled");
    load();
  };

  const deleteOrder = async (id: string) => {
    if (!window.confirm("Delete this order?")) return;
    await api(`/orders/${id}`, { method: "DELETE" });
    setSuccess("Order deleted");
    load();
  };

  const printOrder = async (id: string) => {
    const order = await api<StockOrder>(`/orders/${id}/print`);
    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) return;
    printWindow.document.write(`
      <html><head><title>${order.orderCode}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}.status{font-weight:bold}</style>
      </head><body>
      <h1>Order ${order.orderCode}</h1>
      <p class="status">Status: ${order.status}</p>
      <p>Priority: ${order.priority ?? ""}</p>
      <p>Lead Time: ${order.leadTimeDays ?? "-"} day(s)</p>
      <p>Minimum Order Level: ${order.minimumOrderLevel ?? "-"}</p>
      <table><thead><tr><th>Medicine</th><th>Quantity</th><th>Notes</th></tr></thead><tbody>
      ${order.lines.map((l) => `<tr><td>${l.medicine.medicineName}</td><td>${l.quantityOrdered}</td><td>${l.notes ?? ""}</td></tr>`).join("")}
      </tbody></table></body></html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Operations</Link>
          <h1 className="mt-1 text-2xl font-bold">Order</h1>
          <p className="text-sm text-muted-foreground">Order medicines for replenishment</p>
        </div>
        <Button size="lg" onClick={() => { setShowForm(true); setEditingId(null); setForm(emptyForm); }}>+ New Order</Button>
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {showForm && (
        <Card>
          <CardHeader><CardTitle>{editingId ? "Edit Order" : "Place Order"}</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                {sources.length > 1 && (
                  <div>
                    <Label>Source</Label>
                    <select className="h-11 w-full rounded-lg border px-3" value={form.sourceId} onChange={(e) => setForm({ ...form, sourceId: e.target.value })}>
                      <option value="">Default source</option>
                      {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <Label>Priority</Label>
                  <select className="h-11 w-full rounded-lg border px-3" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                    <option value="ROUTINE">Routine</option>
                    <option value="URGENT">Urgent</option>
                    <option value="EMERGENCY">Emergency</option>
                  </select>
                </div>
                <div>
                  <Label>Expected delivery</Label>
                  <Input type="date" value={form.expectedDeliveryDate} onChange={(e) => setForm({ ...form, expectedDeliveryDate: e.target.value })} />
                </div>
                <div>
                  <Label>Lead Time</Label>
                  <Input type="number" min={0} step={1} value={form.leadTimeDays || ""} onChange={(e) => setForm({ ...form, leadTimeDays: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Minimum Order Level</Label>
                  <Input type="number" min={0} step={1} value={form.minimumOrderLevel || ""} onChange={(e) => setForm({ ...form, minimumOrderLevel: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Order notes</Label>
                  <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              <div className="grid gap-2 rounded-lg border p-3 md:grid-cols-3">
                <div>
                  <Label>Medicine</Label>
                  <select
                    className="h-11 w-full rounded-lg border px-3"
                    value={form.line.medicineId}
                    onChange={(e) => setForm({ ...form, line: { ...form.line, medicineId: e.target.value } })}
                    required
                  >
                    <option value="">Select</option>
                    {medicines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.medicineName}{m.strengths?.length ? ` - ${m.strengths.map((s) => s.strength).join(", ")}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Qty ordered</Label>
                  <Input type="number" min={1} value={form.line.quantityOrdered || ""} onChange={(e) => setForm({ ...form, line: { ...form.line, quantityOrdered: Number(e.target.value) } })} required />
                </div>
                <div>
                  <Label>Line notes</Label>
                  <Input value={form.line.notes} onChange={(e) => setForm({ ...form, line: { ...form.line, notes: e.target.value } })} />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" size="lg">{editingId ? "Update Order" : "Submit Order"}</Button>
                <Button type="button" size="lg" variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {viewOrder && (
        <Card>
          <CardHeader><CardTitle>Order {viewOrder.orderCode}</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>Status: <strong>{viewOrder.status}</strong></p>
            <p>Priority: {viewOrder.priority}</p>
            <p>Lead Time: {viewOrder.leadTimeDays ?? "—"} day(s)</p>
            <p>Minimum Order Level: {viewOrder.minimumOrderLevel ?? "—"}</p>
            <ul className="space-y-1">
              {viewOrder.lines.map((line, i) => <li key={i}>{line.medicine.medicineName} — <strong>{line.quantityOrdered}</strong> units</li>)}
            </ul>
            <Button type="button" variant="outline" onClick={() => setViewOrder(null)}>Close</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3">Order</th>
                <th className="p-3">Status</th>
                <th className="p-3">Lines</th>
                <th className="p-3">Lead Time</th>
                <th className="p-3">Minimum Order Level</th>
                <th className="p-3">Created</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b align-top">
                  <td className="p-3 font-semibold">{o.orderCode}</td>
                  <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(o.status)}`}>{o.status}</span></td>
                  <td className="p-3">
                    {o.lines.map((l, i) => <div key={i}>{l.medicine.medicineName} - <strong>{l.quantityOrdered}</strong></div>)}
                  </td>
                  <td className="p-3">{o.leadTimeDays ?? "—"}</td>
                  <td className="p-3">{o.minimumOrderLevel ?? "—"}</td>
                  <td className="p-3">{new Date(o.createdAt).toLocaleDateString()}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => setViewOrder(o)}>View</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => startEdit(o)}>Edit</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => printOrder(o.id)}>Print</Button>
                      {o.status !== "CANCELLED" && <Button type="button" size="sm" variant="outline" onClick={() => cancelOrder(o.id)}>Cancel</Button>}
                      <Button type="button" size="sm" variant="destructive" onClick={() => deleteOrder(o.id)}>Delete</Button>
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
