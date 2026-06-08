"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";

interface Voucher {
  id: string;
  voucherCode: string;
  status: string;
  createdAt: string;
  finalizedAt: string | null;
  requisition: {
    requisitionCode: string;
    requestingFacility: { name: string };
    issuingFacility: { name: string };
  };
  _count: { lines: number };
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  FINALIZED: "bg-amber-100 text-amber-700",
  ACKNOWLEDGED: "bg-emerald-100 text-emerald-700",
  VOID: "bg-red-100 text-red-600",
};

export default function IssueVouchersPage() {
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);
  const [items, setItems] = useState<Voucher[]>([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    setLoading(true);
    api<Voucher[]>(`/issue-vouchers?${params}`).then(setItems).finally(() => setLoading(false));
  }, [status]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Issue Vouchers</h1>
          <p className="text-sm text-slate-500">Formal dispatch documents for approved requisitions</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {["", "DRAFT", "FINALIZED", "ACKNOWLEDGED", "VOID"].map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-sm font-medium ${status === s ? "bg-medflow-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
            {s || "All"}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">No vouchers found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Voucher No.</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Requisition</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Status</th>
                {isAdmin && <th className="px-4 py-3 text-left font-medium text-slate-600">Requesting</th>}
                <th className="px-4 py-3 text-left font-medium text-slate-600">Issuing Store</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Lines</th>
                <th className="px-4 py-3 text-left font-medium text-slate-600">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link href={`/issue-vouchers/${v.id}`} className="font-mono text-medflow-600 hover:underline">{v.voucherCode}</Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm text-slate-500">{v.requisition.requisitionCode}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_COLORS[v.status] ?? ""}`}>{v.status}</span>
                  </td>
                  {isAdmin && <td className="px-4 py-3 text-slate-700">{v.requisition.requestingFacility.name}</td>}
                  <td className="px-4 py-3 text-slate-700">{v.requisition.issuingFacility.name}</td>
                  <td className="px-4 py-3 text-slate-600">{v._count.lines}</td>
                  <td className="px-4 py-3 text-slate-500">{new Date(v.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
