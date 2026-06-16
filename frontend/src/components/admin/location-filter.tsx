"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Label } from "@/components/ui/label";
import { MapPin } from "lucide-react";

export interface FacilityOption {
  id: string;
  name: string;
  code: string;
  facilityType?: string | null;
}

interface LocationFilterProps {
  value: string;
  onChange: (facilityId: string) => void;
}

const TYPE_LABELS: Record<string, string> = {
  HOSPITAL: "Hospital",
  CLINIC: "Clinic",
  PHARMACY: "Pharmacy",
  WAREHOUSE: "Warehouse",
  REGIONAL_STORE: "Regional Store",
  AMS_CENTRAL: "AMS / Central",
};

export function LocationFilter({ value, onChange }: LocationFilterProps) {
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);

  useEffect(() => {
    api<FacilityOption[]>("/auth/facilities").then(setFacilities).catch(console.error);
  }, []);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm animate-in fade-in duration-300">
      <div className="flex items-center gap-2 text-medflow-700">
        <MapPin className="h-4 w-4" />
        <Label className="text-sm font-semibold text-slate-700">Location</Label>
      </div>
      <select
        className="mt-2 flex h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm transition focus:border-medflow-400 focus:outline-none focus:ring-2 focus:ring-medflow-100"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">All Locations</option>
        {facilities.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} ({f.code})
            {f.facilityType ? ` — ${TYPE_LABELS[f.facilityType] ?? f.facilityType}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
