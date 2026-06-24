"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole, isCrossFacilityRole } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicineCombobox } from "@/components/ui/medicine-combobox";
import { formatDateTime } from "@/lib/datetime";

interface Facility { id: string; name: string; code: string; facilityType: string }
interface Medicine { id: string; medicineName: string }
interface Batch { id: string; batchNumber: string; expiryDate: string; quantity: number; medicine: { id: string; medicineName: string } }

// A batch is returnable only if it still holds stock and has not expired.
function isExpired(b: Batch): boolean {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  return new Date(b.expiryDate) < start;
}
interface ReturnRecord {
  id: string;
  returnType: string;
  quantity: number;
  returnReason: string;
  batchNumber?: string | null;
  createdAt: string;
  medicine: { medicineName: string };
  patient?: { firstName: string; lastName: string; patientId: string } | null;
  processedBy?: { firstName: string; lastName: string } | null;
}

const STORE_TYPES = ["AMS_CENTRAL", "MEDICAL_STORE", "WAREHOUSE", "REGIONAL_STORE"];

const TYPE_LABEL: Record<string, string> = {
  FACILITY_TO_AMS: "→ AMS",
  INTER_FACILITY: "Transfer Return",
};
const TYPE_COLOR: Record<string, string> = {
  FACILITY_TO_AMS: "bg-purple-100 text-purple-700",
  INTER_FACILITY: "bg-teal-100 text-teal-700",
};

const emptyAms = { receivingFacilityId: "", medicineId: "", batchId: "", quantity: 0, returnReason: "Near expiry" };

