"use client";

import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { api } from "@/lib/api";
import { FacilitySwitcher } from "@/components/layout/facility-switcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminDashboardPage() {
  const [data, setData] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    api<Record<string, unknown>>("/dashboard/admin").then(setData).catch(console.error);
  }, []);

  const stats = (data?.facilityStats as { facility: { name: string }; stockoutCount: number; lowCount: number; expiringBatches: number; nonReporting: boolean }[]) || [];
  const heatmap = (data?.expiryHeatmap as { facility: string; medicine: string; days: number }[]) || [];

  const chartData = stats.map((s) => ({
    name: s.facility.name.split(" ")[0],
    stockouts: s.stockoutCount,
    low: s.lowCount,
    expiring: s.expiringBatches,
  }));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Provincial Admin Dashboard</h1>
      <FacilitySwitcher />

      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((s, i) => (
          <Card key={i}>
            <CardHeader><CardTitle className="text-base">{s.facility.name}</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <p>Stockouts: <strong className="text-red-600">{s.stockoutCount}</strong></p>
              <p>Low stock: <strong className="text-amber-600">{s.lowCount}</strong></p>
              <p>Expiring batches: {s.expiringBatches}</p>
              {s.nonReporting && <p className="text-red-600 font-semibold">⚠ Non-reporting &gt;7 days</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>Facility Comparison</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="stockouts" fill="#ef4444" name="Stockouts" />
              <Bar dataKey="low" fill="#f59e0b" name="Low Stock" />
              <Bar dataKey="expiring" fill="#0ea5e9" name="Expiring" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Expiry Heatmap</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b"><th className="p-2 text-left">Facility</th><th className="p-2 text-left">Medicine</th><th className="p-2">Days left</th></tr></thead>
            <tbody>
              {heatmap.slice(0, 20).map((h, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2">{h.facility}</td>
                  <td className="p-2">{h.medicine}</td>
                  <td className="p-2">
                    <span className={h.days <= 30 ? "font-bold text-red-600" : h.days <= 90 ? "text-amber-600" : ""}>
                      {h.days}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
