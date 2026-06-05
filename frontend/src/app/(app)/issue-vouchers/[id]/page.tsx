"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { isCrossFacilityRole } from "@/lib/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface VoucherLine {
  id: string;
  requisitionLineId: string | null;
  medicineId: string;
  medicine: { medicineName: string; genericName?: string; unitType: string };
  batchId: string | null;
  batchNumber: string;
  expiryDate: string;
  quantityIssued: number;
  stockBalanceAfter: number | null;
}

interface Voucher {
  id: string;
  voucherCode: string;
  status: string;
  createdAt: string;
  finalizedAt: string | null;
  acknowledgedAt: string | null;
  voidReason: string | null;
  notes: string | null;
  requisition: {
    id: string;
    requisitionCode: string;
    priority: string;
    requestingFacility: { id: string; name: string; code: string };
    issuingFacility: { id: string; name: string; code: string };
    requestedBy: { firstName: string; lastName: string };
  };
  finalizedBy: { firstName: string; lastName: string } | null;
  acknowledgedBy: { firstName: string; lastName: string } | null;
  lines: VoucherLine[];
}

interface Batch {
  id: string;
  batchNumber: string;
  expiryDate: string;
  quantity: number;
  facilityId: string;
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  FINALIZED: "bg-amber-100 text-amber-700",
  ACKNOWLEDGED: "bg-emerald-100 text-emerald-700",
  VOID: "bg-red-100 text-red-600",
};

