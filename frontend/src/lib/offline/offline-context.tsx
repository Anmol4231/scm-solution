"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getPendingCount, processSyncQueue } from "./sync-engine";

interface OfflineContextValue {
  isOnline: boolean;
  pendingCount: number;
  refreshPending: () => Promise<void>;
  syncNow: () => Promise<{ synced: number; failed: number }>;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  pendingCount: 0,
  refreshPending: async () => {},
  syncNow: async () => ({ synced: 0, failed: 0 }),
});

export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);

  const refreshPending = useCallback(async () => {
    const n = await getPendingCount();
    setPendingCount(n);
  }, []);

  const syncNow = useCallback(async () => {
    const result = await processSyncQueue();
    await refreshPending();
    return result;
  }, [refreshPending]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);
    refreshPending();

    const onOnline = () => {
      setIsOnline(true);
      processSyncQueue().then(() => refreshPending());
    };
    const onOffline = () => setIsOnline(false);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    const interval = setInterval(refreshPending, 15000);
    const onQueueUpdate = () => refreshPending();
    window.addEventListener("scm-sync-queue-updated", onQueueUpdate);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("scm-sync-queue-updated", onQueueUpdate);
      clearInterval(interval);
    };
  }, [refreshPending]);

  return (
    <OfflineContext.Provider value={{ isOnline, pendingCount, refreshPending, syncNow }}>
      {children}
    </OfflineContext.Provider>
  );
}

export function useOffline() {
  return useContext(OfflineContext);
}
