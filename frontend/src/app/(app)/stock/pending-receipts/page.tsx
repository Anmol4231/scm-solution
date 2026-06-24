"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { PageSkeleton } from "@/components/ui/page-skeleton";

// Generic client-side sort for the small pending-receipt queues.
function sortRows<T>(rows: T[], accessor: (r: T) => string | number, dir: "asc" | "desc"): T[] {
  return [...rows].sort((a, b) => {
    const av = accessor(a), bv = accessor(b);
    const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
    return dir === "asc" ? cmp : -cmp;
  });
}

interface PendingVoucher {
  id: string;
  voucherCode: string;
  status: string;
  createdAt: string;
  finalizedAt: string | null;
  requisition: {
    requisitionCode: string;
    priority: string;
    issuingFacility: { name: string };
  };
  _count: { lines: number };
}

interface PendingOrder {
  id: string;
  orderCode: string;
  status: string;
  createdAt: string;
  expectedDeliveryDate: string | null;
  vendor: { name: string };
  lines: { quantityOrdered: number }[];
}

export default function PendingReceiptsPage() {
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);
  const [vouchers, setVouchers] = useState<PendingVoucher[]>([]);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [loading, setLoading] = useState(true);

  // Sort state per table
  const [vSort, setVSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "issued", dir: "desc" });
  const [oSort, setOSort] = useState<{ field: string; dir: "asc" | "desc" }>({ field: "orderCode", dir: "asc" });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<PendingVoucher[]>("/issue-vouchers?status=FINALIZED"),
      api<PendingOrder[]>("/orders").then((all) => all.filter((o) => o.status === "CONFIRMED" || o.status === "SUBMITTED")),
    ]).then(([v, o]) => { setVouchers(v); setOrders(o); }).finally(() => setLoading(false));
  }, []);

  const voucherAccessors: Record<string, (v: PendingVoucher) => string | number> = {
    voucherCode: (v) => v.voucherCode,
    requisition: (v) => v.requisition.requisitionCode,
    issuingFacility: (v) => v.requisition.issuingFacility.name,
    priority: (v) => v.requisition.priority,
    lines: (v) => v._count.lines,
    issued: (v) => v.finalizedAt ?? "",
  };
  const orderAccessors: Record<string, (o: PendingOrder) => string | number> = {
    orderCode: (o) => o.orderCode,
    vendor: (o) => o.vendor.name,
    status: (o) => o.status,
    expected: (o) => o.expectedDeliveryDate ?? "",
  };

  const sortedVouchers = sortRows(vouchers, voucherAccessors[vSort.field], vSort.dir);
  const sortedOrders = sortRows(orders, orderAccessors[oSort.field], oSort.dir);

  const VSort = ({ field, label }: { field: string; label: string }) => (
    <button
      type="button"
      onClick={() => setVSort((s) => s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" })}
      className="inline-flex items-center gap-1 font-medium hover:text-medflow-700"
    >
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${vSort.field === field ? "text-medflow-600" : "text-slate-300"}`} />
    </button>
  );
  const OSort = ({ field, label }: { field: string; label: string }) => (
    <button
      type="button"
      onClick={() => setOSort((s) => s.field === field ? { field, dir: s.dir === "asc" ? "desc" : "asc" } : { field, dir: "asc" })}
      className="inline-flex items-center gap-1 font-medium hover:text-medflow-700"
    >
      {label}
      <ArrowUpDown className={`h-3.5 w-3.5 ${oSort.field === field ? "text-medflow-600" : "text-slate-300"}`} />
    </button>
  );

  if (loading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
        <h1 className="mt-1 text-2xl font-bold">Pending Receipts</h1>
        <p className="text-sm text-slate-500">Issue Vouchers and orders waiting to be received at your facility</p>
      </div>

      {/* Issue Vouchers */}
      <section>
        <h2 className="mb-2 text-base font-semibold text-slate-700">Issue Vouchers (from Requisitions)</h2>
        {vouchers.length === 0 ? (
          <p className="text-sm text-slate-500">No pending vouchers.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><VSort field="voucherCode" label="Voucher No." /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><VSort field="requisition" label="Requisition" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><VSort field="issuingFacility" label="Issuing Store" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><VSort field="priority" label="Priority" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><VSort field="lines" label="Lines" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><VSort field="issued" label="Issued" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedVouchers.map((v) => (
                  <tr key={v.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-medflow-600">{v.voucherCode}</td>
                    <td className="px-4 py-3 font-mono text-sm text-slate-500">{v.requisition.requisitionCode}</td>
                    <td className="px-4 py-3">{v.requisition.issuingFacility.name}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${v.requisition.priority === "EMERGENCY" ? "bg-red-100 text-red-700" : v.requisition.priority === "URGENT" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                        {v.requisition.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{v._count.lines}</td>
                    <td className="px-4 py-3 text-slate-500">{v.finalizedAt ? new Date(v.finalizedAt).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3">
                      <Link href={`/issue-vouchers/${v.id}`} className="text-sm text-medflow-600 hover:underline">Receive →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Vendor Orders */}
      <section>
        <h2 className="mb-2 text-base font-semibold text-slate-700">Vendor Orders (External Procurement)</h2>
        {orders.length === 0 ? (
          <p className="text-sm text-slate-500">No pending vendor orders.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><OSort field="orderCode" label="Order Code" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><OSort field="vendor" label="Vendor" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><OSort field="status" label="Status" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"><OSort field="expected" label="Expected" /></th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sortedOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-medflow-600">{o.orderCode}</td>
                    <td className="px-4 py-3">{o.vendor.name}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full px-2 py-0.5 text-sm font-medium bg-amber-100 text-amber-700">{o.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{o.expectedDeliveryDate ? new Date(o.expectedDeliveryDate).toLocaleDateString() : "—"}</td>
                    <td className="px-4 py-3">
                      <Link href={`/stock/receipt/${o.id}`} className="text-sm text-medflow-600 hover:underline">Receive →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
