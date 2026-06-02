"use client";

import { useState } from "react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Trends {
  stockMovement: {
    daily: { date: string; inbound: number; outbound: number }[];
    weekly: { date: string; inbound: number; outbound: number }[];
    monthly: { date: string; inbound: number; outbound: number }[];
  };
  dispensing: { date: string; quantity: number }[];
  transfers: { date: string; created: number; completed: number }[];
  expiry: { period: string; quantity: number }[];
}

type MovementPeriod = "daily" | "weekly" | "monthly";

export function AdminTrendCharts({ trends }: { trends: Trends }) {
  const [movementPeriod, setMovementPeriod] = useState<MovementPeriod>("daily");
  const movementData = trends.stockMovement[movementPeriod];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base">Stock Movement</CardTitle>
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-xs">
            {(["daily", "weekly", "monthly"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setMovementPeriod(p)}
                className={`rounded-md px-2 py-1 capitalize transition ${
                  movementPeriod === p ? "bg-white font-medium text-medflow-700 shadow-sm" : "text-slate-600"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={movementData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="inbound" stroke="#0ea5e9" name="Inbound" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="outbound" stroke="#6366f1" name="Outbound" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">Dispensing Trends</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trends.dispensing}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="quantity" fill="#2563eb" name="Units dispensed" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">Transfer Trends</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trends.transfers}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="created" stroke="#f59e0b" name="Created" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="completed" stroke="#10b981" name="Received" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader><CardTitle className="text-base">Expiry Risk (by month)</CardTitle></CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trends.expiry}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="period" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="quantity" fill="#ef4444" name="Qty at risk" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
