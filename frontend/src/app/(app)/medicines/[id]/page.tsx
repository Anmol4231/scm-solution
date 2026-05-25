"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MedicineDetail {
  medicine: {
    id: string;
    medicineName: string;
    genericName?: string;
    dosageForm?: string;
    strength?: string;
    unitType: string;
    reorderThreshold: number;
    storageCondition?: string;
    temperatureSensitive?: boolean;
    priorityLevel?: string;
    emergencyStockFlag?: boolean;
    category?: { name: string };
  };
  balance: number | null;
  batches: {
    id: string;
    batchNumber: string;
    quantity: number;
    expiryDate: string;
    daysUntilExpiry: number;
    severity: string;
    facility: { name: string };
    inbound30d: number;
    outbound30d: number;
    inboundTotal: number;
    outboundTotal: number;
  }[];
  stockAnalytics: { inbound: { daily: number; weekly: number; monthly: number }; outbound: { daily: number; weekly: number; monthly: number } };
  expiryInsights: { expired: unknown[]; expiringSoon: unknown[]; warning: unknown[]; healthy: unknown[] };
  transactions: { id: string; type: string; quantity: number; createdAt: string; facility?: { name: string }; performedBy?: { firstName: string; lastName: string } }[];
  dispensingRecords: { id: string; quantity: number; dispensedAt: string; recipientType: string; patient?: { firstName: string; lastName: string }; healthcareWorker?: { firstName: string; lastName: string } }[];
  facilityUsage: { facility?: { name: string }; totalOutbound: number }[];
  outboundActivities: {
    id: string;
    activityType: string;
    quantity: number;
    batchNumber: string | null;
    facility: string;
    performedBy: string | null;
    notes: string | null;
    reason: string | null;
    createdAt: string;
  }[];
}

