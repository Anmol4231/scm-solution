"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Category {
  id: string;
  name: string;
}

interface ExpiryBatch {
  id: string;
  batchNumber: string;
  medicineId: string;
  daysUntilExpiry: number;
  severity: string;
  quantity: number;
  expiryDate: string;
  medicine: {
    medicineName: string;
    category?: { id: string; name: string } | null;
  };
  facility?: { name: string };
}

interface ExpiryResponse {
  total: number;
  filters: { withinDays: string; categoryId: string | null; facilityFilter: string | null; status: string };
  batches: ExpiryBatch[];
  categoryAnalytics?: { category: string; count: number; quantity: number; critical: number }[];
  facilityAnalytics?: { name: string; count: number; quantity: number }[];
  recommendations?: { medicineId: string; medicineName: string; batchNumber: string; facility: string; daysUntilExpiry: number; quantity: number; recommendation: string }[];
}

const WITHIN_OPTIONS = [
  { value: "30", label: "Expiring within 30 days" },
  { value: "60", label: "Expiring within 60 days" },
  { value: "90", label: "Expiring within 90 days" },
  { value: "all", label: "All monitored batches" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "expired", label: "Expired only" },
  { value: "critical", label: "Critical (≤30 days)" },
  { value: "warning", label: "Warning (31–90 days)" },
];

