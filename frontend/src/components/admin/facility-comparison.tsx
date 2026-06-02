"use client";

import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface FacilityStat {
  facility: { id: string; name: string; code: string; facilityType?: string | null };
  totalStock: number;
  lowCount: number;
  stockoutCount: number;
  expiringBatches: number;
  patientsCount: number;
  patientsServedToday: number;
  dispensingCount: number;
  nonReporting: boolean;
}

export function FacilityComparison({ stats }: { stats: FacilityStat[] }) {
  const chartData = stats.map((s) => ({
    name: s.facility.name.length > 14 ? `${s.facility.name.slice(0, 12)}…` : s.facility.name,
    stock: Math.round(s.totalStock),
    patients: s.patientsCount,
    dispensing: s.dispensingCount,
    expiring: s.expiringBatches,
  }));

  return (
    <div className="space-y-4">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">Facility Comparison</CardTitle></CardHeader>
        <CardContent className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="stock" fill="#0ea5e9" name="Stock" radius={[2, 2, 0, 0]} />
              <Bar dataKey="patients" fill="#6366f1" name="Patients" radius={[2, 2, 0, 0]} />
              <Bar dataKey="dispensing" fill="#2563eb" name="Dispensing (30d)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="expiring" fill="#f59e0b" name="Expiring batches" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {stats.map((s) => (
          <Card
            key={s.facility.id}
            className={`border-slate-200 shadow-sm transition hover:shadow-md ${s.nonReporting ? "ring-1 ring-red-200" : ""}`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-800">{s.facility.name}</CardTitle>
              <p className="text-xs text-slate-500">{s.facility.code}</p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-slate-500">Stock</span><p className="font-semibold">{Math.round(s.totalStock)}</p></div>
              <div><span className="text-slate-500">Patients</span><p className="font-semibold">{s.patientsCount}</p></div>
              <div><span className="text-slate-500">Served today</span><p className="font-semibold">{s.patientsServedToday}</p></div>
              <div><span className="text-slate-500">Dispensing (30d)</span><p className="font-semibold">{s.dispensingCount}</p></div>
              <div><span className="text-slate-500">Low / Stockout</span><p><span className="text-amber-600">{s.lowCount}</span> / <span className="text-red-600">{s.stockoutCount}</span></p></div>
              <div><span className="text-slate-500">Expiring</span><p className="font-semibold text-sky-700">{s.expiringBatches}</p></div>
              {s.nonReporting && <p className="col-span-2 text-xs font-medium text-red-600">Non-reporting facility</p>}
            </CardContent>
          </Card>
        ))}
      </div>

    </div>
  );
}

export function ExpiryHeatmapTable({
  rows,
}: {
  rows: { facility: string; medicine: string; batch: string; days: number; quantity: number; medicineId?: string }[];
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader><CardTitle className="text-base">Expiry Heatmap</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
              <th className="p-2">Facility</th>
              <th className="p-2">Medicine</th>
              <th className="p-2">Batch</th>
              <th className="p-2 text-right">Days</th>
              <th className="p-2 text-right">Qty</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 25).map((h, i) => (
              <tr key={i} className="border-b transition hover:bg-slate-50">
                <td className="p-2">{h.facility}</td>
                <td className="p-2">
                  {h.medicineId ? (
                    <Link href={`/medicines/${h.medicineId}`} className="text-medflow-600 hover:underline">
                      {h.medicine}
                    </Link>
                  ) : (
                    h.medicine
                  )}
                </td>
                <td className="p-2 text-slate-600">{h.batch}</td>
                <td className="p-2 text-right">
                  <span className={h.days <= 30 ? "font-bold text-red-600" : h.days <= 90 ? "text-amber-600" : ""}>
                    {h.days}
                  </span>
                </td>
                <td className="p-2 text-right">{h.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
