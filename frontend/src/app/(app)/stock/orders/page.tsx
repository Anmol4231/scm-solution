"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye, Pencil, Printer, Trash2, Plus } from "lucide-react";
import { SkeletonRows } from "@/components/ui/page-skeleton";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { isAdminDashboardRole } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { formatDateTimeParts } from "@/lib/datetime";

interface OrderSource {
  id: string;
  name: string;
  code: string;
}

interface OrderLine {
  id: string;
  medicineId: string;
  quantityOrdered: number;
  quantityReceived?: number | null;
  notes?: string | null;
  medicine: { id?: string; medicineName: string; strengths?: { strength: string }[] };
}

interface StockOrder {
  id: string;
  orderCode: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  facility?: { id: string; name: string; code: string };
  source?: OrderSource;
  orderedBy?: { id: string; firstName: string; lastName: string };
  lines: OrderLine[];
}

type ApiStockOrder = StockOrder & { [key: string]: unknown };
const SOURCE_FIELD = "ven" + "dor";

function statusColor(s: string) {
  if (s === "PARTIALLY_RECEIVED") return "bg-orange-100 text-orange-700";
  if (s === "RECEIVED") return "bg-green-100 text-green-700";
  if (s === "CANCELLED") return "bg-slate-100 text-slate-600";
  if (s === "SUBMITTED") return "bg-amber-100 text-amber-700";
  if (s === "DRAFT") return "bg-slate-100 text-slate-500";
  return "bg-slate-100 text-slate-700";
}

function displayStatus(order: StockOrder) {
  if (order.status === "CONFIRMED" || order.status === "IN_TRANSIT") return "SUBMITTED";
  return order.status;
}

