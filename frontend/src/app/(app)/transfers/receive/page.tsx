"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface Transfer {
  id: string;
  transferCode: string;
  status: string;
  priority: string;
  createdAt: string;
  fromFacility: { id: string; name: string; code: string };
  toFacility: { id: string; name: string; code: string };
  lines: { id: string; medicine: { medicineName: string } | null; quantityTransferred: number; quantityReceived: number | null }[];
}

const STATUS_COLORS: Record<string, string> = {
  IN_TRANSIT: "bg-cyan-100 text-cyan-700",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-700",
};

export default function ReceiveTransferPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("transfers");
  const isAdmin = isCrossFacilityRole(user?.role);

  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    // Incoming transfers awaiting receipt: IN_TRANSIT or PARTIALLY_RECEIVED.
    Promise.all([
      api<Transfer[]>("/transfers?status=IN_TRANSIT"),
      api<Transfer[]>("/transfers?status=PARTIALLY_RECEIVED"),
    ])
      .then(([a, b]) => {
        const merged = [...a, ...b].filter((t) => isAdmin || t.toFacility.id === user?.facilityId);
        merged.sort((x, y) => new Date(y.createdAt).getTime() - new Date(x.createdAt).getTime());
        setTransfers(merged);
      })
      .finally(() => setLoading(false));
  }, [isAdmin, user?.facilityId]);

  if (!hasAccess) return null;

  const remaining = (t: Transfer) =>
    t.lines.reduce((s, l) => s + Math.max(0, l.quantityTransferred - (l.quantityReceived ?? 0)), 0);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <Link href="/transfers" className="text-sm text-medflow-600 hover:underline">← Transfers</Link>
        <h1 className="mt-1 text-2xl font-bold">Receive Transfers</h1>
        <p className="text-sm text-slate-500">Incoming transfers awaiting receipt. Open one to confirm received quantities (partial receipts supported).</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="p-6 text-center text-sm text-slate-500">Loading…</p>
          ) : transfers.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">No incoming transfers awaiting receipt.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="p-3">Code</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">From</th>
                    <th className="p-3">Items</th>
                    <th className="p-3 text-right">Remaining</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transfers.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50/60">
                      <td className="p-3 font-mono font-semibold">{t.transferCode}</td>
                      <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_COLORS[t.status] ?? ""}`}>{t.status.replace(/_/g, " ")}</span></td>
                      <td className="p-3 text-slate-700">{t.fromFacility.name}</td>
                      <td className="p-3 text-slate-600">{t.lines.length} item{t.lines.length > 1 ? "s" : ""}</td>
                      <td className="p-3 text-right font-medium text-orange-600">{remaining(t)}</td>
                      <td className="p-3 text-right">
                        <Link href={`/transfers/${t.id}`}>
                          <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700">Receive</Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
