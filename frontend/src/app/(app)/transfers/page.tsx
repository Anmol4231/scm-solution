"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";

interface Transfer {
  id: string;
  transferCode: string;
  status: string;
  priority: string;
  createdAt: string;
  fromFacility: { id: string; name: string; code: string };
  toFacility: { id: string; name: string; code: string };
  medicine: { medicineName: string } | null;
  lines: { id: string; medicine: { medicineName: string }; quantityTransferred: number; quantityReceived: number | null }[];
  createdBy: { firstName: string; lastName: string } | null;
  authorizedBy: { firstName: string; lastName: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  AUTHORIZED: "bg-blue-100 text-blue-700",
  IN_TRANSIT: "bg-cyan-100 text-cyan-700",
  RECEIVED: "bg-emerald-100 text-emerald-700",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-700",
  CANCELLED: "bg-red-100 text-red-600",
};

export default function TransfersPage() {
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);
  const hasAccess = useRequirePermission("transfers");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [view, setView] = useState<"sent" | "received">("sent");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api<Transfer[]>(`/transfers`).then(setTransfers).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // "Sent" = anything dispatched / in the pipeline but not yet fully received;
  // "Received" = fully received. (Cancelled transfers are hidden from both.)
  const SENT_STATUSES = ["PENDING", "AUTHORIZED", "IN_TRANSIT", "PARTIALLY_RECEIVED"];
  const visible = transfers.filter((t) =>
    view === "received" ? t.status === "RECEIVED" : SENT_STATUSES.includes(t.status)
  );

  const pendingIncoming = transfers.filter(
    (t) => user?.facilityId && t.toFacility.id === user.facilityId && (t.status === "IN_TRANSIT" || t.status === "PARTIALLY_RECEIVED")
  );
  const pendingAuth = transfers.filter(
    (t) => user?.facilityId && t.fromFacility.id === user.facilityId && t.status === "PENDING"
  );

  const linesSummary = (t: Transfer) => {
    if (t.lines.length > 0) return `${t.lines.length} item${t.lines.length > 1 ? "s" : ""}`;
    if (t.medicine) return t.medicine.medicineName;
    return "—";
  };

  if (!hasAccess) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 text-2xl font-bold">Transfers</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/transfers/receive">
            <Button variant="outline">Receive Transfers</Button>
          </Link>
          <Link href="/transfers/send">
            <Button>New Transfer</Button>
          </Link>
        </div>
      </div>

      {/* Action banners */}
      {pendingIncoming.length > 0 && (
        <Link href="/transfers/receive" className="block rounded-lg border border-amber-300 bg-amber-50 p-4 hover:bg-amber-100">
          <p className="font-semibold text-amber-800">{pendingIncoming.length} incoming transfer{pendingIncoming.length > 1 ? "s" : ""} awaiting your receipt — click to receive →</p>
        </Link>
      )}
      {pendingAuth.length > 0 && (
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-4">
          <p className="font-semibold text-blue-800">{pendingAuth.length} outgoing transfer{pendingAuth.length > 1 ? "s" : ""} awaiting authorization</p>
        </div>
      )}

      {/* View filter */}
      <div className="flex flex-wrap gap-2">
        {([["sent", "Sent"], ["received", "Received"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-full px-4 py-1 text-sm font-medium ${view === v ? "bg-medflow-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Source Facility</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Destination Facility</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Contents</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visible.length === 0 ? (
                <tr><td colSpan={6} className="py-8 text-center text-slate-400">No {view} transfers.</td></tr>
              ) : (
                visible.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/transfers/${t.id}`} className="font-mono text-medflow-600 hover:underline">{t.transferCode}</Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_COLORS[t.status] ?? ""}`}>{t.status.replace(/_/g, " ")}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{t.fromFacility.name}</td>
                    <td className="px-4 py-3 text-slate-700">{t.toFacility.name}</td>
                    <td className="px-4 py-3 text-slate-600">{linesSummary(t)}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
