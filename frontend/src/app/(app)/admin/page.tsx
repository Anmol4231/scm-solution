"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { dateInputMin, dateInputMax } from "@/lib/datetime";
import { DateInput } from "@/components/ui/date-input";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole } from "@/lib/roles";
import { LocationFilter } from "@/components/admin/location-filter";
import { AdminSummaryCards, type AdminSummary } from "@/components/admin/summary-cards";
import { FacilityComparison, ExpiryHeatmapTable, type FacilityStat } from "@/components/admin/facility-comparison";
import { AdminTrendCharts } from "@/components/admin/trend-charts";
import { TransferRecommendationsPanel } from "@/components/admin/transfer-recommendations";
import {
  PendingSyncWidget,
  GlobalActivityFeed,
} from "@/components/admin/admin-widgets";
import { Input } from "@/components/ui/input";

type DurationRange = "today" | "7" | "30" | "90" | "custom";

const DURATIONS: { key: DurationRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7", label: "Last 7 Days" },
  { key: "30", label: "Last 30 Days" },
  { key: "90", label: "Last 90 Days" },
  { key: "custom", label: "Custom Range" },
];

function durationToDates(range: DurationRange, from: string, to: string): { from?: number; to?: number } {
  if (range === "custom") {
    return {
      from: from ? new Date(from).getTime() : undefined,
      to: to ? new Date(`${to}T23:59:59`).getTime() : undefined,
    };
  }
  if (range === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return { from: d.getTime() };
  }
  return { from: Date.now() - Number(range) * 86400000 };
}

interface AdminDashboardData {
  summary: AdminSummary;
  facilityStats: FacilityStat[];
  expiryHeatmap: {
    facility: string;
    medicine: string;
    batch: string;
    days: number;
    quantity: number;
    medicineId?: string;
  }[];
  nonReportingFacilities?: unknown[];
  recentActivity?: {
    type: string;
    medicine: { medicineName: string };
    quantity: number;
    createdAt: string;
    facility?: { name: string };
  }[];
  trends: {
    stockMovement: {
      daily: { date: string; inbound: number; outbound: number }[];
      weekly: { date: string; inbound: number; outbound: number }[];
      monthly: { date: string; inbound: number; outbound: number }[];
    };
    dispensing: { date: string; quantity: number }[];
    transfers: { date: string; created: number; completed: number }[];
    expiry: { period: string; quantity: number }[];
  };
}

export default function AdminDashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [locationId, setLocationId] = useState("");
  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // Duration filter — persists while the user stays on the page.
  const [duration, setDuration] = useState<DurationRange>("30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  useEffect(() => {
    if (user && !isAdminDashboardRole(user.role)) {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    if (!user || !isAdminDashboardRole(user.role)) return;
    setLoading(true);
    const q = locationId ? `?facilityId=${locationId}` : "";
    api<AdminDashboardData>(`/dashboard/admin${q}`)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user, locationId]);

  if (!user || !isAdminDashboardRole(user.role)) {
    return null;
  }

  // Duration applies client-side to time-stamped widgets (Recent Activity).
  const { from, to } = durationToDates(duration, customFrom, customTo);
  const recentActivity = (data?.recentActivity ?? []).filter((a) => {
    const t = new Date(a.createdAt).getTime();
    if (from && t < from) return false;
    if (to && t > to) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1.5">
            {DURATIONS.map((d) => (
              <button
                key={d.key}
                type="button"
                onClick={() => setDuration(d.key)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
                  duration === d.key
                    ? "border-medflow-300 bg-medflow-50 text-medflow-700"
                    : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
          {duration === "custom" && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <label className="flex items-center gap-1">
                From
                <DateInput aria-label="From date" className="h-9 w-auto" min={dateInputMin()} max={customTo || dateInputMax()} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
              </label>
              <label className="flex items-center gap-1">
                To
                <DateInput aria-label="To date" className="h-9 w-auto" min={customFrom || dateInputMin()} max={dateInputMax()} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
              </label>
            </div>
          )}
        </div>
        <Button asChild variant="outline">
          <Link href="/alerts">
            <Bell className="mr-2 h-4 w-4 text-amber-500" />
            <span className="text-sm font-semibold">Alert Center</span>
            {data?.summary && (data.summary.lowStockItems + data.summary.nearExpiryItems) > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-sm font-semibold text-amber-700">
                {data.summary.lowStockItems + data.summary.nearExpiryItems}
              </span>
            )}
          </Link>
        </Button>
      </div>

      {/* Single Location selector */}
      <div className="max-w-md">
        <LocationFilter value={locationId} onChange={setLocationId} />
      </div>

      {loading && !data && (
        <p className="text-center text-sm text-slate-500 py-12">Loading command dashboard…</p>
      )}

      {data && (
        <>
          <AdminSummaryCards summary={data.summary} />
          <FacilityComparison stats={data.facilityStats} />
          <div className="grid gap-4 md:grid-cols-2">
            <GlobalActivityFeed activity={recentActivity} />
            <PendingSyncWidget nonReportingCount={data.nonReportingFacilities?.length ?? 0} />
          </div>
          <TransferRecommendationsPanel facilityFilter={locationId} />
          {data.trends && <AdminTrendCharts trends={data.trends} />}
          <ExpiryHeatmapTable rows={data.expiryHeatmap} />
        </>
      )}
    </div>
  );
}
