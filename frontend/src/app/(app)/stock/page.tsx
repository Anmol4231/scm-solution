"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadAuthenticatedFile } from "@/lib/download";
import { Download } from "lucide-react";

const actions = [
  { href: "/stock/orders", label: "Order", desc: "Order medicines for replenishment" },
  { href: "/stock/receipt", label: "Stock Receipt", desc: "Receive batches into stock" },
  { href: "/stock/consumption", label: "Monthly Usage Report", desc: "AMS monthly usage summary (not dispensing)" },
  { href: "/stock/adjustment", label: "Physical Adjustment", desc: "Count corrections" },
  { href: "/stock/transactions", label: "Transaction History", desc: "All stock movements" },
  { href: "/medicines", label: "Medicines", desc: "Intelligence hub per medicine" },
  { href: "/expiry", label: "Expiry Management", desc: "Alerts, filters & redistribution" },
  { href: "/transfers/send", label: "Send Transfer", desc: "Inter-facility redistribution" },
  { href: "/returns", label: "Returns", desc: "Patient & facility returns" },
];

export default function StockPage() {
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const exportExcel = async () => {
    setExporting(true);
    setExportError("");
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadAuthenticatedFile("/stock/export", `scm-stock-${date}.csv`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stock Operations</h1>
          <p className="text-sm text-muted-foreground">
            Stock metrics are available in the Dashboard, Medicines, and Expiry modules.
          </p>
        </div>
        <Button onClick={exportExcel} disabled={exporting} className="gap-2">
          <Download className="h-4 w-4" />
          {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
      </div>

      {exportError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{exportError}</p>}

      <p className="text-xs text-muted-foreground">
        Excel export downloads a CSV file (opens in Microsoft Excel) with all batches, quantities, expiry, and 30-day inbound/outbound supply.
      </p>

      <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 text-sm">
        <p className="font-medium text-medflow-800">Dispense vs usage reporting</p>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>
            <strong className="text-slate-700">Dispense Medicine</strong> (sidebar) — issue stock to a <strong>patient</strong> with a mandatory active prescription.
          </li>
          <li>
            <strong className="text-slate-700">Monthly Usage Report</strong> (below) — submit total units used for AMS/provincial reporting; does not dispense or change stock.
          </li>
        </ul>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => (
          <Link key={a.href} href={a.href}>
            <Card className="h-full transition hover:border-medflow-300 hover:shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{a.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{a.desc}</p>
                <span className="mt-2 inline-block text-sm text-medflow-600">Open →</span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
