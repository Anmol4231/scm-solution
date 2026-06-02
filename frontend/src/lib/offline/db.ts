import Dexie, { type Table } from "dexie";

export interface CachedRecord {
  key: string;
  data: string;
  updatedAt: string;
}

export interface SyncQueueRecord {
  id?: number;
  method: string;
  path: string;
  body: string;
  entityType: string;
  label: string;
  status: "pending" | "failed" | "synced";
  error?: string;
  retries: number;
  createdAt: string;
}

export interface LocalPatient {
  localId: string;
  serverId?: string;
  payload: string;
  synced: boolean;
  updatedAt: string;
}

class ScmOfflineDB extends Dexie {
  cache!: Table<CachedRecord, string>;
  syncQueue!: Table<SyncQueueRecord, number>;
  patients!: Table<LocalPatient, string>;
  staff!: Table<LocalPatient, string>;
  dispensing!: Table<LocalPatient, string>;
  stockReceipts!: Table<LocalPatient, string>;
  transfers!: Table<LocalPatient, string>;
  returns!: Table<LocalPatient, string>;
  prescriptions!: Table<LocalPatient, string>;
  dashboardSummaries!: Table<CachedRecord, string>;

  constructor() {
    super("scm_offline");
    this.version(1).stores({
      cache: "key",
      syncQueue: "++id, status, createdAt",
      patients: "localId, synced",
      staff: "localId, synced",
      dispensing: "localId, synced",
      stockReceipts: "localId, synced",
      transfers: "localId, synced",
      returns: "localId, synced",
      prescriptions: "localId, synced",
      dashboardSummaries: "key",
    });
  }
}

export const offlineDb =
  typeof window !== "undefined" ? new ScmOfflineDB() : (null as unknown as ScmOfflineDB);
