"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from "recharts";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Pill,
  Users,
  AlertTriangle,
  Package,
  ArrowLeftRight,
  RotateCcw,
  Stethoscope,
  Building2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface FacilityDashboard {
  dispensingToday: number;
  patientsServedToday: number;
  lowStock: { medicine: { id: string; medicineName: string }; balance: number }[];
  expiring: { medicine: { id: string; medicineName: string }; batchNumber: string; days: number }[];
  alerts: { id: string; title: string; severity: string }[];
  recentActivity: { type: string; medicine: { medicineName: string }; quantity: number; createdAt: string }[];
  categoryBreakdown?: { category: string; totalStock: number }[];
  topConsumedMedicines?: { medicine: { id: string; medicineName: string }; quantity: number }[];
  nearStockoutPrediction?: { medicine: { id: string; medicineName: string }; balance: number; daysToStockout: number }[];
  stockMovementTrend?: { date: string; inbound: number; outbound: number }[];
  widgets?: {
    totalMedicines: number;
    totalPatients: number;
    totalHealthcareWorkers: number;
    totalFacilities: number;
    dispensingToday: number;
    lowStockCount: number;
    nearExpiryCount: number;
    pendingTransfers: number;
    pendingReturns: number;
  };
}

function formatCategoryChart(categories: { category: string; totalStock: number }[]) {
  const sorted = [...categories].sort((a, b) => b.totalStock - a.totalStock);
  const top = sorted.slice(0, 7);
  const rest = sorted.slice(7);
  if (rest.length > 0) {
    top.push({ category: "Other", totalStock: rest.reduce((sum, c) => sum + c.totalStock, 0) });
  }
  return top.map((c) => ({
    ...c,
    shortLabel: c.category.length > 18 ? `${c.category.slice(0, 18)}…` : c.category,
  }));
}

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<FacilityDashboard | null>(null);

  // Admins use the Admin Dashboard exclusively — this page is for facility users only.
  useEffect(() => {
    if (user && isCrossFacilityRole(user.role)) router.replace("/admin");
  }, [user, router]);

  useEffect(() => {
    if (!user || isCrossFacilityRole(user.role) || !user.facilityId) return;
    api<FacilityDashboard>(`/dashboard/facility?facilityId=${user.facilityId}`).then(setData).catch(console.error);
  }, [user]);

  if (!user || isCrossFacilityRole(user.role)) return null;

  const w = data?.widgets;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatCard icon={Pill} label="Medicines" value={w?.totalMedicines ?? 0} />
        <StatCard icon={Users} label="Patients" value={w?.totalPatients ?? 0} />
        <StatCard icon={Stethoscope} label="Staff" value={w?.totalHealthcareWorkers ?? 0} />
        <StatCard icon={Building2} label="Facilities" value={w?.totalFacilities ?? 1} />
        <StatCard icon={Pill} label="Dispensed today" value={w?.dispensingToday ?? data?.dispensingToday ?? 0} />
        <StatCard icon={AlertTriangle} label="Low stock" value={w?.lowStockCount ?? data?.lowStock?.length ?? 0} color="text-amber-600" />
        <StatCard icon={Package} label="Near expiry" value={w?.nearExpiryCount ?? data?.expiring?.length ?? 0} color="text-red-600" />
        <StatCard icon={ArrowLeftRight} label="Pending transfers" value={w?.pendingTransfers ?? 0} />
        <StatCard icon={RotateCcw} label="Pending returns" value={w?.pendingReturns ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {data?.categoryBreakdown && data.categoryBreakdown.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Stock by Category</CardTitle>
            </CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={formatCategoryChart(data.categoryBreakdown)} margin={{ top: 4, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="shortLabel" width={108} tick={{ fontSize: 11 }} interval={0} />
                  <Tooltip />
                  <Bar dataKey="totalStock" fill="#0284c7" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}

        {data?.stockMovementTrend && data.stockMovementTrend.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Stock Movement Trend (30 days)</CardTitle></CardHeader>
            <CardContent className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.stockMovementTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="inbound" stroke="#16a34a" name="Inbound" />
                  <Line type="monotone" dataKey="outbound" stroke="#dc2626" name="Outbound" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )}
      </div>

      {data?.topConsumedMedicines && data.topConsumedMedicines.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Top Consumed Medicines (30 days)</CardTitle></CardHeader>
          <CardContent className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.topConsumedMedicines.map((t) => ({ name: t.medicine.medicineName.split(" ")[0], qty: t.quantity }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="qty" fill="#0284c7" name="Dispensed" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Link href="/dispense"><Button size="lg" className="h-16 w-full">Patient Dispense</Button></Link>
          <Link href="/patients"><Button size="lg" variant="secondary" className="h-16 w-full">Patients</Button></Link>
          <Link href="/medicines"><Button size="lg" variant="outline" className="h-16 w-full">Medicines</Button></Link>
          <Link href="/alerts"><Button size="lg" variant="outline" className="h-16 w-full">Alert Center</Button></Link>
        </CardContent>
      </Card>

      {data?.nearStockoutPrediction && data.nearStockoutPrediction.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Near Stockout Prediction</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.nearStockoutPrediction.map((s, i) => (
              <div key={i} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                <Link href={`/medicines/${s.medicine.id}`} className="font-medium text-medflow-600 hover:underline">{s.medicine.medicineName}</Link>
                <span className="text-amber-600">~{s.daysToStockout} days · {s.balance} left</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Recent Activity</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Type</th>
                <th className="p-2">Medicine</th>
                <th className="p-2">Qty</th>
                <th className="p-2">When</th>
              </tr>
            </thead>
            <tbody>
              {data?.recentActivity?.map((tx, i) => (
                <tr key={i} className="border-b">
                  <td className="p-2">{tx.type}</td>
                  <td className="p-2">{tx.medicine?.medicineName}</td>
                  <td className="p-2">{tx.quantity}</td>
                  <td className="p-2">{new Date(tx.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: LucideIcon; label: string; value: number; color?: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <Icon className={`h-8 w-8 ${color || "text-medflow-600"}`} />
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
