# Admin Panel — Super Admin & Command Dashboard

## Overview

The admin panel provides a **centralized healthcare command dashboard** for cross-facility visibility. It extends the existing SCM Solution without replacing facility-level workflows.

## Roles

| Role | Access |
|------|--------|
| `SUPER_ADMIN` | Full access to all facilities and admin APIs (national / system level) |
| `PROVINCIAL_MANAGER` | Same cross-facility admin dashboard (existing provincial scope) |
| Other roles | Facility-scoped modules only; `/admin` redirects to `/dashboard` |

### Demo accounts (after `npm run db:seed` in `backend/`)

| Email | Password | Role |
|-------|----------|------|
| `superadmin@scm.local` | `password123` | Super Admin |
| `manager@scm.local` | `password123` | Provincial Manager |

## Database changes

Migration: `20260527120000_super_admin_admin_panel`

- `UserRole.SUPER_ADMIN`
- `Facility.facilityType` (`HOSPITAL`, `CLINIC`, `PHARMACY`, `WAREHOUSE`, `REGIONAL_STORE`, `AMS_CENTRAL`)
- `Alert.resolvedAt` for alert center resolution

Apply:

```bash
cd backend
npx prisma migrate deploy
npx prisma generate
npm run db:seed
```

## API endpoints

### Dashboard (existing path, enhanced payload)

`GET /api/dashboard/admin?facilityId=<optional>`

**Auth:** `PROVINCIAL_MANAGER` or `SUPER_ADMIN`

**Response highlights:**

- `summary` — top KPI cards (facilities, medicines, patients, workers, stock, alerts, transfers, returns, dispensing today)
- `facilityStats` — per-facility comparison (stock, patients, dispensing, expiry)
- `trends` — stock movement (daily/weekly/monthly), dispensing, transfers, expiry
- `expiryHeatmap`, `consumptionTrends`, `nonReportingFacilities`

### Admin module

`GET /api/admin/dashboard?facilityId=<optional>` — same payload as above

`GET /api/admin/alerts?facilityId=&severity=&unresolved=true&type=`

`PATCH /api/admin/alerts/:id/resolve` — mark alert resolved

### Medicine analytics (unchanged)

`GET /api/medicines/:id/detail` — location-wise stock and inbound/outbound analytics; omit `facilityId` for cross-facility view.

## Frontend

- **Route:** `/admin` — command dashboard
- **Location filter:** defaults to **All Locations**; filters API via `facilityId` query (does not change JWT)
- **Facility switcher:** optional operational context for facility-scoped pages
- **Alert center:** resolve, filter by severity; respects location filter

See also [COMMAND_CENTER.md](./COMMAND_CENTER.md) for map view, global search, SCM Assistant, shipments, and transfer recommendations.

## Facility types (seed)

Demo facilities are labeled as Hospital, Clinic, Pharmacy, Regional Warehouse, and AMS Central Store for realistic multi-location filtering in the UI.