export default function MedicineDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<MedicineDetail | null>(null);

  useEffect(() => {
    const q = user?.facilityId ? `?facilityId=${user.facilityId}` : "";
    api<MedicineDetail>(`/medicines/${id}/detail${q}`).then(setData).catch(console.error);
  }, [id, user?.facilityId]);

  if (!data) return <p className="text-muted-foreground">Loading medicine intelligence...</p>;

  const m = data.medicine;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/medicines" className="text-sm text-medflow-600 hover:underline">← Medicine Master</Link>
        <h1 className="mt-2 text-2xl font-bold">{m.medicineName}</h1>
        <p className="text-muted-foreground">{m.genericName} · {m.category?.name}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Current stock" value={data.balance ?? "—"} />
        <Stat label="Inbound (30d)" value={data.stockAnalytics.inbound.monthly} />
        <Stat label="Outbound (30d)" value={data.stockAnalytics.outbound.monthly} />
        <Stat label="Reorder at" value={m.reorderThreshold} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Medicine Information</CardTitle></CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <Row label="Dosage form" value={m.dosageForm} />
            <Row label="Strength" value={m.strength} />
            <Row label="Unit" value={m.unitType} />
            <Row label="Storage" value={m.storageCondition || "Room temperature"} />
            <Row label="Priority" value={m.priorityLevel} />
            {m.emergencyStockFlag && <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Emergency stock</span>}
            {m.temperatureSensitive && <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">Temperature sensitive</span>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Expiry Insights</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-sm">
            <Insight label="Expired" count={data.expiryInsights.expired.length} color="text-slate-600" />
            <Insight label="Critical" count={data.expiryInsights.expiringSoon.length} color="text-red-600" />
            <Insight label="Warning" count={data.expiryInsights.warning.length} color="text-amber-600" />
            <Insight label="Healthy" count={data.expiryInsights.healthy.length} color="text-green-600" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Stock Movement Analytics</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-center text-sm md:grid-cols-6">
            {(["daily", "weekly", "monthly"] as const).map((p) => (
              <div key={`in-${p}`} className="rounded-lg bg-green-50 p-3">
                <p className="text-xs text-muted-foreground">Inbound {p}</p>
                <p className="text-lg font-bold text-green-700">{data.stockAnalytics.inbound[p]}</p>
              </div>
            ))}
            {(["daily", "weekly", "monthly"] as const).map((p) => (
              <div key={`out-${p}`} className="rounded-lg bg-amber-50 p-3">
                <p className="text-xs text-muted-foreground">Outbound {p}</p>
                <p className="text-lg font-bold text-amber-700">{data.stockAnalytics.outbound[p]}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Batches &amp; Supply ({data.batches.length})</CardTitle>
          <p className="text-xs text-muted-foreground">Inbound = receipts, returns, transfers in · Outbound = dispensing, usage, expiry, transfers out</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-2">Batch</th>
                <th className="p-2">Facility</th>
                <th className="p-2">On hand</th>
                <th className="p-2 text-green-700">Inbound (30d)</th>
                <th className="p-2 text-amber-700">Outbound (30d)</th>
                <th className="p-2 text-muted-foreground">In / Out (all)</th>
                <th className="p-2">Expiry</th>
                <th className="p-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.batches.map((b) => (
                <tr key={b.id} className="border-b hover:bg-slate-50/50">
                  <td className="p-2 font-mono text-xs">{b.batchNumber}</td>
                  <td className="p-2">{b.facility.name}</td>
                  <td className="p-2 font-medium">{b.quantity}</td>
                  <td className="p-2 text-green-700">{b.inbound30d}</td>
                  <td className="p-2 text-amber-700">{b.outbound30d}</td>
                  <td className="p-2 text-xs text-muted-foreground">{b.inboundTotal} / {b.outboundTotal}</td>
                  <td className="p-2">{new Date(b.expiryDate).toLocaleDateString()}</td>
                  <td className="p-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${severityClass(b.severity)}`}>{b.severity}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outbound Activities</CardTitle>
          <p className="text-xs text-muted-foreground">Dispensing, transfers out, expiry, consumption, and returns</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {data.outboundActivities?.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-amber-50/50 text-left">
                  <th className="p-2">Activity</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2">Batch</th>
                  <th className="p-2">Facility</th>
                  <th className="p-2">By</th>
                  <th className="p-2">When</th>
                </tr>
              </thead>
              <tbody>
                {data.outboundActivities.map((a) => (
                  <tr key={a.id} className="border-b hover:bg-slate-50/50">
                    <td className="p-2">
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                        {formatActivityType(a.activityType)}
                      </span>
                    </td>
                    <td className="p-2 font-medium text-amber-700">{a.quantity}</td>
                    <td className="p-2 font-mono text-xs">{a.batchNumber ?? "—"}</td>
                    <td className="p-2">{a.facility}</td>
                    <td className="p-2">{a.performedBy ?? "—"}</td>
                    <td className="p-2">{new Date(a.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted-foreground">No outbound activities recorded yet.</p>
          )}
        </CardContent>
      </Card>

      {data.facilityUsage.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Facility Usage (90 days)</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.facilityUsage.map((f, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span>{f.facility?.name}</span>
                <span className="font-medium">{f.totalOutbound} units outbound</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Transaction History</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="p-2">Type</th>
                <th className="p-2">Qty</th>
                <th className="p-2">Facility</th>
                <th className="p-2">By</th>
                <th className="p-2">When</th>
              </tr>
            </thead>
            <tbody>
              {data.transactions.slice(0, 15).map((tx) => (
                <tr key={tx.id} className="border-b">
                  <td className="p-2">{tx.type}</td>
                  <td className="p-2">{tx.quantity}</td>
                  <td className="p-2">{tx.facility?.name}</td>
                  <td className="p-2">{tx.performedBy ? `${tx.performedBy.firstName} ${tx.performedBy.lastName}` : "—"}</td>
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

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-4 text-center">
        <p className="text-2xl font-bold text-medflow-700">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );
}

function Insight({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className={`text-xl font-bold ${color}`}>{count}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function formatActivityType(type: string) {
  return type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function severityClass(s: string) {
  if (s === "expired") return "bg-slate-200 text-slate-700";
  if (s === "critical") return "bg-red-100 text-red-700";
  if (s === "warning") return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}
