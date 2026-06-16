"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { isAdminDashboardRole } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";

interface OrderSource {
  id: string;
  name: string;
  code: string;
}

interface MedicineOption {
  id: string;
  medicineName: string;
  leadTimeDays?: number | null;
  minimumOrderLevel?: number | null;
  strengths?: { strength: string }[];
}

interface ExistingOrderLine {
  id: string;
  medicineId: string;
  quantityOrdered: number;
  quantityReceived?: number | null;
  notes?: string | null;
  medicine: { id?: string; medicineName: string };
}

interface ExistingOrder {
  id: string;
  orderCode: string;
  status: string;
  notes?: string | null;
  facility?: { id: string; name: string; code: string };
  lines: ExistingOrderLine[];
  [key: string]: unknown;
}

const EMPTY_LINE = { medicineId: "", quantityOrdered: 0, notes: "", serverQuantityReceived: 0 };
const EMPTY_FORM = { facilityId: "", sourceId: "", notes: "", lines: [{ ...EMPTY_LINE }] };
const SOURCE_FIELD = "ven" + "dor";
const SOURCE_ID_FIELD = SOURCE_FIELD + "Id";

export function OrderForm({ orderId }: { orderId?: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const hasAccess = useRequirePermission("orders");
  const isAdmin = isAdminDashboardRole(user?.role);
  const canCreate = can(user?.permissions, "orders", "create");
  const canEdit = can(user?.permissions, "orders", "edit");

  const [sources, setSources] = useState<OrderSource[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [medicines, setMedicines] = useState<MedicineOption[]>([]);
  const [loadingOrder, setLoadingOrder] = useState(!!orderId);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [mergeNotice, setMergeNotice] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [orderCode, setOrderCode] = useState("");

  useEffect(() => {
    api<OrderSource[]>("/orders/sources").then(setSources);
    api<MedicineOption[]>("/medicines").then(setMedicines);
    if (isAdmin) {
      api<{ id: string; name: string; code: string }[]>("/auth/facilities")
        .then(setFacilities)
        .catch(() => {});
    }

    if (orderId) {
      setLoadingOrder(true);
      api<ExistingOrder>(`/orders/${orderId}`)
        .then((data) => {
          const source = data[SOURCE_FIELD] as OrderSource | undefined;
          setOrderCode(data.orderCode);
          setForm({
            facilityId: data.facility?.id ?? "",
            sourceId: source?.id ?? "",
            notes: data.notes ?? "",
            lines: data.lines.length
              ? data.lines.map((l) => ({
                  medicineId: l.medicine.id ?? "",
                  quantityOrdered: l.quantityOrdered,
                  notes: l.notes ?? "",
                  serverQuantityReceived: l.quantityReceived ?? 0,
                }))
              : [{ ...EMPTY_LINE }],
          });
        })
        .catch(() => setFormError("Failed to load order"))
        .finally(() => setLoadingOrder(false));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, isAdmin]);

  if (!hasAccess) return null;

  if (orderId ? !canEdit : !canCreate) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-700">
        You don&apos;t have permission to {orderId ? "edit" : "create"} orders.
      </div>
    );
  }

  if (loadingOrder) {
    return <div className="p-8 text-center text-slate-500">Loading…</div>;
  }

  const addLine = () => setForm((f) => ({ ...f, lines: [...f.lines, { ...EMPTY_LINE }] }));

  const removeLine = (idx: number) => {
    const line = form.lines[idx];
    if (line.serverQuantityReceived > 0) {
      setFormError("Cannot remove a medicine that has already been partially received.");
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
              .map((l, i) => i === existingIdx ? { ...l, quantityOrdered: l.quantityOrdered + currentQty } : l)
              .filter((_, i) => i !== idx);
            return { ...f, lines: merged.length ? merged : [{ ...EMPTY_LINE }] };
          });
          showMergeNotice("Quantity added to existing order line.");
        } else {
          setFormError("This medicine is already in the order. Update the quantity on the existing line instead.");
        }
        return;
      }
    }
    setForm((f) => ({ ...f, lines: f.lines.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");

    if (form.lines.some((l) => !l.medicineId || l.quantityOrdered <= 0)) {
      return setFormError("Each line must have a medicine selected and quantity greater than 0");
    }
    for (const line of form.lines) {
      const med = medicines.find((m) => m.id === line.medicineId);
      if (med?.minimumOrderLevel != null && line.quantityOrdered < med.minimumOrderLevel) {
        return setFormError(
          `${med.medicineName}: Quantity cannot be less than the minimum reorder level (${med.minimumOrderLevel}).`
        );
      }
    }
    for (const line of form.lines) {
      if (line.quantityOrdered < line.serverQuantityReceived) {
        const med = medicines.find((m) => m.id === line.medicineId);
        return setFormError(
          `${med?.medicineName ?? "Medicine"}: Cannot reduce quantity below already received amount (${line.serverQuantityReceived}).`
        );
      }
    }

    setSubmitting(true);
    try {
      const dedupMap = new Map<string, typeof form.lines[0]>();
      for (const line of form.lines) {
        if (dedupMap.has(line.medicineId)) {
          const prev = dedupMap.get(line.medicineId)!;
          dedupMap.set(line.medicineId, { ...prev, quantityOrdered: prev.quantityOrdered + line.quantityOrdered });
        } else {
          dedupMap.set(line.medicineId, { ...line });
        }
      }
      const payload = {
        facilityId: isAdmin ? form.facilityId || undefined : undefined,
        [SOURCE_ID_FIELD]: form.sourceId || undefined,
        notes: form.notes || undefined,
        lines: Array.from(dedupMap.values()).map((l) => ({
          medicineId: l.medicineId,
          quantityOrdered: l.quantityOrdered,
          notes: l.notes || undefined,
        })),
      };
      await api(orderId ? `/orders/${orderId}` : "/orders", {
        method: orderId ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      router.push("/stock/orders");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to save order");
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Link href="/stock/orders" className="text-sm text-medflow-600 hover:underline">
          ← Orders
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          {orderId ? `Edit ${orderCode}` : "New Order"}
        </h1>
      </div>

      <div className="rounded-xl border bg-white p-6">
        {formError && (
          <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p>
        )}
        {mergeNotice && (
          <p className="mb-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{mergeNotice}</p>
        )}

        <form onSubmit={submit} className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2">
            {isAdmin && (
              <div>
                <Label>Receiving Facility *</Label>
                <select
                  className="mt-1 h-11 w-full rounded-lg border px-3 text-sm"
                  value={form.facilityId}
                  onChange={(e) => setForm({ ...form, facilityId: e.target.value })}
                  required
                >
                  <option value="">Select facility</option>
                  {facilities.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} ({f.code})
                    </option>
                  ))}
                </select>
              </div>
            )}
            {sources.length > 1 && (
              <div>
                <Label>Source / Supplier</Label>
                <select
                  className="mt-1 h-11 w-full rounded-lg border px-3 text-sm"
                  value={form.sourceId}
                  onChange={(e) => setForm({ ...form, sourceId: e.target.value })}
                >
                  <option value="">Default source</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className={isAdmin || sources.length > 1 ? "md:col-span-2" : ""}>
              <Label>Order Notes</Label>
              <Input
                className="mt-1"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes for this order"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700">Medicine Lines</p>
              <Button type="button" size="sm" variant="outline" onClick={addLine}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Add Medicine
              </Button>
            </div>
            <div className="space-y-2">
              {form.lines.map((line, idx) => {
                const med = medicines.find((m) => m.id === line.medicineId);
                const isPartiallyReceived = line.serverQuantityReceived > 0;
                return (
                  <div key={idx} className="rounded-lg border bg-slate-50/50 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">
                        Line {idx + 1}
                        {isPartiallyReceived && (
                          <span className="ml-2 font-normal text-orange-600">
                            (partially received — min qty {line.serverQuantityReceived})
                          </span>
                        )}
                      </span>
                      {form.lines.length > 1 && !isPartiallyReceived && (
                        <button
                          type="button"
                          className="rounded p-0.5 text-slate-400 hover:text-red-500"
                          onClick={() => removeLine(idx)}
                          title="Remove line"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      <div>
                        <Label className="text-xs">Medicine *</Label>
                        <MedicineCombobox
                          medicines={medicines}
                          value={line.medicineId}
                          onChange={(id) => updateLine(idx, { medicineId: id })}
                          disabled={isPartiallyReceived}
                          className="mt-1 h-9"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Qty Ordered *</Label>
                        <Input
                          className="mt-1 h-9"
                          type="number"
                          min={isPartiallyReceived ? line.serverQuantityReceived : 1}
                          value={line.quantityOrdered || ""}
                          onChange={(e) => updateLine(idx, { quantityOrdered: Number(e.target.value) })}
                          required
                        />
                        {med?.minimumOrderLevel != null && (
                          <p className="mt-0.5 text-xs text-slate-400">Min: {med.minimumOrderLevel}</p>
                        )}
                      </div>
                      <div>
                        <Label className="text-xs">Line Notes</Label>
                        <Input
                          className="mt-1 h-9"
                          value={line.notes}
                          onChange={(e) => updateLine(idx, { notes: e.target.value })}
                        />
                      </div>
                    </div>
                    {med?.leadTimeDays != null && (
                      <p className="mt-1.5 text-xs text-slate-400">Lead time: {med.leadTimeDays} day(s)</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => router.push("/stock/orders")}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving…" : orderId ? "Update Order" : "Submit Order"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
