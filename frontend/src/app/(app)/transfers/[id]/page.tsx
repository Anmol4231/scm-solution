"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { can } from "@/lib/permissions";
import { useRequirePermission } from "@/hooks/useRequirePermission";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface TransferLine {
  id: string;
  medicine: { id: string; medicineName: string } | null;
  batch: { batchNumber: string; expiryDate: string } | null;
  batchNumber: string;
  expiryDate: string;
  quantityTransferred: number;
  quantityReceived: number | null;
  shortfallFlag: boolean;
}

interface TransferDetail {
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
  lines: TransferLine[];
  createdBy: { firstName: string; lastName: string } | null;
  authorizedBy: { firstName: string; lastName: string } | null;
  receivedBy: { firstName: string; lastName: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  AUTHORIZED: "bg-blue-100 text-blue-700",
  IN_TRANSIT: "bg-cyan-100 text-cyan-700",
  RECEIVED: "bg-emerald-100 text-emerald-700",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-700",
  CANCELLED: "bg-red-100 text-red-600",
};

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString() : "—");
const personName = (p?: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : "—");

export default function TransferDetailPage() {
  const params = useParams();
  const transferId = params.id as string;
  const { user } = useAuth();
  const hasAccess = useRequirePermission("transfers");

  const [transfer, setTransfer] = useState<TransferDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  // receive form: lineId -> quantity to receive now
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [finalizeShortfall, setFinalizeShortfall] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<TransferDetail>(`/transfers/${transferId}`);
      setTransfer(data);
      // default each receive input to the remaining quantity for one-click "receive all"
      const defaults: Record<string, number> = {};
      for (const l of data.lines) defaults[l.id] = Math.max(0, l.quantityTransferred - (l.quantityReceived ?? 0));
      setReceiveQty(defaults);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load transfer");
    } finally {
      setLoading(false);
    }
  }, [transferId]);

  useEffect(() => { if (transferId) load(); }, [transferId, load]);

  if (!hasAccess) return null;
  if (loading) return <div className="p-8 text-center text-slate-500">Loading…</div>;
  if (!transfer) return <div className="p-8 text-center text-red-600">{error || "Transfer not found"}</div>;

  const isCrossAdmin = isCrossFacilityRole(user?.role);
  const isSender = isCrossAdmin || user?.facilityId === transfer.fromFacility.id;
  const isReceiver = isCrossAdmin || user?.facilityId === transfer.toFacility.id;

  const canApprove = can(user?.permissions, "transfers", "approve");
  const canEdit = can(user?.permissions, "transfers", "edit");

  const status = transfer.status;
  const showAuthorize = status === "PENDING" && isSender && canApprove;
  const showDispatch = status === "AUTHORIZED" && isSender && canEdit;
  const showCancel = (status === "PENDING" || status === "AUTHORIZED") && isSender && canEdit;
  const showReceive = (status === "IN_TRANSIT" || status === "PARTIALLY_RECEIVED") && isReceiver && canApprove;

  const remaining = (l: TransferLine) => Math.max(0, l.quantityTransferred - (l.quantityReceived ?? 0));

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setError(""); setSuccess(""); setBusy(true);
    try {
      await fn();
      setSuccess(label);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const authorize = () => act("Transfer authorized.", () => api(`/transfers/${transfer.id}/authorize`, { method: "POST" }));
  const dispatch = () => act("Transfer dispatched — stock deducted from source.", () => api(`/transfers/${transfer.id}/dispatch`, { method: "POST" }));
  const cancel = () => act("Transfer cancelled.", () => api(`/transfers/${transfer.id}/cancel`, { method: "POST" }));

  const submitReceive = () => {
    const lines = transfer.lines
      .map((l) => ({ lineId: l.id, quantityReceived: Number(receiveQty[l.id] ?? 0) }))
      .filter((l) => l.quantityReceived > 0);
    if (lines.length === 0 && !finalizeShortfall) {
      setError("Enter a quantity to receive on at least one line, or tick 'close with shortfall'.");
      return;
    }
    // over-receipt guard mirrors the backend (which is authoritative)
    for (const l of transfer.lines) {
      const q = Number(receiveQty[l.id] ?? 0);
      if (q > remaining(l)) { setError(`Cannot receive ${q} for ${l.medicine?.medicineName ?? "line"} — only ${remaining(l)} remaining.`); return; }
    }
    act(
      finalizeShortfall ? "Receipt recorded; transfer closed with documented shortfall." : "Receipt recorded.",
      () => api(`/transfers/${transfer.id}/receive-multi`, {
        method: "POST",
        body: JSON.stringify({ lines, finalizeShortfall }),
      })
    );
  };

  const totalTransferred = transfer.lines.reduce((s, l) => s + l.quantityTransferred, 0);
  const totalReceived = transfer.lines.reduce((s, l) => s + (l.quantityReceived ?? 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/transfers" className="text-sm text-medflow-600 hover:underline">← Transfers</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            {transfer.transferCode}
            <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_COLORS[status] ?? ""}`}>{status.replace(/_/g, " ")}</span>
          </h1>
        </div>
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Summary */}
      <Card>
        <CardHeader><CardTitle>Transfer Summary</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><p className="text-xs uppercase tracking-wide text-slate-500">From</p><p className="font-medium">{transfer.fromFacility.name} ({transfer.fromFacility.code})</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">To</p><p className="font-medium">{transfer.toFacility.name} ({transfer.toFacility.code})</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Priority</p><p className="font-medium">{transfer.priority}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Created by</p><p className="font-medium">{personName(transfer.createdBy)} · {fmtDate(transfer.createdAt)}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Authorized by</p><p className="font-medium">{personName(transfer.authorizedBy)} · {fmtDate(transfer.authorizedAt)}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Received by</p><p className="font-medium">{personName(transfer.receivedBy)} · {fmtDate(transfer.receivedAt)}</p></div>
          </div>
          {transfer.authorizationNotes && <p className="mt-3 border-t pt-3 text-sm text-slate-600">Notes: {transfer.authorizationNotes}</p>}
        </CardContent>
      </Card>

      {/* Actions */}
      {(showAuthorize || showDispatch || showCancel) && (
        <Card>
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {showAuthorize && <Button onClick={authorize} disabled={busy}>Authorize</Button>}
            {showDispatch && <Button onClick={dispatch} disabled={busy} className="bg-cyan-600 text-white hover:bg-cyan-700">Dispatch (deduct &amp; send)</Button>}
            {showCancel && <Button onClick={cancel} disabled={busy} variant="outline" className="text-red-600">Cancel Transfer</Button>}
          </CardContent>
        </Card>
      )}

      {/* Lines + receive form */}
      <Card>
        <CardHeader>
          <CardTitle>{showReceive ? "Receive Stock" : "Lines"}</CardTitle>
          {showReceive && <p className="text-sm text-slate-500">Enter quantities to receive — partial receipts are allowed and accumulate until the transfer is fully received.</p>}
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="p-3">Medicine</th>
                  <th className="p-3">Batch</th>
                  <th className="p-3 text-right">Transferred</th>
                  <th className="p-3 text-right">Received</th>
                  <th className="p-3 text-right">Remaining</th>
                  {showReceive && <th className="p-3 text-right w-32">Receive Now</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {transfer.lines.map((l) => {
                  const rem = remaining(l);
                  return (
                    <tr key={l.id}>
                      <td className="p-3 font-medium">{l.medicine?.medicineName ?? "—"}</td>
                      <td className="p-3 text-slate-600">{l.batch?.batchNumber ?? l.batchNumber} · exp {l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : "—"}</td>
                      <td className="p-3 text-right">{l.quantityTransferred}</td>
                      <td className="p-3 text-right text-slate-500">{l.quantityReceived ?? 0}{l.shortfallFlag && <span className="ml-1 text-xs text-orange-600">(short)</span>}</td>
                      <td className={`p-3 text-right font-medium ${rem > 0 ? "text-orange-600" : "text-green-600"}`}>{rem}</td>
                      {showReceive && (
                        <td className="p-3">
                          {rem === 0 ? (
                            <span className="block text-right text-green-600">Complete</span>
                          ) : (
                            <Input type="number" min={0} max={rem} className="text-right"
                              value={receiveQty[l.id] ?? 0}
                              onChange={(e) => setReceiveQty((q) => ({ ...q, [l.id]: Math.max(0, Math.min(rem, Number(e.target.value))) }))} />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t p-3 text-sm">
            <span className="text-slate-500">Total received {totalReceived} / {totalTransferred}</span>
          </div>

          {showReceive && (
            <div className="space-y-3 border-t p-4">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-medflow-600" checked={finalizeShortfall} onChange={(e) => setFinalizeShortfall(e.target.checked)} />
                Close transfer now and record any undelivered remainder as a documented loss (use when no further delivery is expected).
              </label>
              <Button onClick={submitReceive} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
                {busy ? "Saving…" : finalizeShortfall ? "Receive & Close" : "Confirm Receipt"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
