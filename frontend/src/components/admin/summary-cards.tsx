"use client";

import {
  Building2,
  Pill,
  Users,
  UserCog,
  Package,
  AlertTriangle,
  Clock,
  ArrowLeftRight,
  RotateCcw,
  Syringe,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export interface AdminSummary {
  totalFacilities: number;
  totalMedicines: number;
  totalPatients: number;
  totalHealthcareWorkers: number;
  totalStockAvailable: number;
  lowStockItems: number;
  nearExpiryItems: number;
  pendingTransfers: number;
  pendingReturns: number;
  dispensingToday: number;
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent: string;
}) {
  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm transition hover:shadow-md">
      <CardContent className="flex items-start gap-3 p-4">
        <div className={`rounded-lg p-2 ${accent}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function AdminSummaryCards({ summary }: { summary: AdminSummary }) {
  const cards = [
    { label: "Facilities", value: summary.totalFacilities, icon: Building2, accent: "bg-blue-50 text-blue-700" },
    { label: "Medicines", value: summary.totalMedicines, icon: Pill, accent: "bg-sky-50 text-sky-700" },
    { label: "Patients", value: summary.totalPatients, icon: Users, accent: "bg-indigo-50 text-indigo-700" },
    { label: "Healthcare Workers", value: summary.totalHealthcareWorkers, icon: UserCog, accent: "bg-violet-50 text-violet-700" },
    { label: "Stock Available", value: Math.round(summary.totalStockAvailable), icon: Package, accent: "bg-emerald-50 text-emerald-700" },
    { label: "Low Stock Alerts", value: summary.lowStockItems, icon: AlertTriangle, accent: "bg-amber-50 text-amber-700" },
    { label: "Near Expiry", value: summary.nearExpiryItems, icon: Clock, accent: "bg-orange-50 text-orange-700" },
    { label: "Pending Transfers", value: summary.pendingTransfers, icon: ArrowLeftRight, accent: "bg-cyan-50 text-cyan-700" },
    { label: "Pending Returns", value: summary.pendingReturns, icon: RotateCcw, accent: "bg-slate-100 text-slate-700" },
    { label: "Dispensed Today", value: summary.dispensingToday, icon: Syringe, accent: "bg-medflow-50 text-medflow-700" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {cards.map((c) => (
        <StatCard key={c.label} {...c} />
      ))}
    </div>
  );
}
