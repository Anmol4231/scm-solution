"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/page-skeleton";

interface Requisition {
  id: string;
  requisitionCode: string;
  status: string;
  priority: string;
  createdAt: string;
  requestingFacility: { id: string; name: string; code: string };
  issuingFacility: { id: string; name: string; code: string };
  requestedBy: { firstName: string; lastName: string };
  _count: { lines: number };
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SUBMITTED: "bg-amber-100 text-amber-700",
  UNDER_REVIEW: "bg-blue-100 text-blue-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  ISSUED: "bg-violet-100 text-violet-700",
  IN_TRANSIT: "bg-cyan-100 text-cyan-700",
  RECEIVED: "bg-green-100 text-green-700",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-700",
  CLOSED: "bg-slate-100 text-slate-500",
  CANCELLED: "bg-red-100 text-red-600",
};

const PRIORITY_COLORS: Record<string, string> = {
  ROUTINE: "bg-slate-100 text-slate-600",
  URGENT: "bg-amber-100 text-amber-700",
  EMERGENCY: "bg-red-100 text-red-700",
};

const ALL_STATUSES = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "ISSUED", "IN_TRANSIT", "RECEIVED", "PARTIALLY_RECEIVED", "CLOSED", "CANCELLED"];

export default function RequisitionsPage() {
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);
  const [items, setItems] = useState<Requisition[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    api<Requisition[]>(`/requisitions?${params}`).then(setItems).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [status]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Requisitions</h1>
          <p className="text-sm text-slate-500">Stock requests from facilities to supply stores</p>
        </div>
        <Link href="/requisitions/new">
          <Button>New Requisition</Button>
        </Link>
      </div>

      {/* Status filter */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setStatus("")}
          className={`rounded-full px-3 py-1 text-sm font-medium ${!status ? "bg-medflow-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          All
        </button>
        {["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "ISSUED", "RECEIVED"].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${status === s ? "bg-medflow-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <tbody><SkeletonRows rows={6} cols={isAdmin ? 7 : 6} /></tbody>
          </table>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No requisitions found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Code</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                {isAdmin && <th className="px-4 py-3 text-left font-medium text-slate-600">Requesting</th>}
                <th className="px-4 py-3 text-left font-medium text-slate-600">Issuing Store</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Priority</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Lines</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/requisitions/${r.id}`} className="font-mono text-medflow-600 hover:underline">
                      {r.requisitionCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_COLORS[r.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {r.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  {isAdmin && <td className="px-4 py-3 text-slate-700">{r.requestingFacility.name}</td>}
                  <td className="px-4 py-3 text-slate-700">{r.issuingFacility.name}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${PRIORITY_COLORS[r.priority] ?? ""}`}>
                      {r.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{r._count.lines}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
