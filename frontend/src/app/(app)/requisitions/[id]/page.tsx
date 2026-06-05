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

interface RequisitionLine {
  id: string;
  medicineId: string;
  medicine: { medicineName: string; genericName?: string; unitType: string };
  quantityRequested: number;
  quantityApproved: number | null;
  quantityIssued: number | null;
  quantityReceived: number | null;
  shortfallFlag: boolean;
  approvalNotes: string | null;
}

interface Requisition {
  id: string;
  requisitionCode: string;
  status: string;
  priority: string;
  notes: string | null;
  createdAt: string;
  approvedAt: string | null;
  cancellationReason: string | null;
  requestingFacility: { id: string; name: string; code: string };
  issuingFacility: { id: string; name: string; code: string };
  requestedBy: { firstName: string; lastName: string };
  approvedBy: { firstName: string; lastName: string } | null;
  lines: RequisitionLine[];
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

export default function RequisitionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = isCrossFacilityRole(user?.role);

  const [req, setReq] = useState<Requisition | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cancelReason, setCancelReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);

  // Per-line approval state (lineId → { qty, notes })
  const [approvals, setApprovals] = useState<Record<string, { quantityApproved: number; approvalNotes: string }>>({});

  const load = () => api<Requisition>(`/requisitions/${id}`).then((r) => {
    setReq(r);
    const initial: typeof approvals = {};
    for (const l of r.lines) {
      initial[l.id] = {
        quantityApproved: l.quantityApproved ?? l.quantityRequested,
        approvalNotes: l.approvalNotes ?? "",
      };
    }
    setApprovals(initial);
  });

  useEffect(() => { load(); }, [id]);

  if (!req) return <p className="text-sm text-slate-500 p-4">Loading…</p>;

  const isIssuingUser = isAdmin || user?.facilityId === req.issuingFacility.id;
  const isRequestingUser = isAdmin || user?.facilityId === req.requestingFacility.id;

  const action = async (path: string, body: object) => {
    setBusy(true); setError("");
    try {
      await api(`/requisitions/${id}/${path}`, { method: "POST", body: JSON.stringify(body) });
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = () => {
    const lines = Object.entries(approvals).map(([lineId, v]) => ({ lineId, ...v }));
    action("approve", { lines });
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <Link href="/requisitions" className="text-sm text-medflow-600 hover:underline">← Requisitions</Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold font-mono">{req.requisitionCode}</h1>
          <p className="text-sm text-slate-500">{new Date(req.createdAt).toLocaleString()}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-sm font-medium ${STATUS_COLORS[req.status] ?? ""}`}>
          {req.status.replace(/_/g, " ")}
        </span>
      </div>

      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* Header details */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 pt-4 sm:grid-cols-3">
          <div><p className="text-xs text-slate-500">Requesting Facility</p><p className="font-medium">{req.requestingFacility.name}</p></div>
          <div><p className="text-xs text-slate-500">Issuing Store</p><p className="font-medium">{req.issuingFacility.name}</p></div>
          <div><p className="text-xs text-slate-500">Priority</p><p className="font-medium">{req.priority}</p></div>
          <div><p className="text-xs text-slate-500">Requested By</p><p className="font-medium">{req.requestedBy.firstName} {req.requestedBy.lastName}</p></div>
          {req.approvedBy && <div><p className="text-xs text-slate-500">Approved By</p><p className="font-medium">{req.approvedBy.firstName} {req.approvedBy.lastName}</p></div>}
          {req.approvedAt && <div><p className="text-xs text-slate-500">Approved At</p><p className="font-medium">{new Date(req.approvedAt).toLocaleDateString()}</p></div>}
          {req.notes && <div className="col-span-full"><p className="text-xs text-slate-500">Notes</p><p>{req.notes}</p></div>}
          {req.cancellationReason && <div className="col-span-full"><p className="text-xs text-slate-500">Cancellation Reason</p><p className="text-red-600">{req.cancellationReason}</p></div>}
        </CardContent>
      </Card>

      {/* Lines */}
      <Card>
        <CardHeader><CardTitle>Medicine Lines</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-600">Medicine</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Qty Requested</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Qty Approved</th>
                  {req.status === "UNDER_REVIEW" && isIssuingUser && (
                    <th className="px-4 py-3 text-left font-medium text-slate-600">Approval Notes</th>
                  )}
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Qty Issued</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-600">Qty Received</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {req.lines.map((line) => (
                  <tr key={line.id} className={line.shortfallFlag ? "bg-amber-50" : ""}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{line.medicine.medicineName}</p>
                      {line.medicine.genericName && <p className="text-xs text-slate-500">{line.medicine.genericName}</p>}
                    </td>
                    <td className="px-4 py-3 text-right">{line.quantityRequested} {line.medicine.unitType}</td>
                    <td className="px-4 py-3 text-right">
                      {req.status === "UNDER_REVIEW" && isIssuingUser ? (
                        <Input
                          type="number"
                          min={0}
                          className="w-24 text-right"
                          value={approvals[line.id]?.quantityApproved ?? line.quantityRequested}
                          onChange={(e) =>
                            setApprovals((a) => ({ ...a, [line.id]: { ...a[line.id], quantityApproved: +e.target.value } }))
                          }
                        />
                      ) : (
                        <span className={line.shortfallFlag ? "text-amber-700 font-medium" : ""}>
                          {line.quantityApproved ?? "—"}
                        </span>
                      )}
                    </td>
                    {req.status === "UNDER_REVIEW" && isIssuingUser && (
                      <td className="px-4 py-3">
                        <Input
                          placeholder="Notes…"
                          value={approvals[line.id]?.approvalNotes ?? ""}
                          onChange={(e) =>
                            setApprovals((a) => ({ ...a, [line.id]: { ...a[line.id], approvalNotes: e.target.value } }))
                          }
                        />
                      </td>
                    )}
                    <td className="px-4 py-3 text-right">{line.quantityIssued ?? "—"}</td>
                    <td className="px-4 py-3 text-right">{line.quantityReceived ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {req.status === "DRAFT" && isRequestingUser && (
          <Button onClick={() => action("submit", {})} disabled={busy}>Submit Requisition</Button>
        )}
        {req.status === "SUBMITTED" && isIssuingUser && (
          <Button onClick={() => action("review", {})} disabled={busy} variant="outline">Mark Under Review</Button>
        )}
        {req.status === "UNDER_REVIEW" && isIssuingUser && (
          <Button onClick={handleApprove} disabled={busy}>Approve</Button>
        )}
        {req.status === "APPROVED" && isIssuingUser && (
          <Button onClick={async () => {
            setBusy(true); setError("");
            try {
              const v = await api<{ id: string }>(`/issue-vouchers/from-requisition/${id}`, { method: "POST", body: JSON.stringify({}) });
              window.location.href = `/issue-vouchers/${v.id}`;
            } catch (e: any) { setError(e?.message ?? "Failed to create voucher"); setBusy(false); }
          }} disabled={busy}>Create Issue Voucher</Button>
        )}
        {["DRAFT", "SUBMITTED"].includes(req.status) && (isRequestingUser || isIssuingUser) && (
          <>
            {showCancel ? (
              <div className="flex gap-2 items-center">
                <Input placeholder="Cancellation reason…" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-64" />
                <Button variant="outline" className="text-red-600" disabled={!cancelReason || busy} onClick={() => action("cancel", { reason: cancelReason })}>
                  Confirm Cancel
                </Button>
                <Button variant="outline" onClick={() => setShowCancel(false)}>Back</Button>
              </div>
            ) : (
              <Button variant="outline" className="text-red-600" onClick={() => setShowCancel(true)}>Cancel Requisition</Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
