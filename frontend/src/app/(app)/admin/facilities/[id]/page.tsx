"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminFacilityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<{
    facility: { id: string; name: string; code: string; facilityType?: string; province?: string; district?: string; phone?: string };
    health: { status: string; stockoutCount: number; lowCount: number; expiringBatches: number };
    patients: number;
    workers: number;
    pendingTransfers: number;
    alerts: { id: string; title: string; severity: string }[];
  } | null>(null);

  useEffect(() => {
    api(`/admin/facilities/${id}`).then(setData).catch(console.error);
  }, [id]);

  if (!data) return <p className="p-6 text-slate-500">Loading facility…</p>;

  const { facility, health } = data;
  const statusColor =
    health.status === "critical" ? "text-red-600" : health.status === "warning" ? "text-amber-600" : "text-emerald-600";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin" className="text-sm text-medflow-600 hover:underline">
          ← Command center
        </Link>
        <h1 className="text-2xl font-bold mt-1">{facility.name}</h1>
        <p className="text-sm text-muted-foreground">
          {facility.code} · {facility.province} · {facility.district}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Health status</p>
            <p className={`text-xl font-bold capitalize ${statusColor}`}>{health.status}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Patients</p>
            <p className="text-xl font-bold">{data.patients}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Staff</p>
            <p className="text-xl font-bold">{data.workers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-500">Pending transfers</p>
            <p className="text-xl font-bold">{data.pendingTransfers}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock health</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <p>Stockouts: <strong className="text-red-600">{health.stockoutCount}</strong></p>
            <p>Low stock: <strong className="text-amber-600">{health.lowCount}</strong></p>
            <p>Expiring batches: {health.expiringBatches}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Open alerts</CardTitle>
          </CardHeader>
          <CardContent>
            {data.alerts.length === 0 ? (
              <p className="text-sm text-slate-500">No open alerts</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.alerts.map((a) => (
                  <li key={a.id} className="rounded-lg border border-slate-100 p-2">
                    <span className="text-xs font-bold uppercase text-slate-400">{a.severity}</span>
                    <p>{a.title}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
