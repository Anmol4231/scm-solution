"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isAdminDashboardRole, adminRoleLabel } from "@/lib/roles";
import { LocationFilter } from "@/components/admin/location-filter";
import { AdminSummaryCards, type AdminSummary } from "@/components/admin/summary-cards";
import { FacilityComparison, ExpiryHeatmapTable, type FacilityStat } from "@/components/admin/facility-comparison";
import { AdminTrendCharts } from "@/components/admin/trend-charts";
import { AlertCenter } from "@/components/admin/alert-center";
import { FacilityMapView } from "@/components/admin/facility-map";
import { TransferRecommendationsPanel } from "@/components/admin/transfer-recommendations";
import {
  PendingSyncWidget,
  GlobalActivityFeed,
} from "@/components/admin/admin-widgets";
import { FacilitySwitcher } from "@/components/layout/facility-switcher";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-medflow-600">
            Healthcare Command Center
          </p>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-sm text-slate-500">
            {adminRoleLabel(user.role)} — monitor all facilities from one place
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/transfers">
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Redistribution
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="#alert-center">Alert Center</a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
        <LocationFilter value={locationId} onChange={setLocationId} />
        <FacilitySwitcher />
      </div>

      {loading && !data && (
        <p className="text-center text-sm text-slate-500 py-12">Loading command dashboard…</p>
      )}

      {data && (
        <>
          <AdminSummaryCards summary={data.summary} />
          <div className="grid gap-4 md:grid-cols-2">
            <PendingSyncWidget nonReportingCount={data.nonReportingFacilities?.length ?? 0} />
            <GlobalActivityFeed activity={data.recentActivity ?? []} />
          </div>
          <FacilityMapView />
          <TransferRecommendationsPanel facilityFilter={locationId} />
          <FacilityComparison stats={data.facilityStats} />
          {data.trends && <AdminTrendCharts trends={data.trends} />}
          <ExpiryHeatmapTable rows={data.expiryHeatmap} />
          <AlertCenter facilityFilter={locationId} />
        </>
      )}
    </div>
  );
}
