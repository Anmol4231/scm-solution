# SCM Solution

A lightweight hospital supply chain management (SCM) platform for medicine inventory, dispensing, expiry, prescriptions, and inter-facility redistribution — built for low-resource healthcare facilities.

**Not an ERP** — focused only on stock, batches, expiry, prescriptions, dispensing, returns, redistribution, alerts, and WhatsApp-ready notifications.

## Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, shadcn-style UI, Recharts |
| Backend | Node.js, Express.js, Prisma ORM |
| Database | PostgreSQL |
| Auth | JWT + role-based access |
| WhatsApp | Meta Cloud API (modular placeholders) |
| Deploy | Docker Compose |

## User Roles

**Facility users:** Pharmacist, Storekeeper, Nurse/Admin  
**Provincial:** Admin/Provincial Manager

## Quick Start (Local)

### Prerequisites

- Node.js 20+
- PostgreSQL 16+ (or use Docker for DB only)

### 1. Clone & environment

```bash
cd medflow
cp .env.example .env
```

Edit `.env` if needed. Default `DATABASE_URL`:

```
postgresql://medflow:medflow_secret@localhost:5432/medflow?schema=public
```

### 2. Start database (Docker)

```bash
docker compose up postgres -d
```

### 3. Backend

```bash
cd backend
npm install
npx prisma generate
npx prisma db push
npm run db:seed    # loads full presentation demo data
npm run dev
```

If port 4000 is in use, stop the other process or set `PORT=4001` in `backend/.env`.

API: http://localhost:4000  
Health: http://localhost:4000/health

### 4. Frontend

```bash
cd frontend
npm install
# .env.local should contain: NEXT_PUBLIC_API_URL=http://localhost:4000/api
npm run dev
```

App: http://localhost:3000 (Next.js may use 3001/3002 if busy — CORS allows all localhost ports in dev)

## Docker (Full Stack)

```bash
cp .env.example .env
# Set JWT_SECRET in .env for production
docker compose up --build
```

- Frontend: http://localhost:3000  
- API: http://localhost:4000/api  
- PostgreSQL: localhost:5432

## Demo Accounts (Presentation)

Password for all: `password123`

Reload demo data anytime: `cd backend && npm run db:seed`

| Email | Role | Demo highlights |
|-------|------|-----------------|
| manager@scm.local | Provincial Manager | Admin dashboard, facility comparison |
| pharmacist@hc001.local | Pharmacist @ Goroka | 6 alerts, low stock, expiry, dispensing |
| storekeeper@hc001.local | Storekeeper @ Goroka | Stock receipt shortfall |
| nurse@hc001.local | Nurse/Admin @ Goroka | Patients, prescriptions |
| pharmacist@hc002.local | Pharmacist @ Mt Hagen | Stockout, receive **TRF-DEMO01** |
| pharmacist@hc003.local | Pharmacist @ Lae | Non-reporting, near-expiry surplus |
| pharmacist@hc004.local | Pharmacist @ Port Moresby | Capital district stock |
| pharmacist@hc005.local | Pharmacist @ Kagamuga | Near-expiry antimalarials |
| pharmacist@hc006.local | Pharmacist @ Pai | Rural facility stock |

**Facilities:** Goroka, Mt Hagen, Lae, Port Moresby, Kagamuga, Pai

**Transfer demo:** Login as `pharmacist@hc002.local` → Transfers → Receive → enter `TRF-DEMO01`

**Windows quick start:** `.\scripts\start-demo.ps1`

## Core Workflows

1. **Patients** — Register, search, profile with medicine timeline  
2. **Prescriptions** — Upload image/PDF, attach medicines  
3. **Dispensing** — Patient + prescription + batch (FEFO) traceability  
4. **Stock receipt** — Batch, expiry, shortfall detection (>30%)  
5. **Monthly usage report** — AMS period usage (not dispensing)  
6. **Adjustment** — Physical count vs system balance  
7. **Expiry** — 90d warning / 30d critical, expired disposal  
8. **Returns** — Patient returns, Facility→AMS, inter-facility receive  
9. **Transfers** — Manager redistribution with transfer codes  
10. **Alerts & WhatsApp** — Low stock, stockout, expiry, transfers  

## API Overview

Base URL: `/api`

| Module | Endpoints |
|--------|-----------|
| Auth | `POST /auth/login`, `GET /auth/me`, `POST /auth/switch-facility` |
| Patients | `GET/POST /patients`, `GET /patients/:id/history` |
| Prescriptions | `GET/POST /prescriptions` (multipart upload) |
| Medicines | `GET/POST /medicines` |
| Stock | `POST /stock/receipt`, `/consumption`, `/adjustment`, `GET /balance` |
| Dispensing | `POST /dispensing` |
| Expiry | `GET /expiry/alerts`, `POST /expiry/record-expired` |
| Returns | `POST /returns/patient`, `/facility-to-ams` |
| Transfers | `POST /transfers`, `POST /transfers/receive` |
| Alerts | `GET /alerts`, `POST /alerts/run-checks` |
| Dashboard | `GET /dashboard/facility`, `/admin` |
| WhatsApp | `GET/POST /whatsapp/webhook`, `POST /whatsapp/command` |

## WhatsApp Integration

Modular structure under `backend/src/whatsapp/`:

- `client.ts` — Meta Cloud API client (simulates when credentials empty)
- `commands.ts` — `STOCK <name>`, `LOWSTOCK`, `EXPIRY`, `TRANSFER APPROVE`
- `service.ts` — Alert notifications, facility messaging

Configure in `.env`:

```
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=medflow_webhook_verify
```

## Project Structure

```
medflow/
├── backend/
│   ├── prisma/schema.prisma
│   ├── prisma/seed.ts
│   └── src/
│       ├── routes/
│       ├── services/
│       └── whatsapp/
├── frontend/
│   └── src/app/
├── docker-compose.yml
├── .env.example
└── README.md
```

## Traceability

Every stock movement records: user, facility, patient (if applicable), prescription (if applicable), batch, quantity, timestamp — via `stock_transactions`, `dispensing_records`, and `audit_logs`.

## License

MIT — Built for healthcare operations in resource-limited settings.
