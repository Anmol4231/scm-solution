import { getToken, resolveApiUrl } from "@/lib/api";
import { offlineDb, type SyncQueueRecord } from "./db";

export type { SyncQueueRecord };

const SERVER_ONLY_PREFIXES = ["/chat", "/admin/map", "/auth/switch-facility"];

export function isServerOnlyPath(path: string, method: string): boolean {
  if (method !== "GET") return false;
  return SERVER_ONLY_PREFIXES.some((p) => path.startsWith(p));
}

export function entityTypeFromPath(path: string, method: string): string {
  const base = path.split("?")[0];
  if (base.includes("/patients")) return "patient";
  if (base.includes("/healthcare-workers")) return "staff";
  if (base.includes("/dispensing")) return "dispensing";
  if (base.includes("/stock/receipt")) return "stock_receipt";
  if (base.includes("/transfers")) return "transfer";
  if (base.includes("/returns")) return "return";
  if (base.includes("/prescriptions")) return "prescription";
  return "action";
}

export function labelFromPath(path: string, method: string): string {
  const t = entityTypeFromPath(path, method);
  return `${method} ${t}`.replace(/_/g, " ");
}

export async function cacheResponse(key: string, data: unknown) {
  if (!offlineDb) return;
  await offlineDb.cache.put({
    key,
    data: JSON.stringify(data),
    updatedAt: new Date().toISOString(),
  });
}

export async function getCached<T>(key: string): Promise<T | null> {
  if (!offlineDb) return null;
  const row = await offlineDb.cache.get(key);
  if (!row) return null;
  try {
    return JSON.parse(row.data) as T;
  } catch {
    return null;
  }
}

/** Clear all offline state (cached reads + queued writes) — called on logout so the next user starts clean. */
export async function clearOfflineState() {
  if (!offlineDb) return;
  await Promise.all([offlineDb.cache.clear(), offlineDb.syncQueue.clear()]);
}

export async function enqueueSync(item: Omit<SyncQueueRecord, "id" | "status" | "retries" | "createdAt">) {
  if (!offlineDb) throw new Error("Offline database unavailable");
  await offlineDb.syncQueue.add({
    ...item,
    status: "pending",
    retries: 0,
    createdAt: new Date().toISOString(),
  });
}

export async function getPendingCount(): Promise<number> {
  if (!offlineDb) return 0;
  return offlineDb.syncQueue.where("status").anyOf(["pending", "failed"]).count();
}

export async function listQueue() {
  if (!offlineDb) return [];
  return offlineDb.syncQueue.orderBy("createdAt").reverse().toArray();
}

export async function retryQueueItem(id: number) {
  if (!offlineDb) return;
  await offlineDb.syncQueue.update(id, { status: "pending", error: undefined });
}

export async function processSyncQueue(): Promise<{ synced: number; failed: number }> {
  if (!offlineDb || !navigator.onLine) return { synced: 0, failed: 0 };
  const token = getToken();
  if (!token) return { synced: 0, failed: 0 };

  const items = await offlineDb.syncQueue.where("status").anyOf(["pending", "failed"]).toArray();
  let synced = 0;
  let failed = 0;

  for (const item of items) {
    try {
      const res = await fetch(`${resolveApiUrl()}${item.path}`, {
        method: item.method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: item.body || undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }
      await offlineDb.syncQueue.update(item.id!, { status: "synced", error: undefined });
      synced++;
      await cacheResponse(`sync:${item.path}:${item.method}`, data);
    } catch (e) {
      failed++;
      await offlineDb.syncQueue.update(item.id!, {
        status: "failed",
        error: e instanceof Error ? e.message : "Sync failed",
        retries: (item.retries ?? 0) + 1,
      });
    }
  }

  return { synced, failed };
}

export function offlineBlockedMessage(path: string): string {
  if (path.startsWith("/chat")) return "MediTrack Assistant requires an internet connection.";
  if (path.startsWith("/admin/map")) return "Facility map is available online only.";
  return "This action requires an internet connection.";
}
