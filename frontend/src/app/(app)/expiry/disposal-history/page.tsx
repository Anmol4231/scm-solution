"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonRows } from "@/components/ui/page-skeleton";

interface DisposalRecord {
  id: string; batchNumber: string; medicineName: string; quantity: number;
  disposalMethod: string; disposalWitness?: string | null; createdAt: string;
  facilityName?: string; processedByName?: string;
}

type SortField = "medicineName" | "batchNumber" | "quantity" | "disposalMethod" | "facilityName" | "processedByName" | "createdAt";

export default function DisposalHistoryPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("expiry");
  const isAdmin = isCrossFacilityRole(user?.role);

  const [records, setRecords] = useState<DisposalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);

  const [sortBy, setSortBy] = useState<SortField>("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (field: SortField) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("asc"); }
  };

  const load = useCallback(() => {
    setLoading(true); setError("");
    const params = isAdmin && facilityFilter ? `?facilityId=${facilityFilter}` : "";
    api<DisposalRecord[]>(`/expiry/disposal-history${params}`)
      .then(setRecords)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load disposal history"))
      .finally(() => setLoading(false));
  }, [isAdmin, facilityFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (isAdmin) api<{ id: string; name: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
  }, [isAdmin]);

  if (!hasAccess) return null;

  const sorted = [...records].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    let cmp = 0;
    switch (sortBy) {
      case "medicineName": cmp = a.medicineName.localeCompare(b.medicineName); break;
      case "batchNumber": cmp = a.batchNumber.localeCompare(b.batchNumber); break;
      case "quantity": cmp = a.quantity - b.quantity; break;
      case "disposalMethod": cmp = a.disposalMethod.localeCompare(b.disposalMethod); break;
      case "facilityName": cmp = (a.facilityName ?? "").localeCompare(b.facilityName ?? ""); break;
      case "processedByName": cmp = (a.processedByName ?? "").localeCompare(b.processedByName ?? ""); break;
      case "createdAt": cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break;
    }
    return cmp * dir;
  });

  const SortButton = ({ field, label }: { field: SortField; label: string }) => (
    <button type="button" onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide hover:text-medflow-700">
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${sortBy === field ? "text-medflow-600" : "text-slate-300"}`} />
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/expiry" className="text-sm text-medflow-600 hover:underline">← Expiry Management</Link>
          <h1 className="mt-0.5 text-2xl font-bold">Disposal History</h1>
          <p className="text-sm text-slate-500">Record of all expired-stock disposals.</p>
        </div>
        {isAdmin && (
          <select value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)} className="h-9 rounded-lg border bg-white px-2 text-sm">
            <option value="">All facilities</option>
            {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50 text-left text-sm font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2"><SortButton field="medicineName" label="Medicine" /></th>
                  <th className="px-4 py-2"><SortButton field="batchNumber" label="Batch" /></th>
                  <th className="px-4 py-2"><SortButton field="quantity" label="Qty" /></th>
                  <th className="px-4 py-2"><SortButton field="disposalMethod" label="Method" /></th>
                  <th className="px-4 py-2">Witness</th>
                  {isAdmin && <th className="px-4 py-2"><SortButton field="facilityName" label="Facility" /></th>}
                  <th className="px-4 py-2"><SortButton field="processedByName" label="Processed by" /></th>
                  <th className="px-4 py-2"><SortButton field="createdAt" label="Date" /></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <SkeletonRows rows={8} cols={isAdmin ? 8 : 7} />
                ) : sorted.length === 0 ? (
                  <tr><td colSpan={isAdmin ? 8 : 7} className="px-4 py-6 text-center text-sm text-slate-500">No disposal records yet.</td></tr>
                ) : (
                  sorted.map((h) => (
                    <tr key={h.id} className="border-b last:border-0 hover:bg-slate-50/60">
                      <td className="px-4 py-2.5 font-medium text-slate-800">{h.medicineName}</td>
                      <td className="px-4 py-2.5 font-mono text-sm text-slate-600">{h.batchNumber}</td>
                      <td className="px-4 py-2.5 text-slate-600">{h.quantity}</td>
                      <td className="px-4 py-2.5 text-slate-600">{h.disposalMethod}</td>
                      <td className="px-4 py-2.5 text-slate-500">{h.disposalWitness || <span className="text-slate-300">—</span>}</td>
                      {isAdmin && <td className="px-4 py-2.5 text-slate-500">{h.facilityName ?? "—"}</td>}
                      <td className="px-4 py-2.5 text-slate-500">{h.processedByName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-slate-500">{new Date(h.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