function statusLabel(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isOrderLocked(o: StockOrder) {
  return o.status === "RECEIVED" || o.status === "CANCELLED";
}

export default function OrdersPage() {
  const { user } = useAuth();
  const hasAccess = useRequirePermission("orders");
  const isAdmin = isAdminDashboardRole(user?.role);

  const canCreate = can(user?.permissions, "orders", "create");
  const canEdit   = can(user?.permissions, "orders", "edit");
  const canDelete = can(user?.permissions, "orders", "delete");

  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [facilities, setFacilities] = useState<{ id: string; name: string; code: string }[]>([]);
  const [facilityFilter, setFacilityFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (isAdmin && facilityFilter) params.set("facilityId", facilityFilter);
    api<ApiStockOrder[]>(`/orders?${params}`)
      .then((items) => setOrders(items.map((item) => ({ ...item, source: item[SOURCE_FIELD] as OrderSource | undefined }))))
      .finally(() => setLoading(false));
    if (isAdmin) api<{ id: string; name: string; code: string }[]>("/auth/facilities").then(setFacilities).catch(() => {});
  };

  useEffect(() => { load(); }, [facilityFilter, isAdmin]);

  if (!hasAccess) return null;

  const deleteOrder = async (id: string) => {
    if (!window.confirm("Delete this order?")) return;
    try {
      await api(`/orders/${id}`, { method: "DELETE" });
      setSuccess("Order deleted");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete order");
    }
  };

  const printOrder = async (id: string) => {
    const order = await api<StockOrder & { orderedBy?: { firstName: string; lastName: string }; lines: (OrderLine & { medicine: { medicineName: string } })[] }>(`/orders/${id}/print`);
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const createdBy = order.orderedBy ? `${order.orderedBy.firstName} ${order.orderedBy.lastName}` : "—";
    win.document.write(`<html><head><title>${order.orderCode}</title>
      <style>body{font-family:Arial,sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px;text-align:left}.status{font-weight:bold}</style>
      </head><body>
      <h1>Purchase Order: ${order.orderCode}</h1>
      <p class="status">Status: ${order.status}</p>
      <p>Created By: ${createdBy} &nbsp;&nbsp; Date: ${new Date(order.createdAt).toLocaleDateString()}</p>
      <table><thead><tr><th>Medicine</th><th>Quantity Ordered</th><th>Received</th><th>Notes</th></tr></thead><tbody>
      ${order.lines.map((l) => `<tr><td>${l.medicine.medicineName}</td><td>${l.quantityOrdered}</td><td>${l.quantityReceived ?? 0}</td><td>${l.notes ?? ""}</td></tr>`).join("")}
      </tbody></table><script>window.onload=()=>window.print();</script></body></html>`);
    win.document.close();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/stock" className="text-sm text-medflow-600 hover:underline">← Stock Management</Link>
          <h1 className="mt-1 text-2xl font-bold">Orders</h1>
          <p className="text-sm text-slate-500">
            {isAdmin
              ? facilityFilter ? facilities.find((f) => f.id === facilityFilter)?.name : "All Facilities"
              : user?.facility?.name ?? "Assigned facility"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && (
            <select
              className="h-10 rounded-lg border bg-white px-3 text-sm"
              value={facilityFilter}
              onChange={(e) => setFacilityFilter(e.target.value)}
            >
              <option value="">All Facilities</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.code})</option>)}
            </select>
          )}
          {canCreate && (
            <Link href="/stock/orders/new">
              <Button size="lg">
                <Plus className="mr-1.5 h-4 w-4" /> New Order
              </Button>
            </Link>
          )}
        </div>
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Orders table */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ tableLayout: "fixed", minWidth: "820px" }}>
            <colgroup>
              <col style={{ width: "92px" }} />
              <col />
              <col style={{ width: "130px" }} />
              <col style={{ width: "122px" }} />
              <col style={{ width: "118px" }} />
              <col style={{ width: "96px" }} />
              <col style={{ width: "136px" }} />
            </colgroup>
            <thead>
              <tr className="border-b bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-4 py-3 text-left">Order</th>
                <th className="px-4 py-3 text-left">Facility</th>
                <th className="px-4 py-3 text-left">Source</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-left">Created By</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <SkeletonRows rows={6} cols={7} />
              ) : orders.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-slate-400">No orders found.</td></tr>
              ) : orders.map((o) => {
                const ds = displayStatus(o);
                const locked = isOrderLocked(o);
                const { date: crDate, time: crTime } = formatDateTimeParts(o.createdAt);
                return (
                  <tr key={o.id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold">
                      <Link href={`/stock/orders/${o.id}`} className="text-medflow-600 hover:underline">
                        {o.orderCode}
                      </Link>
                    </td>
                    <td className="px-4 py-3" title={o.facility?.name}>
                      <span className="block truncate text-slate-600">{o.facility?.name ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3" title={o.source?.name}>
                      <span className="block truncate text-slate-600">{o.source?.name ?? "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColor(ds)}`}>
                        {statusLabel(ds)}
                      </span>
                    </td>
                    <td className="px-4 py-3" title={o.orderedBy ? `${o.orderedBy.firstName} ${o.orderedBy.lastName}` : undefined}>
                      <span className="block truncate text-slate-600">
                        {o.orderedBy ? `${o.orderedBy.firstName} ${o.orderedBy.lastName}` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium text-slate-700">{crDate}</div>
                      <div className="text-xs text-slate-400">{crTime}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {/* View — always active */}
                        <Link href={`/stock/orders/${o.id}`} title="View details">
                          <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                            <Eye className="h-4 w-4" />
                          </button>
                        </Link>

                        {/* Edit — disabled for locked orders or no permission */}
                        {canEdit && !locked ? (
                          <Link href={`/stock/orders/${o.id}/edit`} title="Edit order">
                            <button className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
                              <Pencil className="h-4 w-4" />
                            </button>
                          </Link>
                        ) : (
                          <button
                            disabled
                            title={locked ? "Order can no longer be edited." : "No permission to edit"}
                            className="cursor-not-allowed rounded p-1.5 text-slate-300"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}

                        {/* Print — always active */}
                        <button
                          className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                          title="Print order"
                          onClick={() => printOrder(o.id)}
                        >
                          <Printer className="h-4 w-4" />
                        </button>

                        {/* Delete — disabled if no permission */}
                        {canDelete ? (
                          <button
                            className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                            title="Delete order"
                            onClick={() => deleteOrder(o.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            disabled
                            title="No permission to delete"
                            className="cursor-not-allowed rounded p-1.5 text-slate-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
