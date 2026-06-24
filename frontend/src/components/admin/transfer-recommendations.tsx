"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lightbulb, ArrowRight } from "lucide-react";

interface Recommendation {
  medicineName: string;
  fromFacility: { name: string; balance: number };
  toFacility: { name: string; balance: number };
  recommendedQuantity: number;
  reason: string;
  priority: string;
}

export function TransferRecommendationsPanel({ facilityFilter }: { facilityFilter: string }) {
  const [items, setItems] = useState<Recommendation[]>([]);

  useEffect(() => {
    const q = facilityFilter ? `?facilityId=${facilityFilter}` : "";
    api<{ recommendations: Recommendation[] }>(`/admin/transfer-recommendations${q}`)
      .then((d) => setItems(d.recommendations))
      .catch(console.error);
  }, [facilityFilter]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-amber-500" />
          <CardTitle className="text-base font-semibold">Cross-Facility Intelligence</CardTitle>
        </div>
        <p className="text-sm text-slate-500">Automated stock redistribution recommendations</p>
      </CardHeader>
      <CardContent className="max-h-80 space-y-2 overflow-y-auto">
        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">No transfer recommendations right now.</p>
        )}
        {items.map((r, i) => (
          <div
            key={i}
            className={`rounded-lg border p-3 text-sm transition hover:shadow-sm ${
              r.priority === "high" ? "border-sky-200 bg-sky-50/60" : "border-slate-100 bg-slate-50/80"
            }`}
          >
            <p className="font-semibold text-slate-900">{r.medicineName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-sm text-slate-600">
              <span>{r.fromFacility.name} ({Math.round(r.fromFacility.balance)})</span>
              <ArrowRight className="h-3 w-3" />
              <span className="font-medium text-medflow-700">
                Transfer {r.recommendedQuantity} units
              </span>
              <ArrowRight className="h-3 w-3" />
              <span>{r.toFacility.name} ({Math.round(r.toFacility.balance)})</span>
            </div>
            <p className="mt-2 text-sm text-slate-500">{r.reason}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
