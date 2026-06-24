"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useMedicines } from "@/lib/medicines-cache";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";

export default function AdjustmentPage() {
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);
  const { data: medicines = [] } = useMedicines();
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [systemBalance, setSystemBalance] = useState<number | null>(null);
  const [form, setForm] = useState({ medicineId: "", physicalCount: "", reason: "", facilityId: user?.facilityId ?? "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isAdmin) api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
  }, [isAdmin]);

  // Balance is facility-specific; re-fetch when the medicine or (admin) facility changes.
  useEffect(() => {
    setSystemBalance(null);
    const fac = form.facilityId || user?.facilityId;
    if (form.medicineId && fac) {
      const facParam = isAdmin && form.facilityId ? `&facilityId=${form.facilityId}` : "";
      api<{ balance: number }>(`/stock/balance?medicineId=${form.medicineId}${facParam}`).then((r) => setSystemBalance(r.balance)).catch(() => setSystemBalance(null));
    }
  }, [form.medicineId, form.facilityId, isAdmin, user?.facilityId]);

  const physical = form.physicalCount === "" ? null : Number(form.physicalCount);
  const discrepancy = systemBalance != null && physical != null ? physical - systemBalance : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess("");
    if (isAdmin && !form.facilityId) return setError("Select a facility");
    if (!form.medicineId) return setError("Select a medicine");
    if (physical == null) return setError("Enter the physical count");
    if (!form.reason.trim()) return setError("A discrepancy reason is required");
    setBusy(true);
    try {
      await api("/stock/adjustment", {
        method: "POST",
        body: JSON.stringify({
          medicineId: form.medicineId,
          physicalCount: physical,
          reason: form.reason.trim(),
          ...(isAdmin && form.facilityId ? { facilityId: form.facilityId } : {}),
        }),
      });
      const name = medicines.find((m) => m.id === form.medicineId)?.medicineName ?? "medicine";
      setSuccess(`Adjusted ${name} to a balance of ${physical}.`);
      setForm((f) => ({ medicineId: "", physicalCount: "", reason: "", facilityId: f.facilityId }));
      setSystemBalance(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save adjustment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
      <h1 className="text-2xl font-bold">Physical Adjustment</h1>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4">
            {isAdmin && (
              <div>
                <Label>Facility *</Label>
                <select
                  className="mt-1 h-11 w-full rounded-lg border bg-white px-3 text-sm"
                  value={form.facilityId}
                  onChange={(e) => setForm({ ...form, facilityId: e.target.value, medicineId: "" })}
                  required
                >
                  <option value="">Select facility</option>
                  {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                </select>
              </div>
            )}
            <div>
              <Label>Medicine *</Label>
              <MedicineCombobox
                medicines={medicines}
                value={form.medicineId}
                onChange={(id) => setForm({ ...form, medicineId: id })}
                className="h-11"
              />
            </div>
            {systemBalance != null && (
              <div className="grid grid-cols-3 gap-3 text-center text-sm">
                <div className="rounded-lg bg-slate-100 px-3 py-4">
                  <p className="mb-1 text-sm text-slate-500">System balance</p>
                  <p className="text-xl font-bold tabular-nums text-slate-700">{systemBalance}</p>
                </div>
                <div className="rounded-lg bg-slate-100 px-3 py-4">
                  <p className="mb-1 text-sm text-slate-500">Physical count</p>
                  <p className="text-xl font-bold tabular-nums text-slate-700">{physical ?? "—"}</p>
                </div>
                <div className={`rounded-lg px-3 py-4 ${discrepancy == null ? "bg-slate-100" : discrepancy === 0 ? "bg-emerald-50" : "bg-amber-50"}`}>
                  <p className="mb-1 text-sm text-slate-500">Difference</p>
                  <p className={`text-xl font-bold tabular-nums ${discrepancy == null ? "text-slate-700" : discrepancy === 0 ? "text-emerald-700" : "text-amber-700"}`}>
                    {discrepancy == null ? "—" : discrepancy > 0 ? `+${discrepancy}` : discrepancy}
                  </p>
                </div>
              </div>
            )}
            <div><Label>Physical count *</Label><Input inputMode="numeric" value={form.physicalCount} onChange={(e) => setForm({ ...form, physicalCount: e.target.value.replace(/\D/g, "") })} placeholder="counted quantity" required /></div>
            <div><Label>Discrepancy reason *</Label><Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Reason for adjustment" required /></div>
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save Adjustment"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