export default function ExpiryPage() {
  const { user } = useAuth();
  const [data, setData] = useState<ExpiryResponse | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string }[]>([]);
  const [withinDays, setWithinDays] = useState("90");
  const [categoryId, setCategoryId] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [status, setStatus] = useState("all");
  const [showExpired, setShowExpired] = useState(false);
  const [form, setForm] = useState({
    medicineId: "",
    batchNumber: "",
    expiryDate: "",
    quantity: 0,
    disposalMethod: "",
  });
  const [medicines, setMedicines] = useState<{ id: string; medicineName: string }[]>([]);

  const loadAlerts = useCallback(() => {
    const params = new URLSearchParams();
    params.set("withinDays", withinDays);
    params.set("status", status);
    if (categoryId) params.set("categoryId", categoryId);
    if (facilityFilter) params.set("facilityFilter", facilityFilter);
    api<ExpiryResponse>(`/expiry/alerts?${params}`).then(setData).catch(console.error);
  }, [withinDays, categoryId, facilityFilter, status]);

  useEffect(() => {
    api<Category[]>("/categories").then(setCategories);
    api<{ id: string; medicineName: string }[]>("/medicines").then(setMedicines);
    if (user?.role === "PROVINCIAL_MANAGER" || user?.role === "SUPER_ADMIN") {
      api<{ id: string; name: string }[]>("/auth/facilities").then(setFacilities);
    }
  }, [user?.role]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const recordExpired = async (e: React.FormEvent) => {
    e.preventDefault();
    await api("/expiry/record-expired", { method: "POST", body: JSON.stringify(form) });
    setShowExpired(false);
    loadAlerts();
  };

  const batches = data?.batches ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap justify-between gap-3">
        <h1 className="text-2xl font-bold">Expiry Management</h1>
        <Button onClick={() => setShowExpired(!showExpired)}>Record Expired</Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 pt-4">
          <div className="min-w-[160px] flex-1">
            <Label className="text-xs">Expire within</Label>
            <select
              className="mt-1 h-11 w-full rounded-lg border px-3"
              value={withinDays}
              onChange={(e) => setWithinDays(e.target.value)}
            >
              {WITHIN_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px] flex-1">
            <Label className="text-xs">Category</Label>
            <select
              className="mt-1 h-11 w-full rounded-lg border px-3"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px] flex-1">
            <Label className="text-xs">Status</Label>
            <select
              className="mt-1 h-11 w-full rounded-lg border px-3"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          {(user?.role === "PROVINCIAL_MANAGER" || user?.role === "SUPER_ADMIN") && facilities.length > 0 && (
            <div className="min-w-[160px] flex-1">
              <Label className="text-xs">Facility</Label>
              <select className="mt-1 h-11 w-full rounded-lg border px-3" value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)}>
                <option value="">All facilities</option>
                {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        {data?.total ?? 0} batch(es) match · ≤30 days = critical · 31–90 days = warning · expired = grey
      </p>

      {data?.recommendations && data.recommendations.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader><CardTitle className="text-base">Redistribution Recommendations</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.recommendations.map((r, i) => (
              <p key={i} className="text-sm">
                <Link href={`/medicines/${r.medicineId}`} className="font-medium text-medflow-600 hover:underline">{r.medicineName}</Link>
                {" "}({r.batchNumber}, {r.facility}) — {r.recommendation}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      {(data?.categoryAnalytics?.length || data?.facilityAnalytics?.length) ? (
        <div className="grid gap-4 md:grid-cols-2">
          {data.categoryAnalytics && data.categoryAnalytics.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Category-wise Expiry</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.categoryAnalytics.map((c) => (
                  <div key={c.category} className="flex justify-between border-b pb-1">
                    <span>{c.category}</span>
                    <span>{c.count} batches · {c.critical} critical</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
          {data.facilityAnalytics && data.facilityAnalytics.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Facility-wise Expiry</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data.facilityAnalytics.map((f) => (
                  <div key={f.name} className="flex justify-between border-b pb-1">
                    <span>{f.name}</span>
                    <span>{f.count} batches · qty {f.quantity}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      ) : null}

      {showExpired && (
        <Card>
          <CardContent className="pt-6">
            <form onSubmit={recordExpired} className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Medicine</Label>
                <select
                  className="h-11 w-full rounded-lg border px-3"
                  value={form.medicineId}
                  onChange={(e) => setForm({ ...form, medicineId: e.target.value })}
                  required
                >
                  <option value="">Select</option>
                  {medicines.map((m) => (
                    <option key={m.id} value={m.id}>{m.medicineName}</option>
                  ))}
                </select>
              </div>
              <div><Label>Batch</Label><Input value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} required /></div>
              <div><Label>Expiry date</Label><Input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} required /></div>
              <div><Label>Quantity</Label><Input type="number" value={form.quantity || ""} onChange={(e) => setForm({ ...form, quantity: +e.target.value })} required /></div>
              <div className="md:col-span-2"><Label>Disposal method</Label><Input value={form.disposalMethod} onChange={(e) => setForm({ ...form, disposalMethod: e.target.value })} required /></div>
              <Button type="submit" className="md:col-span-2">Submit</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {batches.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            No batches match these filters.
          </CardContent>
        </Card>
      )}

      {batches.map((batch) => (
        <Card
          key={batch.id}
          className={
            batch.severity === "expired"
              ? "border-slate-400 bg-slate-50"
              : batch.severity === "critical"
                ? "border-red-300 bg-red-50/50"
                : batch.severity === "warning"
                  ? "border-amber-300 bg-amber-50/50"
                  : ""
          }
        >
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Link href={`/medicines/${batch.medicineId}`} className="font-semibold text-medflow-700 hover:underline">
                  {batch.medicine?.medicineName}
                </Link>
                {batch.medicine?.category && (
                  <span className="text-xs text-medflow-600">{batch.medicine.category.name}</span>
                )}
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${
                  batch.severity === "expired"
                    ? "bg-slate-200 text-slate-700"
                    : batch.severity === "critical"
                      ? "bg-red-100 text-red-700"
                      : batch.severity === "warning"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-green-100 text-green-700"
                }`}
              >
                {batch.severity}
              </span>
            </div>
            <p className="mt-1 text-sm">
              Batch {batch.batchNumber} · {batch.daysUntilExpiry < 0 ? "Expired" : `${batch.daysUntilExpiry} days left`} · Qty {batch.quantity}
            </p>
            <p className="text-xs text-muted-foreground">
              Expires {new Date(batch.expiryDate).toLocaleDateString()}
              {batch.facility?.name && ` · ${batch.facility.name}`}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
