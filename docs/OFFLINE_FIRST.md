# Offline-First (PWA)

## Overview

The SCM frontend queues mutations when offline and syncs automatically when connectivity returns. **SCM Assistant chat requires online access.**

## Stack

- **next-pwa** — service worker (`public/sw.js` generated on build)
- **Dexie** — IndexedDB (`scm_offline` database)
- **OfflineProvider** — online/offline state + sync trigger

## IndexedDB stores

| Store | Purpose |
|-------|---------|
| `cache` | Cached GET API responses |
| `syncQueue` | Pending POST/PATCH/DELETE actions |
| `patients`, `staff`, `dispensing`, etc. | Reserved for local entity mirrors |

## User flow

1. User performs action → saved to `syncQueue` when offline  
2. Banner: **🔴 Working offline — changes will sync automatically**  
3. **Pending Sync** (`/sync`) shows queue, failed items, retry  
4. On `online` event → `processSyncQueue()` runs  

## Online indicator

Header badge: **🟢 Online** / **🔴 Offline**

## Server-only (offline blocked)

- `/chat` (SCM Assistant)
- `/admin/map`

## Install PWA

Build production (`npm run build`) then serve over HTTPS or localhost. Use browser **Install app** when offered.

Add PNG icons at:

- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
