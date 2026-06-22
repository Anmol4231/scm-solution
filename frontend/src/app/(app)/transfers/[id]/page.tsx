"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
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
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { formatDateTime, formatDate } from "@/lib/datetime";

interface TransferLine {
  id: string;
  medicine: { id: string; medicineName: string } | null;
  batchId: string;
  batch: { batchNumber: string; expiryDate: string } | null;
  batchNumber: string;
  expiryDate: string;
  quantityTransferred: number;
  quantityReceived: number | null;
  shortfallFlag: boolean;
  mismatchReason: string | null;
  remarks: string | null;
}

interface TransferDetail {
  id: string;
  transferCode: string;
  status: string;
  authorizationNotes: string | null;
  receiptNotes: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  fromFacility: { id: string; name: string; code: string };
  toFacility: { id: string; name: string; code: string };
  lines: TransferLine[];
  createdBy: { firstName: string; lastName: string } | null;
  receivedBy: { firstName: string; lastName: string } | null;
}

const STATUS_COLORS: Record<string, string> = {
  IN_TRANSIT: "bg-cyan-100 text-cyan-700",
  PARTIALLY_RECEIVED: "bg-orange-100 text-orange-700",
  RECEIVED: "bg-green-100 text-green-700",
  CANCELLED: "bg-slate-100 text-slate-600",
};

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
  const [mismatchReason, setMismatchReason] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [receiptNotes, setReceiptNotes] = useState("");

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
  if (loading) return <PageSkeleton />;
  if (!transfer) return <div className="p-8 text-center text-red-600">{error || "Transfer not found"}</div>;

  const isCrossAdmin = isCrossFacilityRole(user?.role);
  const isSender = isCrossAdmin || user?.facilityId === transfer.fromFacility.id;
  const isReceiver = isCrossAdmin || user?.facilityId === transfer.toFacility.id;

  const canApprove = can(user?.permissions, "transfers", "approve");
  const canEdit = can(user?.permissions, "transfers", "edit");

  const status = transfer.status;
  const receivable = status === "IN_TRANSIT" || status === "PARTIALLY_RECEIVED";
  const showReceive = receivable && isReceiver && canApprove;
  const anyReceived = transfer.lines.some((l) => (l.quantityReceived ?? 0) > 0);
  const showCancel = status === "IN_TRANSIT" && !anyReceived && isSender && canEdit;

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

  const cancel = () => {
    if (!window.confirm("Recall this transfer? The stock will be returned to the sending facility.")) return;
    act("Transfer cancelled — stock returned to the source facility.", () => api(`/transfers/${transfer.id}/cancel`, { method: "POST" }));
  };

  const submitReceive = () => {
    // When finalizing shortfall, include ALL lines (even qty=0) so backend can validate
    // mismatch reason for lines that were never received.
    const lines = finalizeShortfall
      ? transfer.lines.map((l) => ({
          lineId: l.id,
          quantityReceived: Number(receiveQty[l.id] ?? 0),
          mismatchReason: mismatchReason[l.id] || undefined,
          remarks: remarks[l.id] || undefined,
        }))
      : transfer.lines
          .map((l) => ({ lineId: l.id, quantityReceived: Number(receiveQty[l.id] ?? 0) }))
          .filter((l) => l.quantityReceived > 0);

    if (lines.length === 0 && !finalizeShortfall) {
      setError("Enter a quantity to receive on at least one line, or tick 'close with shortfall'.");
      return;
    }
    for (const l of transfer.lines) {
      const q = Number(receiveQty[l.id] ?? 0);
      if (q > remaining(l)) { setError(`Cannot receive ${q} for ${l.medicine?.medicineName ?? "line"} — only ${remaining(l)} remaining.`); return; }
    }
    // Client-side mismatch validation when closing with shortfall
    if (finalizeShortfall) {
      for (const l of transfer.lines) {
        const newTotal = (l.quantityReceived ?? 0) + Number(receiveQty[l.id] ?? 0);
        if (newTotal < l.quantityTransferred) {
          if (!mismatchReason[l.id]) {
            setError(`Select a mismatch reason for ${l.medicine?.medicineName ?? l.batchNumber} (batch ${l.batchNumber}).`);
            return;
          }
          if (!remarks[l.id]?.trim()) {
            setError(`Remarks are required when received quantity differs from issued quantity for batch ${l.batchNumber}.`);
            return;
          }
        }
      }
    }
    act(
      finalizeShortfall ? "Receipt recorded; transfer closed with documented shortfall." : "Receipt recorded.",
      () => api(`/transfers/${transfer.id}/receive-multi`, {
        method: "POST",
        body: JSON.stringify({ lines, finalizeShortfall, notes: receiptNotes.trim() || undefined }),
      })
    );
  };

  const totalTransferred = transfer.lines.reduce((s, l) => s + l.quantityTransferred, 0);
  const totalReceived = transfer.lines.reduce((s, l) => s + (l.quantityReceived ?? 0), 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/transfers" className="text-sm text-medflow-600 hover:underline">← Transfers</Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold">
            {transfer.transferCode}
            <span className={`rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700"}`}>{status.replace(/_/g, " ")}</span>
          </h1>
        </div>
        {showCancel && (
          <Button variant="outline" className="text-red-600" disabled={busy} onClick={cancel}>Recall / Cancel</Button>
        )}
      </div>

      {success && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{success}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Transfer details */}
      <Card>
        <CardHeader><CardTitle>Transfer Details</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div><p className="text-sm font-medium uppercase tracking-wide text-slate-500">From</p><p className="font-medium">{transfer.fromFacility.name} ({transfer.fromFacility.code})</p></div>
            <div><p className="text-sm font-medium uppercase tracking-wide text-slate-500">To Facility</p><p className="font-medium">{transfer.toFacility.name} ({transfer.toFacility.code})</p></div>
            <div><p className="text-sm font-medium uppercase tracking-wide text-slate-500">Status</p>
              <span className={`inline-block rounded-full px-2 py-0.5 text-sm font-medium ${STATUS_COLORS[status] ?? "bg-slate-100 text-slate-700"}`}>{status.replace(/_/g, " ")}</span>
            </div>
            <div><p className="text-sm font-medium uppercase tracking-wide text-slate-500">Sent by</p><p className="font-medium">{personName(transfer.createdBy)}</p></div>
            <div><p className="text-sm font-medium uppercase tracking-wide text-slate-500">Date of Issue</p><p className="font-medium">{formatDateTime(transfer.dispatchedAt ?? transfer.createdAt)}</p></div>
            <div><p className="text-sm font-medium uppercase tracking-wide text-slate-500">Date Received</p><p className="font-medium">{transfer.receivedAt ? formatDateTime(transfer.receivedAt) : "—"}</p></div>
            <div><p className="text-sm font-medium uppercase tracking-wide text-slate-500">Received by</p><p className="font-medium">{personName(transfer.receivedBy)}</p></div>
          </div>
          {transfer.authorizationNotes && <p className="mt-3 border-t pt-3 text-sm text-slate-600">Sender notes: {transfer.authorizationNotes}</p>}
          {transfer.receiptNotes && <p className="mt-2 text-sm text-slate-600">Receipt notes: {transfer.receiptNotes}</p>}
        </CardContent>
      </Card>

      {/* Medicine lines (Sent / Received / Remaining / Variance) */}
      <Card>
        <CardHeader><CardTitle>Medicine Lines</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead className="border-b bg-slate-50 text-left text-sm text-slate-500">
                <tr>
                  <th className="p-3">Medicine</th>
                  <th className="p-3">Batch</th>
                  <th className="p-3 text-right">Issued Qty</th>
                  <th className="p-3 text-right">Received Qty</th>
                  <th className="p-3 text-right">Variance</th>
                  <th className="p-3 text-right">Remaining</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {transfer.lines.map((l) => {
                  const rem = remaining(l);
                  const received = l.quantityReceived ?? 0;
                  const variance = received - l.quantityTransferred;
                  return (
                    <tr key={l.id}>
                      <td className="p-3 font-medium">{l.medicine?.medicineName ?? "—"}</td>
                      <td className="p-3 text-slate-600">{l.batch?.batchNumber ?? l.batchNumber} · exp {l.expiryDate ? formatDate(l.expiryDate) : "—"}</td>
                      <td className="p-3 text-right">{l.quantityTransferred}</td>
                      <td className="p-3 text-right text-slate-600">{received}</td>
                      <td className={`p-3 text-right font-medium ${variance < 0 ? "text-orange-600" : variance > 0 ? "text-blue-600" : "text-green-600"}`}>
                        {variance === 0 ? "—" : variance > 0 ? `+${variance}` : `${variance}`}
                        {l.shortfallFlag && <span className="ml-1 text-xs text-orange-600">(short)</span>}
                      </td>
                      <td className={`p-3 text-right font-medium ${rem > 0 ? "text-orange-600" : "text-green-600"}`}>{rem}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Mismatch notes for finalized lines */}
          {transfer.lines.some((l) => l.mismatchReason || l.remarks) && (
            <div className="border-t p-3 space-y-1.5">
              {transfer.lines.filter((l) => l.mismatchReason || l.remarks).map((l) => (
                <div key={l.id} className="rounded bg-orange-50 px-3 py-2 text-sm">
                  <span className="font-medium text-orange-800">{l.medicine?.medicineName ?? l.batchNumber}</span>
                  {l.mismatchReason && <span className="ml-2 text-orange-700">Reason: {l.mismatchReason}</span>}
                  {l.remarks && <span className="ml-2 text-slate-600">— {l.remarks}</span>}
                </div>
              ))}
            </div>
          )}
          <div className="border-t p-3 text-sm text-slate-500">Total received {totalReceived} / {totalTransferred}</div>
        </CardContent>
      </Card>

      {/* Receipt — highlighted once any stock has been received */}
      {anyReceived && (
        <Card className="border-green-300">
          <CardHeader className="rounded-t-xl bg-green-50">
            <CardTitle className="flex items-center gap-2 text-green-800">
              <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
              Receipt
              {status === "PARTIALLY_RECEIVED" && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700">Partial</span>}
              {status === "RECEIVED" && <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Complete</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-slate-600">Received by: <strong>{personName(transfer.receivedBy)}</strong></span>
              {transfer.receivedAt && (
                <>
                  <span className="text-slate-600">Date Received: <strong>{formatDateTime(transfer.receivedAt)}</strong></span>
                  <span className="text-slate-600">Date of Issue: <strong>{formatDateTime(transfer.dispatchedAt ?? transfer.createdAt)}</strong></span>
                  <span className="text-slate-600">To Facility: <strong>{transfer.toFacility.name}</strong></span>
                </>
              )}
            </div>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-slate-50/60 text-sm text-slate-500">
                  <tr>
                    <th className="p-2 text-left">Medicine</th>
                    <th className="p-2 text-left">Batch</th>
                    <th className="p-2 text-right">Issued Qty</th>
                    <th className="p-2 text-right">Qty Received</th>
                    <th className="p-2 text-right">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transfer.lines.filter((l) => (l.quantityReceived ?? 0) > 0).map((l) => {
                    const variance = (l.quantityReceived ?? 0) - l.quantityTransferred;
                    return (
                      <tr key={l.id}>
                        <td className="p-2 font-medium">{l.medicine?.medicineName ?? "—"}</td>
                        <td className="p-2 text-slate-500">{l.batch?.batchNumber ?? l.batchNumber}</td>
                        <td className="p-2 text-right">{l.quantityTransferred}</td>
                        <td className="p-2 text-right font-semibold">{l.quantityReceived ?? 0}</td>
                        <td className={`p-2 text-right font-medium ${variance < 0 ? "text-orange-600" : variance > 0 ? "text-blue-600" : "text-green-600"}`}>
                          {variance === 0 ? "—" : variance > 0 ? `+${variance}` : `${variance}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {transfer.receiptNotes && (
              <p className="text-sm text-slate-600"><span className="font-medium">Receipt notes:</span> {transfer.receiptNotes}</p>
            )}
            {transfer.lines.some((l) => l.mismatchReason) && (
              <div className="space-y-1.5 rounded-lg border border-orange-200 bg-orange-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Mismatch Notes</p>
                {transfer.lines.filter((l) => l.mismatchReason).map((l) => (
                  <div key={l.id} className="text-sm text-slate-700">
                    <span className="font-medium">{l.medicine?.medicineName ?? l.batchNumber}</span>
                    <span className="ml-2 text-orange-700">({l.mismatchReason})</span>
                    {l.remarks && <span className="ml-2 text-slate-600">— {l.remarks}</span>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Receive form (destination only, while in transit) */}
      {showReceive && (
        <Card>
          <CardHeader>
            <CardTitle>Record Receipt</CardTitle>
            <p className="text-sm text-slate-500">Enter the quantities you received — partial receipts are allowed and accumulate until the transfer is fully received.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-slate-50 text-left text-sm text-slate-500">
                  <tr>
                    <th className="p-3">Medicine</th>
                    <th className="p-3">Batch</th>
                    <th className="p-3 text-right">Issued</th>
                    <th className="p-3 text-right">Remaining</th>
                    <th className="p-3 text-right w-36">Receive Now</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transfer.lines.map((l) => {
                    const rem = remaining(l);
                    const receiveNow = Number(receiveQty[l.id] ?? 0);
                    const projectedTotal = (l.quantityReceived ?? 0) + receiveNow;
                    const willHaveShortfall = finalizeShortfall && projectedTotal < l.quantityTransferred;
                    return (
                      <Fragment key={l.id}>
                        <tr>
                          <td className="p-3 font-medium">{l.medicine?.medicineName ?? "—"}</td>
                          <td className="p-3 text-slate-600">{l.batch?.batchNumber ?? l.batchNumber}</td>
                          <td className="p-3 text-right text-slate-500">{l.quantityTransferred}</td>
                          <td className={`p-3 text-right font-medium ${rem > 0 ? "text-orange-600" : "text-green-600"}`}>{rem}</td>
                          <td className="p-3">
                            {rem === 0 ? (
                              <span className="block text-right text-green-600">Complete</span>
                            ) : (
                              <Input type="number" min={0} max={rem} className="text-right"
                                value={receiveQty[l.id] ?? 0}
                                onChange={(e) => setReceiveQty((q) => ({ ...q, [l.id]: Math.max(0, Math.min(rem, Number(e.target.value))) }))} />
                            )}
                          </td>
                        </tr>
                        {willHaveShortfall && (
                          <tr className="bg-orange-50">
                            <td colSpan={5} className="px-3 pb-3 pt-1">
                              <div className="grid gap-2 sm:grid-cols-2">
                                <div>
                                  <label className="mb-1 block text-xs font-medium text-orange-700">Mismatch Reason *</label>
                                  <select
                                    className="h-9 w-full rounded border border-orange-300 bg-white px-2 text-sm"
                                    value={mismatchReason[l.id] ?? ""}
                                    onChange={(e) => setMismatchReason((r) => ({ ...r, [l.id]: e.target.value }))}
                                  >
                                    <option value="">Select reason…</option>
                                    <option>Damaged</option>
                                    <option>Missing in Transit</option>
                                    <option>Expired</option>
                                    <option>Counting Error</option>
                                    <option>Other</option>
                                  </select>
                                </div>
                                <div>
                                  <label className="mb-1 block text-xs font-medium text-orange-700">Remarks *</label>
                                  <Input
                                    placeholder="Required — describe the discrepancy"
                                    value={remarks[l.id] ?? ""}
                                    onChange={(e) => setRemarks((r) => ({ ...r, [l.id]: e.target.value }))}
                                    className="border-orange-300"
                                  />
                                </div>
                              </div>
                              <p className="mt-1 text-xs text-orange-600">Remarks are required when received quantity differs from issued quantity.</p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Receipt Notes</label>
              <textarea
                className="w-full rounded-lg border bg-white px-3 py-2 text-sm resize-none"
                rows={2}
                placeholder="Optional — any notes about this receipt"
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" className="h-4 w-4 accent-medflow-600" checked={finalizeShortfall} onChange={(e) => setFinalizeShortfall(e.target.checked)} />
              Finalize with shortfall — close transfer and document undelivered items as loss
            </label>
            <Button onClick={submitReceive} disabled={busy} className="bg-emerald-600 text-white hover:bg-emerald-700">
              {busy ? "Saving…" : finalizeShortfall ? "Receive & Close" : "Confirm Receipt"}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
