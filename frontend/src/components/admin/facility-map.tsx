"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MapFacility {
  id: string;
  name: string;
  code: string;
  facilityType?: string | null;
  latitude: number | null;
  longitude: number | null;
  healthStatus: "healthy" | "warning" | "critical";
  stockoutCount: number;
  lowCount: number;
  expiringBatches: number;
}

const STATUS_COLOR = {
  healthy: { fill: "#22c55e", ring: "ring-green-200", label: "Healthy" },
  warning: { fill: "#eab308", ring: "ring-amber-200", label: "Warning" },
  critical: { fill: "#ef4444", ring: "ring-red-200", label: "Critical" },
};

const TYPE_LABELS: Record<string, string> = {
  HOSPITAL: "Hospital",
  CLINIC: "Clinic",
  PHARMACY: "Pharmacy",
  WAREHOUSE: "Warehouse",
  REGIONAL_STORE: "Regional Store",
  AMS_CENTRAL: "AMS",
};

function toMapPosition(lat: number, lng: number) {
  const minLat = -9.55;
  const maxLat = -5.45;
  const minLng = 143.65;
  const maxLng = 147.25;
  const x = ((lng - minLng) / (maxLng - minLng)) * 100;
  const y = ((maxLat - lat) / (maxLat - minLat)) * 100;
  return { x: Math.min(96, Math.max(4, x)), y: Math.min(92, Math.max(8, y)) };
}

export function FacilityMapView() {
  const [facilities, setFacilities] = useState<MapFacility[]>([]);
  const [selected, setSelected] = useState<MapFacility | null>(null);

  useEffect(() => {
    api<{ facilities: MapFacility[] }>("/admin/map").then((d) => setFacilities(d.facilities)).catch(console.error);
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-800">Global Facility Map</CardTitle>
        <p className="text-xs text-slate-500">Click a facility for details</p>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-3 text-xs">
          {(["healthy", "warning", "critical"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[s].fill }} />
              {STATUS_COLOR[s].label}
            </span>
          ))}
        </div>
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-slate-200 bg-gradient-to-br from-sky-50 via-white to-slate-100">
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <rect x="0" y="0" width="100" height="100" fill="url(#mapBg)" rx="2" />
            <defs>
              <linearGradient id="mapBg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e0f2fe" />
                <stop offset="100%" stopColor="#f8fafc" />
              </linearGradient>
            </defs>
            {facilities.map((f) => {
              if (f.latitude == null || f.longitude == null) return null;
              const { x, y } = toMapPosition(f.latitude, f.longitude);
              const c = STATUS_COLOR[f.healthStatus];
              return (
                <g key={f.id}>
                  <circle
                    cx={x}
                    cy={y}
                    r="3.5"
                    fill={c.fill}
                    stroke="white"
                    strokeWidth="1.2"
                    className="cursor-pointer transition hover:opacity-80"
                    onClick={() => setSelected(f)}
                  />
                </g>
              );
            })}
          </svg>
          {facilities
            .filter((f) => f.latitude != null && f.longitude != null)
            .map((f) => {
              const { x, y } = toMapPosition(f.latitude!, f.longitude!);
              return (
                <button
                  key={`lbl-${f.id}`}
                  type="button"
                  className="absolute -translate-x-1/2 text-[9px] font-medium text-slate-600 hover:text-medflow-700"
                  style={{ left: `${x}%`, top: `${y + 4}%` }}
                  onClick={() => setSelected(f)}
                >
                  {f.code}
                </button>
              );
            })}
        </div>
        {selected && (
          <div className={`mt-4 rounded-lg border p-4 ring-2 ${STATUS_COLOR[selected.healthStatus].ring}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{selected.name}</p>
                <p className="text-xs text-slate-500">
                  {selected.code} · {TYPE_LABELS[selected.facilityType ?? ""] ?? selected.facilityType}
                </p>
                <p className="mt-1 text-xs capitalize text-slate-600">
                  Status: <strong>{STATUS_COLOR[selected.healthStatus].label}</strong>
                </p>
                <p className="text-xs text-slate-500">
                  Stockouts: {selected.stockoutCount} · Low: {selected.lowCount} · Expiring: {selected.expiringBatches}
                </p>
              </div>
              <Link
                href={`/admin/facilities/${selected.id}`}
                className="shrink-0 rounded-lg bg-medflow-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-medflow-700"
              >
                Open details
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
