# Command Center Extensions

Extends the existing admin panel, UI, vendor orders, and logistics without replacing core modules.

## Features

### 1. Global facility map (`/admin`)
- `GET /api/admin/map` — facilities with lat/lng and health status (`healthy` | `warning` | `critical`)
- Click marker → facility detail at `/admin/facilities/:id`

### 2. Cross-facility transfer recommendations
- `GET /api/admin/transfer-recommendations?facilityId=`
- Compares surplus vs deficit per medicine across facilities
- Shown on admin dashboard

### 3. Global search
- `GET /api/search?q=` — patients, medicines, staff, facilities, prescriptions, transfers, returns
- Header search bar (Ctrl+K) on all authenticated pages

### 4. SCM Assistant (chat)
- Floating **Chat with Us** button (bottom-right)
- `POST /api/chat` — rule-based intent detection + formatted response layer
- Quick actions: Low Stock, Expiry, Patients, Reports, Transfers

### 5. Shipment tracking
- Models: `Shipment`, `ShipmentEvent`, `ShipmentStatus` lifecycle
- Auto-created for new vendor orders and transfers
- `GET /api/shipments`, `GET /api/shipments/:id`, `PATCH /api/shipments/:id/status`
- UI: `/shipments`, `/shipments/:id` with visual timeline

### 6. UI refresh
- Healthcare palette (white, blue, soft gray)
- Shared classes: `.page-container`, `.health-card`, `.health-table`, `.status-badge`
- Wider layout (`max-w-7xl`), refined header and cards

### 7. Vendor orders
- Submit button label: **Submit** (was “Submit Order to Vendor”)

## Schema migration

`backend/prisma/migrations/20260527140000_command_center_shipments/`

```bash
cd backend
npx prisma db push
npx prisma generate
npm run db:seed
```

## New fields

- `Facility.latitude`, `Facility.longitude`
- `Shipment`, `ShipmentEvent`, enums `ShipmentStatus`, `ShipmentType`
