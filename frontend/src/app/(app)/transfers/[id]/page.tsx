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
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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
}

interface FacilityOption { id: string; name: string; code: string }
interface SourceBatch { id: string; batchNumber: string; expiryDate: string; quantity: number; medicine: { id: string; medicineName: string } }
interface EditLine { batchId: string; quantityTransferred: number }

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

  // edit form (PENDING transfers only)
  const [editing, setEditing] = useState(false);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [srcBatches, setSrcBatches] = useState<SourceBatch[]>([]);
  const [editTo, setEditTo] = useState("");
  const [editLines, setEditLines] = useState<EditLine[]>([]);

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
  const showEdit = status === "PENDING" && isSender && canEdit;

  const startEdit = () => {
    setError(""); setSuccess("");
    setEditTo(transfer.toFacility.id);
    setEditLines(transfer.lines.map((l) => ({ batchId: l.batchId, quantityTransferred: l.quantityTransferred })));
    setEditing(true);
    api<FacilityOption[]>("/auth/facilities").then(setFacilities).catch(() => {});
    api<SourceBatch[]>(`/stock/batches?facilityId=${transfer.fromFacility.id}`).then(setSrcBatches).catch(() => {});
  };

  const availableBatches = srcBatches.filter((b) => b.quantity > 0);
  const updateEditLine = (i: number, patch: Partial<EditLine>) =>
    setEditLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addEditLine = () => setEditLines((ls) => [...ls, { batchId: "", quantityTransferred: 0 }]);
  const removeEditLine = (i: number) => setEditLines((ls) => ls.filter((_, idx) => idx !== i));

  const saveEdit = () => {
    if (!editTo) { setError("Destination facility required"); return; }
    if (editTo === transfer.fromFacility.id) { setError("Destination must differ from the sending facility"); return; }
    if (!editLines.length || editLines.some((l) => !l.batchId || l.quantityTransferred <= 0)) {
      setError("Each line needs a batch and a quantity greater than 0"); return;
    }
    act("Transfer updated.", () =>
      api(`/transfers/${transfer.id}`, {
        method: "PATCH",
        body: JSON.stringify({ toFacilityId: editTo, lines: editLines }),
      }).then(() => setEditing(false))
    );
  };

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
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Created by</p><p className="font-medium">{personName(transfer.createdBy)} · {fmtDate(transfer.createdAt)}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Authorized by</p><p className="font-medium">{personName(transfer.authorizedBy)} · {fmtDate(transfer.authorizedAt)}</p></div>
            <div><p className="text-xs uppercase tracking-wide text-slate-500">Received by</p><p className="font-medium">{personName(transfer.receivedBy)} · {fmtDate(transfer.receivedAt)}</p></div>
          </div>
          {transfer.authorizationNotes && <p className="mt-3 border-t pt-3 text-sm text-slate-600">Notes: {transfer.authorizationNotes}</p>}
        </CardContent>
      </Card>

      {/* Actions */}
      {(showAuthorize || showDispatch || showCancel || showEdit) && !editing && (
        <Card>
          <CardHeader><CardTitle>Actions</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {showEdit && <Button onClick={startEdit} disabled={busy} variant="outline">Edit</Button>}
            {showAuthorize && <Button onClick={authorize} disabled={busy}>Authorize</Button>}
            {showDispatch && <Button onClick={dispatch} disabled={busy} className="bg-cyan-600 text-white hover:bg-cyan-700">Dispatch (deduct &amp; send)</Button>}
            {showCancel && <Button onClick={cancel} disabled={busy} variant="outline" className="text-red-600">Cancel Transfer</Button>}
          </CardContent>
        </Card>
      )}

      {/* Edit form (PENDING only) */}
      {editing && (
        <Card>
          <CardHeader><CardTitle>Edit Transfer</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="max-w-md">
              <Label>Destination Facility *</Label>
              <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={editTo} onChange={(e) => setEditTo(e.target.value)}>
                <option value="">Select destination…</option>
                {facilities.filter((f) => f.id !== transfer.fromFacility.id).map((f) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.code})</option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700">Stock Lines</p>
                <Button type="button" size="sm" variant="outline" onClick={addEditLine}>+ Add Line</Button>
              </div>
              {editLines.map((line, i) => {
                const selected = availableBatches.find((b) => b.id === line.batchId);
                return (
                  <div key={i} className="flex items-end gap-3">
                    <div className="flex-1">
                      <Label>Batch *</Label>
                      <select className="mt-1 h-10 w-full rounded-lg border px-3 text-sm" value={line.batchId} onChange={(e) => updateEditLine(i, { batchId: e.target.value })}>
                        <option value="">Select batch…</option>
                        {availableBatches.map((b) => (
                          <option key={b.id} value={b.id}>{b.medicine.medicineName} — {b.batchNumber} (qty {b.quantity}, exp {new Date(b.expiryDate).toLocaleDateString()})</option>
                        ))}
                      </select>
                      {selected && <p className="mt-0.5 text-xs text-slate-400">Available: {selected.quantity}</p>}
                    </div>
                    <div className="w-28">
                      <Label>Qty *</Label>
                      <Input type="number" min={1} max={selected?.quantity} value={line.quantityTransferred || ""} onChange={(e) => updateEditLine(i, { quantityTransferred: Number(e.target.value) })} />
                    </div>
                    {editLines.length > 1 && (
                      <Button type="button" variant="outline" size="sm" className="mb-0.5 text-red-600" onClick={() => removeEditLine(i)}>Remove</Button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Button onClick={saveEdit} disabled={busy}>{busy ? "Saving…" : "Save Changes"}</Button>
              <Button variant="outline" onClick={() => { setEditing(false); setError(""); }}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lines + receive form */}
      {!editing && (
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
      )}
    </div>
  );
}
