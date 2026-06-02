"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOffline } from "@/lib/offline/offline-context";
import { listQueue, retryQueueItem, type SyncQueueRecord } from "@/lib/offline/sync-engine";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";

export default function SyncPage() {
  const { isOnline, pendingCount, syncNow } = useOffline();
  const [items, setItems] = useState<SyncQueueRecord[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const rows = await listQueue();
    setItems(rows.filter((r) => r.status !== "synced"));
  }, []);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("scm-sync-queue-updated", handler);
    return () => window.removeEventListener("scm-sync-queue-updated", handler);
  }, [load]);

  async function handleSync() {
    setSyncing(true);
    setLastResult(null);
    try {
      const result = await syncNow();
      setLastResult(`Synced ${result.synced} item(s). ${result.failed} failed.`);
      await load();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pending Sync</h1>
          <p className="text-sm text-muted-foreground">
            Actions saved while offline are queued here and sent to the server when online.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
              isOnline ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"
            }`}
          >
            {isOnline ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {isOnline ? "🟢 Online" : "🔴 Offline Mode"}
          </span>
          <Button onClick={handleSync} disabled={!isOnline || syncing || pendingCount === 0}>
            <RefreshCw className={`mr-2 h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Sync now
          </Button>
        </div>
      </div>

      {lastResult && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{lastResult}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue ({pendingCount})</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No pending actions</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-2">Action</th>
                  <th className="p-2">Type</th>
                  <th className="p-2">Status</th>
                  <th className="p-2">When</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="p-2 font-medium">{item.label}</td>
                    <td className="p-2 text-muted-foreground">{item.method} {item.path}</td>
                    <td className="p-2">
                      <span
                        className={
                          item.status === "failed"
                            ? "text-red-600"
                            : item.status === "synced"
                              ? "text-emerald-600"
                              : "text-amber-600"
                        }
                      >
                        {item.status}
                      </span>
                      {item.error && <p className="text-xs text-red-500">{item.error}</p>}
                    </td>
                    <td className="p-2 text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="p-2">
                      {item.status === "failed" && item.id != null && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            await retryQueueItem(item.id!);
                            await load();
                          }}
                        >
                          Retry
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
