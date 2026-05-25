"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Vendor {
  id: string;
  name: string;
  code: string;
  contactName?: string;
  phone?: string;
}

interface OrderLine {
  medicineId: string;
  quantityOrdered: number;
  unitCost: number;
  notes: string;
}

interface StockOrder {
  id: string;
  orderCode: string;
  status: string;
  priority?: string;
  expectedDeliveryDate?: string;
  createdAt: string;
  vendor: Vendor;
  lines: { quantityOrdered: number; medicine: { medicineName: string } }[];
}

export default function VendorOrdersPage() {
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string; reorderThreshold: number }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    vendorId: "",
    priority: "ROUTINE",
    expectedDeliveryDate: "",
    notes: "",
    lines: [{ medicineId: "", quantityOrdered: 0, unitCost: 0, notes: "" }] as OrderLine[],
  });

  const load = () => {
    api<StockOrder[]>("/vendor-orders").then(setOrders);
    api<Vendor[]>("/vendor-orders/vendors").then(setVendors);
    api<{ id: string; medicineName: string; reorderThreshold: number }[]>("/medicines").then(setMedicines);
  };

  useEffect(() => {
    load();
  }, []);

  const addLine = () => {
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { medicineId: "", quantityOrdered: 0, unitCost: 0, notes: "" }],
    }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = form.lines.filter((l) => l.medicineId && l.quantityOrdered > 0);
    if (!form.vendorId || lines.length === 0) return;

    await api("/vendor-orders", {
      method: "POST",
      body: JSON.stringify({
        vendorId: form.vendorId,
        priority: form.priority,
        expectedDeliveryDate: form.expectedDeliveryDate || undefined,
        notes: form.notes || undefined,
        lines: lines.map((l) => ({
          medicineId: l.medicineId,
          quantityOrdered: l.quantityOrdered,
          unitCost: l.unitCost || undefined,
          notes: l.notes || undefined,
        })),
      }),
    });
    setSuccess("Vendor order submitted successfully");
    setShowForm(false);
    load();
  };

  const statusColor = (s: string) => {
    if (s === "RECEIVED") return "bg-green-100 text-green-700";
    if (s === "CONFIRMED") return "bg-blue-100 text-blue-700";
    if (s === "CANCELLED") return "bg-slate-100 text-slate-600";
    if (s === "SUBMITTED") return "bg-amber-100 text-amber-700";
    return "bg-slate-100 text-slate-700";
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Operations</Link>
          <h1 className="mt-1 text-2xl font-bold">Vendor Stock Orders</h1>
          <p className="text-sm text-muted-foreground">Order medicines from approved suppliers</p>
        </div>
        <Button size="lg" onClick={() => setShowForm(!showForm)}>+ New Vendor Order</Button>
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}

      {showForm && (
        <Card>
          <CardHeader><CardTitle>Place Vendor Order</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Vendor *</Label>
                  <select
                    className="h-11 w-full rounded-lg border px-3"
                    value={form.vendorId}
                    onChange={(e) => setForm({ ...form, vendorId: e.target.value })}
                    required
                  >
                    <option value="">Select vendor</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>{v.name} ({v.code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Priority</Label>
                  <select
                    className="h-11 w-full rounded-lg border px-3"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    <option value="ROUTINE">Routine</option>
                    <option value="URGENT">Urgent</option>
                    <option value="EMERGENCY">Emergency</option>
                  </select>
                </div>
                <div>
                  <Label>Expected delivery</Label>
                  <Input
                    type="date"
                    value={form.expectedDeliveryDate}
                    onChange={(e) => setForm({ ...form, expectedDeliveryDate: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Order notes</Label>
                  <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium">Order lines</p>
                {form.lines.map((line, i) => (
                  <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-4">
                    <div className="md:col-span-2">
                      <Label>Medicine</Label>
                      <select
                        className="h-11 w-full rounded-lg border px-3"
                        value={line.medicineId}
                        onChange={(e) => {
                          const lines = [...form.lines];
                          lines[i] = { ...lines[i], medicineId: e.target.value };
                          setForm({ ...form, lines });
                        }}
                        required
                      >
                        <option value="">Select</option>
                        {medicines.map((m) => (
                          <option key={m.id} value={m.id}>{m.medicineName}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <Label>Qty ordered</Label>
                      <Input
                        type="number"
                        min={1}
                        value={line.quantityOrdered || ""}
                        onChange={(e) => {
                          const lines = [...form.lines];
                          lines[i] = { ...lines[i], quantityOrdered: +e.target.value };
                          setForm({ ...form, lines });
                        }}
                        required
                      />
                    </div>
                    <div>
                      <Label>Unit cost</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={line.unitCost || ""}
                        onChange={(e) => {
                          const lines = [...form.lines];
                          lines[i] = { ...lines[i], unitCost: +e.target.value };
                          setForm({ ...form, lines });
                        }}
                      />
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" onClick={addLine}>+ Add line</Button>
              </div>

              <Button type="submit" size="lg" className="w-full">Submit Order to Vendor</Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {orders.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">No vendor orders yet.</CardContent>
          </Card>
        )}
        {orders.map((o) => (
          <Card key={o.id}>
            <CardContent className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{o.orderCode}</p>
                  <p className="text-sm text-muted-foreground">{o.vendor.name}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(o.status)}`}>
                  {o.status}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-sm">
                {o.lines.map((l, i) => (
                  <li key={i}>
                    {l.medicine.medicineName} — <strong>{l.quantityOrdered}</strong> units
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                {o.priority} · {new Date(o.createdAt).toLocaleDateString()}
                {o.expectedDeliveryDate && ` · Delivery ${new Date(o.expectedDeliveryDate).toLocaleDateString()}`}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
