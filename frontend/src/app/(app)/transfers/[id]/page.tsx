"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TransferLine {
  id: string;
  medicine: { medicineName: string; genericName?: string };
  batch: { batchNumber: string; expiryDate: string };
  batchNumber: string;
  expiryDate: string;
  quantityTransferred: number;
  quantityReceived: number | null;
  shortfallFlag: boolean;
}

interface Transfer {
  id: string;
  transferCode: string;
  status: string;
  priority: string;
  authorizationNotes: string | null;
  createdAt: string;
  authorizedAt: string | null;
  dispatchedAt: string | null;
  receivedAt: string | null;
  fromFacility: { id: string; name: string; code: string };
  toFacility: { id: string; name: string; code: string };
  createdBy: { firstName: string; lastName: string } | null;
  authorizedBy: { firstName: string; lastName: string } | null;
  receivedBy: { firstName: string; lastName: string } | null;
  lines: TransferLine[];
  // Legacy single-item fields
  medicine?: { medicineName: string } | null;
  quantity?: number | null;
  batchNumber?: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  AUTHORIZED: "bg-blue-100 text-blue-700",
  IN_TRANSIT: "bg-cyan-100 text-cyan-700",
  RECEIVED: "bg-emerald-100 text-emerald-700",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-700",
  CANCELLED: "bg-red-100 text-red-600",
};

export default function TransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);

  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receiptQtys, setReceiptQtys] = useState<Record<string, number>>({});

  const load = async () => {
    const t = await api<Transfer>(`/transfers/${id}`);
    setTransfer(t);
    const qtys: Record<string, number> = {};
    for (const l of t.lines) qtys[l.id] = l.quantityTransferred;
    setReceiptQtys(qtys);
  };

  useEffect(() => { load(); }, [id]);

  if (!transfer) return <p className="text-sm text-slate-500 p-4">Loading…</p>;

  const isSender = isAdmin || user?.facilityId === transfer.fromFacility.id;
  const isReceiver = isAdmin || user?.facilityId === transfer.toFacility.id;

  const doAction = async (path: string, body: object = {}) => {
    setBusy(true); setError("");
    try { await api(`/transfers/${id}/${path}`, { method: "POST", body: JSON.stringify(body) }); await load(); }
    catch (e: any) { setError(e?.message ?? "Action failed"); }
    finally { setBusy(false); }
  };

  const isLegacy = transfer.lines.length === 0 && transfer.medicine;

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/transfers" className="text-sm text-medflow-600 hover:underline">← Transfers</Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono">{transfer.transferCode}</h1>
          <p className="text-sm text-slate-500">{new Date(transfer.createdAt).toLocaleString()}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_COLORS[transfer.status] ?? ""}`}>{transfer.status.replace(/_/g, " ")}</span>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">From</p><p className="font-medium">{transfer.fromFacility.name}</p></div>
          <div><p className="text-xs text-slate-500">To</p><p className="font-medium">{transfer.toFacility.name}</p></div>
          <div><p className="text-xs text-slate-500">Priority</p><p className="font-medium">{transfer.priority}</p></div>
          {transfer.createdBy && <div><p className="text-xs text-slate-500">Created By</p><p>{transfer.createdBy.firstName} {transfer.createdBy.lastName}</p></div>}
          {transfer.authorizedBy && <div><p className="text-xs text-slate-500">Authorized By</p><p>{transfer.authorizedBy.firstName} {transfer.authorizedBy.lastName} {transfer.authorizedAt ? `(${new Date(transfer.authorizedAt).toLocaleDateString()})` : ""}</p></div>}
          {transfer.receivedBy && <div><p className="text-xs text-slate-500">Received By</p><p>{transfer.receivedBy.firstName} {transfer.receivedBy.lastName}</p></div>}
          {transfer.authorizationNotes && <div className="col-span-full"><p className="text-xs text-slate-500">Notes</p><p>{transfer.authorizationNotes}</p></div>}
        </CardContent>
      </Card>

      {/* Lines */}
      {!isLegacy && (
        <Card>
          <CardHeader><CardTitle>Stock Lines</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Medicine</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Batch</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Expiry</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Transferred</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Received</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {transfer.lines.map((line) => (
                  <tr key={line.id} className={line.shortfallFlag ? "bg-amber-50" : ""}>
                    <td className="px-4 py-3 font-medium">{line.medicine.medicineName}</td>
                    <td className="px-4 py-3 font-mono text-xs">{line.batchNumber}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(line.expiryDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right">{line.quantityTransferred}</td>
                    <td className="px-4 py-3 text-right">
                      {transfer.status === "IN_TRANSIT" && isReceiver ? (
                        <Input type="number" min={0} max={line.quantityTransferred} className="w-24 text-right" value={receiptQtys[line.id] ?? line.quantityTransferred}
                          onChange={(e) => setReceiptQtys((q) => ({ ...q, [line.id]: +e.target.value }))} />
                      ) : (
                        line.quantityReceived ?? "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Legacy single-item display */}
      {isLegacy && transfer.medicine && (
        <Card>
          <CardContent className="pt-4">
            <p className="text-sm"><strong>Medicine:</strong> {transfer.medicine.medicineName} · <strong>Qty:</strong> {transfer.quantity} · <strong>Batch:</strong> {transfer.batchNumber}</p>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {transfer.status === "PENDING" && isSender && (
          <Button onClick={() => doAction("authorize")} disabled={busy}>Authorize Transfer</Button>
        )}
        {transfer.status === "AUTHORIZED" && isSender && (
          <Button onClick={() => doAction("dispatch")} disabled={busy}>Dispatch (Deduct Stock)</Button>
        )}
        {transfer.status === "IN_TRANSIT" && isReceiver && !isLegacy && (
          <Button onClick={() => doAction("receive-multi", { lines: transfer.lines.map((l) => ({ lineId: l.id, quantityReceived: receiptQtys[l.id] ?? l.quantityTransferred })) })} disabled={busy}>
            Confirm Receipt
          </Button>
        )}
        {["PENDING", "AUTHORIZED"].includes(transfer.status) && isSender && (
          <Button variant="outline" className="text-red-600" onClick={() => doAction("cancel")} disabled={busy}>Cancel</Button>
        )}
      </div>
    </div>
  );
}
