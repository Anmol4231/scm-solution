"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, AlertCircle } from "lucide-react";

export function PendingSyncWidget({ nonReportingCount }: { nonReportingCount: number }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <AlertCircle className="h-5 w-5 text-amber-500" />
        <CardTitle className="text-base">Pending sync</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-bold text-slate-900">{nonReportingCount}</p>
        <p className="mt-1 text-xs text-slate-500">Facilities with overdue consumption reporting</p>
      </CardContent>
    </Card>
  );
}

export function GlobalActivityFeed({
  activity,
}: {
  activity: { type: string; medicine?: { medicineName: string }; quantity: number; createdAt: string; facility?: { name: string } }[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <Activity className="h-5 w-5 text-medflow-600" />
        <CardTitle className="text-base">Global activity</CardTitle>
      </CardHeader>
      <CardContent className="max-h-64 space-y-2 overflow-y-auto">
        {activity.length === 0 && (
          <p className="text-sm text-slate-500">No recent activity</p>
        )}
        {activity.map((a, i) => (
          <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm">
            <p className="font-medium text-slate-800">
              {a.type.replace(/_/g, " ")} — {a.medicine?.medicineName ?? "—"}
            </p>
            <p className="text-xs text-slate-500">
              Qty {a.quantity} · {new Date(a.createdAt).toLocaleString()}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
