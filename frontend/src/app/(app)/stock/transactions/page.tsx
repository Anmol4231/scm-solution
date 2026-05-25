"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";

export default function TransactionsPage() {
  const [txs, setTxs] = useState<Record<string, unknown>[]>([]);

  useEffect(() => {
    api("/stock/transactions").then(setTxs);
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Stock Transactions</h1>
      {txs.map((tx, i) => {
        const t = tx as { type: string; medicine: { medicineName: string }; quantity: number; createdAt: string; performedBy: { firstName: string; lastName: string } };
        return (
          <Card key={i}>
            <CardContent className="p-4 text-sm">
              <p className="font-semibold">{t.type} — {t.medicine?.medicineName}</p>
              <p>Qty: {t.quantity} · {t.performedBy?.firstName} {t.performedBy?.lastName}</p>
              <p className="text-muted-foreground">{new Date(t.createdAt).toLocaleString()}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
