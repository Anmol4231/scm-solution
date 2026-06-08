"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReceiveTransferPage() {
  const [form, setForm] = useState({ transferCode: "", quantityReceived: 0 });
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setResult("");
    try {
      const res = await api<{ transfer: { transferCode: string } }>("/transfers/receive", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setResult(`Transfer ${res.transfer.transferCode} received successfully`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm receipt");
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/transfers" className="text-sm text-medflow-600 hover:underline">
        ← Transfers
      </Link>
      <h1 className="mb-4 mt-2 text-2xl font-bold">Receive Transfer</h1>
      <Card>
        <CardHeader><CardTitle>Enter Transfer Code</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div><Label>Transfer code</Label><Input value={form.transferCode} onChange={(e) => setForm({ ...form, transferCode: e.target.value.toUpperCase() })} placeholder="Transfer code" required /></div>
            <div><Label>Quantity received</Label><Input type="number" min={1} value={form.quantityReceived || ""} onChange={(e) => setForm({ ...form, quantityReceived: +e.target.value })} required /></div>
            <Button type="submit" size="lg" className="w-full">Confirm Receipt</Button>
          </form>
          {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
          {result && <p className="mt-4 text-green-600">{result}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
