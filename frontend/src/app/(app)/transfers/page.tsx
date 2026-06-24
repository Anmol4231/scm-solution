"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { Eye, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/datetime";

interface Transfer {
  id: string;
  transferCode: string;
  status: string;
  createdAt: string;
  fromFacility: { id: string; name: string; code: string };
  toFacility: { id: string; name: string; code: string };
  medicine: { medicineName: string } | null;
  lines: { id: string; medicine: { medicineName: string }; quantityTransferred: number; quantityReceived: number | null }[];
}

const STATUS_COLORS: Record<string, string> = {
  IN_TRANSIT: "bg-cyan-100 text-cyan-700",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-700",
  RECEIVED: "bg-green-100 text-green-700",
  CANCELLED: "bg-slate-100 text-slate-600",
};

// A transfer "has a receipt" once any stock has been received against it.
function hasReceipt(t: Transfer) {
  return t.status === "RECEIVED" || t.status === "PARTIALLY_RECEIVED" || t.lines.some((l) => (l.quantityReceived ?? 0) > 0);
}

function itemsSummary(t: Transfer) {
  if (t.lines.length > 0) return `${t.lines.length} item${t.lines.length > 1 ? "s" : ""}`;
  if (t.medicine) return t.medicine.medicineName;
  return "—";
}

export default function TransfersPage() {
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);
  const hasAccess = useRequirePermission("transfers");
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [view, setView] = useState<"all" | "outgoing" | "incoming">("all");
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"transferCode" | "from" | "to" | "items" | "status" | "createdAt">("createdAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(field); setSortDir("asc"); }
  };
  const SortButton = ({ field, label }: { field: typeof sortBy; label: string }) => (
    <button type="button" onClick={() => toggleSort(field)} className="inline-flex items-center gap-1 font-medium hover:text-medflow-700">
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${sortBy === field ? "text-medflow-600" : "text-slate-300"}`} />
    </button>
  );

  const load = () => {
    setLoading(true);
    api<Transfer[]>(`/transfers`).then(setTransfers).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (!hasAccess) return null;

  // Incoming = my facility is the destination; outgoing = my facility is the source.
  const myFacility = user?.facilityId;
  const visible = transfers.filter((t) => {
    if (view === "incoming") return isAdmin || t.toFacility.id === myFacility;
    if (view === "outgoing") return isAdmin || t.fromFacility.id === myFacility;
    return true;
  });

  const incomingToReceive = transfers.filter(
    (t) => myFacility && t.toFacility.id === myFacility && (t.status === "IN_TRANSIT" || t.status === "PARTIALLY_RECEIVED")
  );

  const sortedVisible = [...visible].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    let cmp = 0;
    switch (sortBy) {
      case "transferCode": cmp = a.transferCode.localeCompare(b.transferCode); break;
      case "from": cmp = a.fromFacility.name.localeCompare(b.fromFacility.name); break;
      case "to": cmp = a.toFacility.name.localeCompare(b.toFacility.name); break;
      case "items": cmp = a.lines.length - b.lines.length; break;
      case "status": cmp = a.status.localeCompare(b.status); break;
      case "createdAt": cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break;
    }
    return cmp * dir;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 text-2xl font-bold">Transfers</h1>
          <p className="text-sm text-slate-500">
            Move stock between facilities. Sending a transfer ships the stock immediately; the destination then records what it receives.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/transfers/receive">
            {incomingToReceive.length > 0 ? (
              <Button className="bg-amber-500 text-white hover:bg-amber-600">
                Receive
                <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-xs font-bold text-amber-700">
                  {incomingToReceive.length}
                </span>
              </Button>
            ) : (
              <Button variant="outline">Receive</Button>
            )}
          </Link>
          <Link href="/transfers/send">
            <Button>+ New Transfer</Button>
          </Link>
        </div>
      </div>

      {/* View filter */}
      <div className="flex flex-wrap gap-2">
        {([["all", "All"], ["outgoing", "Outgoing"], ["incoming", "Incoming"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)}
            className={`rounded-full px-4 py-1 text-sm font-medium ${view === v ? "bg-medflow-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {label}
          </button>
        ))}
      </div>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b bg-slate-50 text-left">
                <th className="p-3"><SortButton field="transferCode" label="Transfer" /></th>
                <th className="p-3"><SortButton field="from" label="From" /></th>
                <th className="p-3"><SortButton field="to" label="To" /></th>
                <th className="p-3"><SortButton field="items" label="Items" /></th>
                <th className="p-3"><SortButton field="status" label="Status" /></th>
                <th className="p-3"><SortButton field="createdAt" label="Date" /></th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading ? (
                <SkeletonRows rows={6} cols={7} />
              ) : sortedVisible.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-400">No transfers.</td></tr>
              ) : (
                sortedVisible.map((t) => {
                  const received = hasReceipt(t);
                  return (
                    <tr key={t.id} className={`align-middle ${received ? "bg-green-50/40" : "hover:bg-slate-50"}`}>
                      <td className="p-3 font-semibold">
                        <Link href={`/transfers/${t.id}`} className="font-mono text-medflow-600 hover:underline">{t.transferCode}</Link>
                      </td>
                      <td className="p-3 text-slate-700">{t.fromFacility.name}</td>
                      <td className="p-3 text-slate-700">{t.toFacility.name}</td>
                      <td className="p-3 text-slate-600">{itemsSummary(t)}</td>
                      <td className="p-3">
                        <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_COLORS[t.status] ?? "bg-slate-100 text-slate-700"}`}>
                          {t.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="p-3 whitespace-nowrap text-slate-500">{formatDate(t.createdAt)}</td>
                      <td className="p-3">
                        <Link href={`/transfers/${t.id}`}>
                          <Button size="sm" variant="ghost"
                            className="h-8 w-8 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                            title="View transfer details" aria-label="View transfer details"
                          >
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