export default function IssueVoucherDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);
  const printRef = useRef<HTMLDivElement>(null);

  const [voucher, setVoucher] = useState<Voucher | null>(null);
  const [batches, setBatches] = useState<Record<string, Batch[]>>({});
  const [lineEdits, setLineEdits] = useState<Record<string, { batchId: string; batchNumber: string; expiryDate: string; quantityIssued: number }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [showVoid, setShowVoid] = useState(false);
  const [showAcknowledge, setShowAcknowledge] = useState(false);
  const [receiptQtys, setReceiptQtys] = useState<Record<string, number>>({});

  const load = async () => {
    const v = await api<Voucher>(`/issue-vouchers/${id}`);
    setVoucher(v);
    const edits: typeof lineEdits = {};
    const qtys: Record<string, number> = {};
    for (const l of v.lines) {
      edits[l.id] = { batchId: l.batchId ?? "", batchNumber: l.batchNumber, expiryDate: l.expiryDate?.slice(0, 10) ?? "", quantityIssued: l.quantityIssued };
      qtys[l.id] = l.quantityIssued;
    }
    setLineEdits(edits);
    setReceiptQtys(qtys);
  };

  const loadBatchesForMedicine = async (medicineId: string, facilityId: string) => {
    if (batches[medicineId]) return;
    const result = await api<Batch[]>(`/stock/batches?facilityId=${facilityId}`);
    setBatches((b) => ({ ...b, [medicineId]: result.filter((x) => x.facilityId === facilityId && x.quantity > 0) }));
  };

  useEffect(() => { load(); }, [id]);

  useEffect(() => {
    if (voucher?.status === "DRAFT") {
      for (const line of voucher.lines) {
        loadBatchesForMedicine(line.medicineId, voucher.requisition.issuingFacility.id);
      }
    }
  }, [voucher?.status]);

  if (!voucher) return <p className="text-sm text-slate-500 p-4">Loading…</p>;

  const isIssuingUser = isAdmin || user?.facilityId === voucher.requisition.issuingFacility.id;
  const isRequestingUser = isAdmin || user?.facilityId === voucher.requisition.requestingFacility.id;
  const canEdit = voucher.status === "DRAFT" && isIssuingUser;

  const doAction = async (path: string, body: object) => {
    setBusy(true); setError("");
    try { await api(`/issue-vouchers/${id}/${path}`, { method: "POST", body: JSON.stringify(body) }); await load(); }
    catch (e: any) { setError(e?.message ?? "Action failed"); }
    finally { setBusy(false); }
  };

  const saveLinesAndFinalize = async () => {
    setBusy(true); setError("");
    try {
      await api(`/issue-vouchers/${id}/lines`, {
        method: "PATCH",
        body: JSON.stringify({ lines: Object.entries(lineEdits).map(([lineId, v]) => ({ lineId, ...v })) }),
      });
      await api(`/issue-vouchers/${id}/finalize`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const handleBatchSelect = (lineId: string, medicineId: string, batchId: string) => {
    const batch = (batches[medicineId] ?? []).find((b) => b.id === batchId);
    if (!batch) return;
    setLineEdits((e) => ({
      ...e,
      [lineId]: { ...e[lineId], batchId, batchNumber: batch.batchNumber, expiryDate: new Date(batch.expiryDate).toISOString().slice(0, 10) },
    }));
  };

  const handlePrint = () => window.print();

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/issue-vouchers" className="text-sm text-medflow-600 hover:underline print:hidden">← Issue Vouchers</Link>

      {/* Print-optimised header */}
      <div ref={printRef} className="space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold font-mono">{voucher.voucherCode}</h1>
            <p className="text-sm text-slate-500">Medical Stores Issue Voucher — {new Date(voucher.createdAt).toLocaleDateString()}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-sm font-medium print:hidden ${STATUS_COLORS[voucher.status] ?? ""}`}>{voucher.status}</span>
        </div>

        {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 print:hidden">{error}</p>}

        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-3">
            <div><p className="text-xs text-slate-500">Issuing Store (From)</p><p className="font-semibold">{voucher.requisition.issuingFacility.name}</p></div>
            <div><p className="text-xs text-slate-500">Requesting Unit (To)</p><p className="font-semibold">{voucher.requisition.requestingFacility.name}</p></div>
            <div><p className="text-xs text-slate-500">Requisition No.</p><p className="font-mono">{voucher.requisition.requisitionCode}</p></div>
            <div><p className="text-xs text-slate-500">Priority</p><p>{voucher.requisition.priority}</p></div>
            <div><p className="text-xs text-slate-500">Requested By</p><p>{voucher.requisition.requestedBy.firstName} {voucher.requisition.requestedBy.lastName}</p></div>
            {voucher.finalizedBy && <div><p className="text-xs text-slate-500">Issuing Officer</p><p>{voucher.finalizedBy.firstName} {voucher.finalizedBy.lastName}</p></div>}
            {voucher.acknowledgedBy && <div><p className="text-xs text-slate-500">Received By</p><p>{voucher.acknowledgedBy.firstName} {voucher.acknowledgedBy.lastName}</p></div>}
            {voucher.voidReason && <div className="col-span-full"><p className="text-xs text-slate-500">Void Reason</p><p className="text-red-600">{voucher.voidReason}</p></div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Issue Lines</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Description</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Batch No.</th>
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Expiry</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Qty Issued</th>
                    <th className="px-4 py-3 text-right font-medium text-slate-600">Balance After</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {voucher.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-3">
                        <p className="font-medium">{line.medicine.medicineName}</p>
                        {line.medicine.genericName && <p className="text-xs text-slate-500">{line.medicine.genericName}</p>}
                      </td>
                      <td className="px-4 py-3">
                        {canEdit ? (
                          <div className="space-y-1">
                            {(batches[line.medicineId] ?? []).length > 0 && (
                              <select className="h-9 w-full rounded-lg border px-2 text-xs"
                                value={lineEdits[line.id]?.batchId ?? ""}
                                onChange={(e) => handleBatchSelect(line.id, line.medicineId, e.target.value)}>
                                <option value="">Select batch…</option>
                                {(batches[line.medicineId] ?? []).map((b) => (
                                  <option key={b.id} value={b.id}>{b.batchNumber} (qty: {b.quantity})</option>
                                ))}
                              </select>
                            )}
                            <Input placeholder="Batch number" value={lineEdits[line.id]?.batchNumber ?? ""} onChange={(e) => setLineEdits((le) => ({ ...le, [line.id]: { ...le[line.id], batchNumber: e.target.value } }))} />
                          </div>
                        ) : (
                          <span className="font-mono text-sm">{line.batchNumber || "—"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {canEdit ? (
                          <Input type="date" value={lineEdits[line.id]?.expiryDate ?? ""} onChange={(e) => setLineEdits((le) => ({ ...le, [line.id]: { ...le[line.id], expiryDate: e.target.value } }))} />
                        ) : (
                          line.expiryDate ? new Date(line.expiryDate).toLocaleDateString() : "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canEdit ? (
                          <Input type="number" min={1} className="w-24 text-right" value={lineEdits[line.id]?.quantityIssued ?? ""} onChange={(e) => setLineEdits((le) => ({ ...le, [line.id]: { ...le[line.id], quantityIssued: +e.target.value } }))} />
                        ) : (
                          `${line.quantityIssued} ${line.medicine.unitType}`
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600">{line.stockBalanceAfter ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Signature blocks for print */}
        <div className="hidden print:grid grid-cols-2 gap-8 mt-8">
          <div className="space-y-8">
            <p className="text-sm font-medium">Issuing Officer:</p>
            <div className="border-b border-slate-400 w-full" />
            <p className="text-xs text-slate-500">Name / Signature / Date</p>
          </div>
          <div className="space-y-8">
            <p className="text-sm font-medium">Receiving Officer:</p>
            <div className="border-b border-slate-400 w-full" />
            <p className="text-xs text-slate-500">Name / Signature / Date</p>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3 print:hidden">
        {canEdit && (
          <Button onClick={saveLinesAndFinalize} disabled={busy}>Save & Finalize Voucher</Button>
        )}
        {voucher.status === "FINALIZED" && isRequestingUser && !showAcknowledge && (
          <Button variant="outline" onClick={() => setShowAcknowledge(true)} disabled={busy}>Acknowledge Receipt</Button>
        )}
        {voucher.status === "FINALIZED" && isRequestingUser && showAcknowledge && (
          <div className="w-full space-y-3 rounded-lg border p-4 bg-slate-50">
            <p className="text-sm font-medium">Confirm quantities actually received:</p>
            {voucher.lines.map((line) => (
              <div key={line.id} className="flex items-center gap-3">
                <span className="flex-1 text-sm">{line.medicine.medicineName} — issued: {line.quantityIssued}</span>
                <Input type="number" min={0} max={line.quantityIssued} className="w-28 text-right" value={receiptQtys[line.id] ?? line.quantityIssued}
                  onChange={(e) => setReceiptQtys((q) => ({ ...q, [line.id]: +e.target.value }))} />
              </div>
            ))}
            <div className="flex gap-2">
              <Button onClick={() => doAction("acknowledge", { lines: voucher.lines.map((l) => ({ lineId: l.id, quantityReceived: receiptQtys[l.id] ?? l.quantityIssued })) })} disabled={busy}>
                Confirm Receipt
              </Button>
              <Button variant="outline" onClick={() => setShowAcknowledge(false)}>Cancel</Button>
            </div>
          </div>
        )}
        {voucher.status === "FINALIZED" && user?.role === "SUPER_ADMIN" && (
          showVoid ? (
            <div className="flex gap-2 items-center">
              <Input placeholder="Void reason…" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="w-64" />
              <Button variant="outline" className="text-red-600" disabled={!voidReason || busy} onClick={() => doAction("void", { reason: voidReason })}>Confirm Void</Button>
              <Button variant="outline" onClick={() => setShowVoid(false)}>Back</Button>
            </div>
          ) : (
            <Button variant="outline" className="text-red-600" onClick={() => setShowVoid(true)}>Void Voucher</Button>
          )
        )}
        <Button variant="outline" onClick={handlePrint}>Print Voucher</Button>
      </div>
    </div>
  );
}
