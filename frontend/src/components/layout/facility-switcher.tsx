"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Label } from "@/components/ui/label";

interface Facility {
  id: string;
  name: string;
  code: string;
}

export function FacilitySwitcher() {
  const { user, switchFacility } = useAuth();
  const [facilities, setFacilities] = useState<Facility[]>([]);

  useEffect(() => {
    if (user?.role === "PROVINCIAL_MANAGER") {
      api<Facility[]>("/auth/facilities").then(setFacilities).catch(console.error);
    }
  }, [user?.role]);

  if (user?.role !== "PROVINCIAL_MANAGER" || !facilities.length) return null;

  return (
    <div className="mb-4">
      <Label>Viewing facility</Label>
      <select
        className="mt-1 flex h-11 w-full rounded-lg border px-3"
        value={user.facilityId || ""}
        onChange={(e) => e.target.value && switchFacility(e.target.value)}
      >
        <option value="">All facilities (admin view)</option>
        {facilities.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} ({f.code})
          </option>
        ))}
      </select>
    </div>
  );
}
