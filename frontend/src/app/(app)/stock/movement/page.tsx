"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";

interface MovementRow {
  medicineId: string;
  medicineName: string;
  category: string;
  openingBalance: number;
  receipts: number;
  transfersIn: number;
  returnsIn: number;
  consumptions: number;
  dispensings: number;
  transfersOut: number;
  disposals: number;
  adjustments: number;
  closingBalance: number;
}

interface MovementReport {
  period: { from: string; to: string };
  facilityId: string | null;
  rows: MovementRow[];
}

function getMonthRange(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  const from = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export default function StockMovementPage() {
  const { user } = useAuth();
  const isAdmin = isAdminDashboardRole(user?.role);

  const [from, setFrom] = useState(getMonthRange().from);
  const [to, setTo] = useState(getMonthRange().to);
  const [facilityId, setFacilityId] = useState("");
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [facilitiesLoaded, setFacilitiesLoaded] = useState(false);
  const [report, setReport] = useState<MovementReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadFacilities = () => {
    if (!facilitiesLoaded && isAdmin) {
      api<{ id: string; name: string; code: string }[]>("/auth/facilities").then((f) => { setFacilities(f); setFacilitiesLoaded(true); });
    }
  };

  const runReport = async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (isAdmin && facilityId) params.set("facilityId", facilityId);
      const data = await api<MovementReport>(`/stock/movement?${params}`);
      setReport(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load report");
    } finally {
      setLoading(false);
    }
  };

  const setQuickRange = (offsetMonths: number) => {
    const r = getMonthRange(offsetMonths);
    setFrom(r.from); setTo(r.to);
  };

  const total = (field: keyof MovementRow) =>
    report?.rows.reduce((sum, r) => sum + (Number(r[field]) || 0), 0) ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
        <h1 className="mt-1 text-2xl font-bold">Stock Movement Report</h1>
        <p className="text-sm text-slate-500">Opening balance + receipts − issues = closing balance per period</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-slate-50 p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-lg border px-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-600">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-lg border px-2 text-sm" />
        </div>
        {isAdmin && (
          <div onFocus={loadFacilities}>
            <label className="mb-1 block text-sm font-medium text-slate-600">Facility</label>
            <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)} className="h-9 rounded-lg border px-2 text-sm">
              <option value="">All Facilities</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setQuickRange(0)}>This Month</Button>
          <Button variant="outline" size="sm" onClick={() => setQuickRange(-1)}>Last Month</Button>
        </div>
        <Button onClick={runReport} disabled={loading}>{loading ? "Loading…" : "Run Report"}</Button>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {report && (
        <>
          <p className="text-sm text-slate-500">
            Period: <strong>{report.period.from}</strong> to <strong>{report.period.to}</strong>
            {" · "}{report.rows.length} medicine{report.rows.length !== 1 ? "s" : ""}
          </p>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Medicine</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Opening</th>
                  <th className="px-3 py-2 text-right font-medium text-emerald-700">Receipts</th>
                  <th className="px-3 py-2 text-right font-medium text-emerald-700">Transfers In</th>
                  <th className="px-3 py-2 text-right font-medium text-emerald-700">Returns In</th>
                  <th className="px-3 py-2 text-right font-medium text-red-600">Consumed</th>
                  <th className="px-3 py-2 text-right font-medium text-red-600">Dispensed</th>
                  <th className="px-3 py-2 text-right font-medium text-red-600">Transfers Out</th>
                  <th className="px-3 py-2 text-right font-medium text-red-600">Disposals</th>
                  <th className="px-3 py-2 text-right font-medium text-slate-500">Adjustments</th>
                  <th className="px-3 py-2 text-right font-medium">Closing</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.rows.map((row) => (
                  <tr key={row.medicineId} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium">{row.medicineName}</td>
                    <td className="px-3 py-2 text-slate-500">{row.category}</td>
                    <td className="px-3 py-2 text-right">{row.openingBalance}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">+{row.receipts}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">+{row.transfersIn}</td>
                    <td className="px-3 py-2 text-right text-emerald-700">+{row.returnsIn}</td>
                    <td className="px-3 py-2 text-right text-red-600">-{row.consumptions}</td>
                    <td className="px-3 py-2 text-right text-red-600">-{row.dispensings}</td>
                    <td className="px-3 py-2 text-right text-red-600">-{row.transfersOut}</td>
                    <td className="px-3 py-2 text-right text-red-600">-{row.disposals}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{row.adjustments >= 0 ? "+" : ""}{row.adjustments}</td>
                    <td className={`px-3 py-2 text-right font-semibold ${row.closingBalance < 0 ? "text-red-600" : ""}`}>{row.closingBalance}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t bg-slate-50 text-sm font-semibold text-slate-700">
                <tr>
                  <td className="px-3 py-2" colSpan={2}>Totals</td>
                  <td className="px-3 py-2 text-right">{total("openingBalance")}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">+{total("receipts")}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">+{total("transfersIn")}</td>
                  <td className="px-3 py-2 text-right text-emerald-700">+{total("returnsIn")}</td>
                  <td className="px-3 py-2 text-right text-red-600">-{total("consumptions")}</td>
                  <td className="px-3 py-2 text-right text-red-600">-{total("dispensings")}</td>
                  <td className="px-3 py-2 text-right text-red-600">-{total("transfersOut")}</td>
                  <td className="px-3 py-2 text-right text-red-600">-{total("disposals")}</td>
                  <td className="px-3 py-2 text-right text-slate-500">{total("adjustments") >= 0 ? "+" : ""}{total("adjustments")}</td>
                  <td className="px-3 py-2 text-right">{total("closingBalance")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
