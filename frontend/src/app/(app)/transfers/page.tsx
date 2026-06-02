"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Transfer {
  id: string;
  transferCode: string;
  status: string;
  quantity: number;
  quantityReceived?: number | null;
  batchNumber: string;
  createdAt: string;
  fromFacilityId: string;
  toFacilityId: string;
  fromFacility: { name: string; code: string };
  toFacility: { name: string; code: string };
  medicine: { medicineName: string };
}

export default function TransfersPage() {
  const { user } = useAuth();
  const [transfers, setTransfers] = useState<Transfer[]>([]);

  useEffect(() => {
    const q = user?.facilityId ? `?facilityId=${user.facilityId}` : "";
    api<Transfer[]>(`/transfers${q}`).then(setTransfers).catch(console.error);
  }, [user?.facilityId]);

  const pendingIncoming = transfers.filter(
    (t) => user?.facilityId && t.toFacilityId === user.facilityId && t.status !== "RECEIVED"
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Inter-Facility Transfers</h1>
      <p className="text-sm text-muted-foreground">
        Move medicine between health facilities. Receiving facility confirms with the transfer code.
      </p>

      {pendingIncoming.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4">
            <p className="font-semibold text-amber-800">
              {pendingIncoming.length} incoming transfer{pendingIncoming.length > 1 ? "s" : ""} awaiting receipt
            </p>
            <Link href="/transfers/receive">
              <Button className="mt-2" size="sm">
                Receive now
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Link href="/transfers/send">
          <Button size="lg" className="h-20 w-full">
            Send to Facility
          </Button>
        </Link>
        <Link href="/transfers/receive">
          <Button size="lg" variant="secondary" className="h-20 w-full">
            Receive Transfer
          </Button>
        </Link>
      </div>

      {(user?.role === "PROVINCIAL_MANAGER" || user?.role === "SUPER_ADMIN") && (
        <Link href="/admin/transfers">
          <Button variant="outline" className="w-full">
            Provincial redistribution recommendations
          </Button>
        </Link>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Recent Transfers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {transfers.length === 0 && (
            <p className="text-sm text-muted-foreground">No transfers yet</p>
          )}
          {transfers.map((t) => (
            <div key={t.id} className="rounded-lg border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono font-semibold">{t.transferCode}</span>
                <span
                  className={
                    t.status === "RECEIVED"
                      ? "text-green-600"
                      : t.status === "PENDING"
                        ? "text-amber-600"
                        : ""
                  }
                >
                  {t.status}
                </span>
              </div>
              <p className="mt-1 font-medium">{t.medicine.medicineName}</p>
              <p className="text-muted-foreground">
                {t.fromFacility.name} → {t.toFacility.name}
              </p>
              <p>
                Batch {t.batchNumber} · Sent {t.quantity}
                {t.quantityReceived != null && ` · Received ${t.quantityReceived}`}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(t.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
