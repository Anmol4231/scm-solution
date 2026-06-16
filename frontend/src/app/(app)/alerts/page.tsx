"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { LocationFilter } from "@/components/admin/location-filter";
import { AlertCenter } from "@/components/dashboard/alert-center";

export default function AlertCenterPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("alerts");
  // Cross-facility admins can scope to all locations or a single one; facility users see their own facility.
  const canViewAllLocations = isCrossFacilityRole(user?.role);
  const [locationId, setLocationId] = useState("");
  const facilityId = canViewAllLocations ? locationId || undefined : user?.facilityId ?? undefined;

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Alert Center</h1>
      </div>

      {canViewAllLocations && (
        <div className="max-w-md">
          <LocationFilter value={locationId} onChange={setLocationId} />
        </div>
      )}

      <AlertCenter facilityId={facilityId} />
    </div>
  );
}
