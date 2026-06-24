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
import { Input } from "@/components/ui/input";
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
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [facilityFilter, setFacilityFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
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

  // Facility options for the admin filter — derived from the transfers themselves
  // (both source and destination), so no extra fetch is needed.
  const facilityOptions = Array.from(
    new Map(
      transfers.flatMap((t) => [
        [t.fromFacility.id, t.fromFacility] as const,
        [t.toFacility.id, t.toFacility] as const,
      ])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const myFacility = user?.facilityId;
  const q = search.trim().toLowerCase();
  const visible = transfers.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false;
    // Facility filter matches either side of the transfer.
    if (facilityFilter && t.fromFacility.id !== facilityFilter && t.toFacility.id !== facilityFilter) return false;
    const day = t.createdAt.slice(0, 10);
    if (fromDate && day < fromDate) return false;
    if (toDate && day > toDate) return false;
    if (q) {
      const hay = [
        t.transferCode,
        t.fromFacility.name,
        t.toFacility.name,
        t.medicine?.medicineName ?? "",
        ...t.lines.map((l) => l.medicine.medicineName),
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
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

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative max-w-md">
          <Input
            placeholder="Search by transfer code, facility, or medicine…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-slate-50/60 p-3">
          {isAdmin && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-600">Facility</label>
              <select value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)} className="h-9 rounded-lg border bg-white px-2 text-sm">
                <option value="">All Facilities</option>
                {facilityOptions.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-lg border bg-white px-2 text-sm">
              <option value="">All Statuses</option>
              {Object.keys(STATUS_COLORS).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">From</label>
            <Input type="date" className="h-9 w-40" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-600">To</label>
            <Input type="date" className="h-9 w-40" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <button
            type="button"
            onClick={() => { setSearch(""); setStatusFilter(""); setFacilityFilter(""); setFromDate(""); setToDate(""); }}
            className="h-9 self-end rounded-lg border border-slate-200 px-3 text-sm text-slate-600 hover:bg-white"
          >
            Clear
          </button>
        </div>
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