export default function ReturnsPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("returns");
  const isAdmin = isAdminDashboardRole(user?.role);
  const isCrossFacility = isCrossFacilityRole(user?.role);
  const canCreate = can(user?.permissions, "returns", "create");

  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [loadingReturns, setLoadingReturns] = useState(true);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [facilityFilter, setFacilityFilter] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [ams, setAms] = useState(emptyAms);
  // Source facility whose stock is being returned. Facility-scoped users use their own;
  // cross-facility roles must choose one (they have no assigned facility).
  const [sourceFacilityId, setSourceFacilityId] = useState(user?.facilityId ?? "");
  const [batches, setBatches] = useState<Batch[]>([]);

  // Sorting for the returns history table
  const [sortBy, setSortBy] = useState<"returnType" | "medicine" | "quantity" | "returnReason" | "processedBy" | "createdAt">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("asc"); }
  };

  const load = () => {
    setLoadingReturns(true);
    const params = new URLSearchParams();
    if (isAdmin && facilityFilter) params.set("facilityId", facilityFilter);
    api<ReturnRecord[]>(`/returns?${params}`)
      .then((r) => setReturns(r.filter((x) => x.returnType !== "PATIENT_RETURN")))
      .catch(() => {})
      .finally(() => setLoadingReturns(false));
  };

  useEffect(() => { load(); }, [facilityFilter, isAdmin]);
  useEffect(() => {
    api<Facility[]>("/auth/facilities").then(setAllFacilities).catch(() => {});
  }, []);

  // Load the source facility's batches (mirrors the Transfers "Send" workflow).
  useEffect(() => {
    const facId = sourceFacilityId || user?.facilityId;
    if (!facId) { setBatches([]); return; }
    api<Batch[]>(`/stock/batches?facilityId=${facId}`).then(setBatches).catch(() => setBatches([]));
  }, [sourceFacilityId, user?.facilityId]);

  if (!hasAccess) return null;

  const effectiveSourceId = sourceFacilityId || user?.facilityId || "";
  // Only in-stock, non-expired batches can be returned.
  const availableBatches = batches.filter((b) => b.quantity > 0 && !isExpired(b));
  // Distinct medicines that have at least one returnable batch, for the search box.
  const medicineOptions = Array.from(
    new Map(availableBatches.map((b) => [b.medicine.id, { id: b.medicine.id, medicineName: b.medicine.medicineName }])).values()
  ).sort((a, b) => a.medicineName.localeCompare(b.medicineName));
  const batchesForMedicine = availableBatches.filter((b) => b.medicine.id === ams.medicineId);
  const selectedBatch = availableBatches.find((b) => b.id === ams.batchId);
  // AMS / store destinations, excluding the source facility itself.
  const amsFacilities = allFacilities.filter(
    (f) => STORE_TYPES.includes(f.facilityType) && f.id !== effectiveSourceId
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setMsg("");
    if (!ams.batchId || +ams.quantity <= 0) { setError("Select a batch and a quantity greater than 0."); return; }
    if (selectedBatch && +ams.quantity > selectedBatch.quantity) {
      setError(`Quantity exceeds available stock (${selectedBatch.quantity}).`);
      return;
    }
    setBusy(true);
    try {
      await api("/returns/facility", {
        method: "POST",
        body: JSON.stringify({
          returnType: "FACILITY_TO_AMS",
          receivingFacilityId: ams.receivingFacilityId,
          batchId: ams.batchId,
          quantity: +ams.quantity,
          returnReason: ams.returnReason,
        }),
      });
      setMsg("Return to AMS processed successfully.");
      setShowForm(false);
      setAms(emptyAms);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to process return");
    } finally {
      setBusy(false);
    }
  };

  const personName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : "—");

  const sortedReturns = [...returns].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    let cmp = 0;
    switch (sortBy) {
      case "returnType": cmp = a.returnType.localeCompare(b.returnType); break;
      case "medicine": cmp = (a.medicine?.medicineName ?? "").localeCompare(b.medicine?.medicineName ?? ""); break;
      case "quantity": cmp = a.quantity - b.quantity; break;
      case "returnReason": cmp = a.returnReason.localeCompare(b.returnReason); break;
      case "processedBy": cmp = personName(a.processedBy).localeCompare(personName(b.processedBy)); break;
      case "createdAt": cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break;
    }
    return cmp * dir;
  });

  const SortButton = ({ field, label }: { field: typeof sortBy; label: string }) => (
    <button type="button" onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 font-medium hover:text-medflow-700">
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${sortBy === field ? "text-medflow-600" : "text-slate-300"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 text-2xl font-bold">Returns to AMS</h1>
          <p className="text-sm text-slate-500">
            {isAdmin
              ? facilityFilter ? allFacilities.find((f) => f.id === facilityFilter)?.name : "All Facilities"
              : user?.facility?.name ?? "Assigned facility"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select className="h-10 rounded-lg border bg-white px-3 text-sm" value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)}>
              <option value="">All Facilities</option>
              {allFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
            </select>
          )}
          {canCreate && (
            <Button
              size="lg"
              variant={showForm ? "outline" : "default"}
              className={showForm ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100 hover:text-red-800" : undefined}
              onClick={() => { setShowForm((s) => !s); setError(""); setMsg(""); }}
            >
              {showForm ? "Close" : "+ Return to AMS"}
            </Button>
          )}
        </div>
      </div>


      {msg && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* New Return to AMS form */}
      {showForm && canCreate && (
        <Card>
          <CardHeader><CardTitle>Return to AMS</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-3">
              {isCrossFacility ? (
                <div>
                  <Label>Source Facility *</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm"
                    value={sourceFacilityId}
                    onChange={(e) => { setSourceFacilityId(e.target.value); setAms(emptyAms); }}
                    required
                  >
                    <option value="">Select source facility…</option>
                    {allFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
                  </select>
                </div>
              ) : user?.facility && (
                <div>
                  <Label>Source Facility</Label>
                  <p className="mt-1 text-sm font-medium text-slate-700">{user.facility.name}</p>
                </div>
              )}
              <div>
                <Label>Receiving AMS / Medical Store *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm" value={ams.receivingFacilityId} onChange={(e) => setAms({ ...ams, receivingFacilityId: e.target.value })} required>
                  <option value="">Select AMS…</option>
                  {amsFacilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.facilityType})</option>)}
                </select>
              </div>
              <div>
                <Label>Medicine *</Label>
                <MedicineCombobox
                  medicines={medicineOptions}
                  value={ams.medicineId}
                  onChange={(id) => setAms({ ...ams, medicineId: id, batchId: "" })}
                  placeholder={availableBatches.length ? "Search medicine to return…" : "No returnable stock at this facility"}
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Batch *</Label>
                  <select
                    className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm disabled:bg-slate-50 disabled:cursor-not-allowed"
                    value={ams.batchId}
                    onChange={(e) => setAms({ ...ams, batchId: e.target.value })}
                    disabled={!ams.medicineId}
                    required
                  >
                    <option value="">{ams.medicineId ? "Select batch…" : "Select a medicine first"}</option>
                    {batchesForMedicine.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batchNumber} (qty: {b.quantity}, exp: {new Date(b.expiryDate).toLocaleDateString()})
                      </option>
                    ))}
                  </select>
                  {selectedBatch && <p className="mt-0.5 text-sm text-slate-400">Available: {selectedBatch.quantity}</p>}
                </div>
                <div>
                  <Label>Quantity *</Label>
                  <Input type="number" min={1} max={selectedBatch?.quantity} value={ams.quantity || ""} onChange={(e) => setAms({ ...ams, quantity: +e.target.value })} required />
                </div>
              </div>
              <div>
                <Label>Return Reason *</Label>
                <select className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm" value={ams.returnReason} onChange={(e) => setAms({ ...ams, returnReason: e.target.value })}>
                  <option>Near expiry</option>
                  <option>Surplus stock</option>
                  <option>Product recall</option>
                  <option>Damaged</option>
                  <option>Other</option>
                </select>
              </div>
              <p className="text-sm text-slate-500">Stock will be immediately decremented from your facility and credited to the AMS.</p>
              <Button type="submit" disabled={busy}>Process Return to AMS</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Returns history */}
      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3"><SortButton field="returnType" label="Type" /></th>
                <th className="p-3"><SortButton field="medicine" label="Medicine" /></th>
                <th className="p-3 text-right"><SortButton field="quantity" label="Qty" /></th>
                <th className="p-3"><SortButton field="returnReason" label="Reason" /></th>
                <th className="p-3"><SortButton field="processedBy" label="Processed By" /></th>
                <th className="p-3"><SortButton field="createdAt" label="Date" /></th>
              </tr>
            </thead>
            <tbody>
              {loadingReturns ? (
                <SkeletonRows rows={5} cols={6} />
              ) : sortedReturns.map((r) => (
                <tr key={r.id} className="border-b align-middle">
                  <td className="p-3">
                    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${TYPE_COLOR[r.returnType] ?? "bg-slate-100 text-slate-600"}`}>
                      {TYPE_LABEL[r.returnType] ?? r.returnType.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-3 font-medium">{r.medicine?.medicineName ?? "—"}</td>
                  <td className="p-3 text-right">{r.quantity}</td>
                  <td className="p-3 text-slate-600">{r.returnReason}</td>
                  <td className="p-3 text-slate-600">{personName(r.processedBy)}</td>
                  <td className="p-3 whitespace-nowrap text-slate-500">{formatDateTime(r.createdAt)}</td>
                </tr>
              ))}
              {!loadingReturns && returns.length === 0 && (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No returns recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
