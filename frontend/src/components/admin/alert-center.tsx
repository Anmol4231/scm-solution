"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, CheckCircle2 } from "lucide-react";
interface AdminAlert {
  id: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  createdAt: string;
  facility?: { id: string; name: string; code: string } | null;
}

interface AlertsResponse {
  alerts: AdminAlert[];
  severityCounts: { severity: string; _count: number }[];
}

export function AlertCenter({ facilityFilter }: { facilityFilter: string }) {
  const [severity, setSeverity] = useState("");
  const [data, setData] = useState<AlertsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (facilityFilter) params.set("facilityId", facilityFilter);
    if (severity) params.set("severity", severity);
    params.set("unresolved", "true");
    api<AlertsResponse>(`/admin/alerts?${params}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [facilityFilter, severity]);

  useEffect(() => {
    load();
  }, [load]);

  async function resolveAlert(id: string) {
    await api(`/admin/alerts/${id}/resolve`, { method: "PATCH" });
    load();
  }

  const alerts = data?.alerts ?? [];

  return (
    <Card className="border-slate-200 shadow-sm" id="alert-center">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-medflow-600" />
          <CardTitle className="text-base">Alert Center</CardTitle>
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
          >
            <option value="">All severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="WARNING">Warning</option>
            <option value="INFO">Info</option>
          </select>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {data?.severityCounts && (
          <div className="mb-4 flex flex-wrap gap-2 text-xs">
            {data.severityCounts.map((c) => (
              <span key={c.severity} className="rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
                {c.severity}: {c._count}
              </span>
            ))}
          </div>
        )}
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {alerts.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-500">No unresolved alerts</p>
          )}
          {alerts.map((a) => (
            <div
              key={a.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3 transition hover:bg-white"
            >
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      a.severity === "CRITICAL"
                        ? "bg-red-100 text-red-700"
                        : a.severity === "WARNING"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {a.severity}
                  </span>
                  <span className="text-xs text-slate-500">{a.type.replace(/_/g, " ")}</span>
                  {a.facility && (
                    <span className="text-xs text-medflow-600">{a.facility.name}</span>
                  )}
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">{a.title}</p>
                <p className="text-xs text-slate-600">{a.message}</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 text-emerald-700 hover:text-emerald-800"
                onClick={() => resolveAlert(a.id)}
                title="Mark resolved"
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
