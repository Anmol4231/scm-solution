# MedFlow — Release Notes

**Release:** Role Master, Facility Master & Workflow Overhaul
**Branch:** `feature/role-facility-master-and-workflow-overhaul`
**Status:** Code complete; backend + frontend typecheck clean; DB synced & seeded; awaiting UAT sign-off.
**Reference:** see `docs/IMPLEMENTATION_REPORT.md` (technical detail) and `docs/UAT_CHECKLIST.md` (sign-off tests).

---

## 1. Features Added

- **Role Master (`/masters/roles`)** — managed roles with Name, Code, Description, Active/Inactive status, Single/Cross-facility scope, and a per-module **permission matrix** (16 modules × View/Create/Edit/Delete/Approve). Custom roles supported; two protected system roles (Administrator, Pharmacist) seeded.
- **Facility Master (`/masters/facilities`)** — full CRUD for facilities (Name, Code, Type, Province/State, District, Address, Contact number, Status). Users are assigned to facilities from here.
- **Unified Dispensing workflow (`/dispense`)** — single stepper screen: search/register patient → select/create prescription (optional scan upload) → auto-loaded medicine lines → FEFO batch auto-selected → confirm → atomic multi-line dispense.
- **Shared validation framework** — one rule set enforced on both frontend and backend (names, email, phone, integers, age, codes, password expiry).
- **Staff and Prescription detail pages** — `/healthcare-workers/[id]` and `/prescriptions/[id]` so global-search results resolve.
- **Password policy controls** — per-user Force-Password-Change toggle and expiry presets (Never / 30 / 60 / 90 / 180 / Custom), enforced server-side at login.

## 2. Features Modified

- **Users & Access** — Edit now works; role is chosen from Role Master; full validation (non-numeric names, email, phone); password-policy fields added.
- **Medicine Master** — search now **filters the list** across Name, Generic, Category, Dosage Form, and Strength (previously autocomplete-jump only); placeholder text replaced.
- **Transfers** — Redistribution merged into the single Transfers workflow; cross-facility admins select the sending facility within Send Transfer.
- **Audit Trail** — location/facility hidden for Medicine, Stock Category, and Role records; before/after change values shown.
- **Authentication** — JWT and `/auth/login` + `/auth/me` now carry `roleId` and the effective permission matrix.
- **Stock Categories** (formerly "Categories") — renamed; recovery/restore retained.
- **Navigation** — Masters menu reordered (Role Master · Facility Master · Users & Access · Stock Categories · Medicines); min font raised to 10px.

## 3. Features Removed

- **Sort Order** on Stock Categories (field removed from UI, schema, and seed).
- **Redistribution** as a separate user-facing feature/menu item (folded into Transfers; `/admin/transfers` now redirects).
- **Duplicate recovery backend** in `routes/admin.ts` (live recovery remains in `medicines.ts` / `categories.ts`).
- **Duplicate user-management page** at `/settings/users` (now redirects to `/users`).
- **Stock hub duplicates** — Medicines / Expiry / Transfers / Returns cards removed from the Stock page (they live in the sidebar).
- **Forgot-password token in API response** — reset link is no longer returned to the caller (security fix).

## 4. Database Changes

Applied with `prisma db push` (no migration history in repo; init migration dir is empty).

- **New table `Role`**: `id, name (unique), code (unique), description, isActive, isSystem, scopeAllFacilities, permissions (Json), createdAt, updatedAt`.
- **`User`**: added `roleId` (FK → Role), `passwordChangedAt`, `passwordExpiryDays`.
- **`Facility`**: added `address`.
- **`MedicineCategory`**: dropped `sortOrder` (data loss limited to ordering integers; accepted via `--accept-data-loss`).
- **Unchanged:** `UserRole` enum and `User.role` (retained as the system tier driving cross-facility scope and existing guards).
- **Seed/backfill:** creates system roles Administrator (ADMIN) and Pharmacist (PHARMACIST); assigns every user a `roleId`; sets `passwordChangedAt = now`, `passwordExpiryDays = null` (Never).

## 5. Breaking Changes

- **User create/edit API contract changed:** `POST/PATCH /api/users` now expect **`roleId`** (Role Master) instead of the `role` enum, plus optional `mustChangePassword` and `passwordExpiryDays`. Any external caller of these endpoints must be updated.
- **`MedicineCategory.sortOrder` removed:** any client/report referencing it will break; category ordering is now alphabetical by name.
- **`/auth/forgot-password` response shape changed:** no longer returns `resetToken` / `resetUrl` / `simulatedEmail`. Reset delivery must be out-of-band (email); until configured, the link is logged to the server console in non-production only.
- **Routes consolidated:** `/admin/transfers` → `/transfers/send`; `/settings/users` → `/users`. Bookmarks/links should be updated (redirects are in place).
- **Prisma client regen required:** consumers must run `prisma generate` after pulling (new `Role` model and `User`/`Facility` fields).

## 6. Known Limitations

- **RBAC enforcement is ON by default** (`RBAC_ENFORCE=true`): the permission matrix is authoritative on the Role/Facility/User routes (which also retain enum guards). The enum tier now reflects **data scope only** (cross-facility = admin scope; otherwise facility-scoped) — module privileges come from the matrix, so operational roles cannot inherit admin access. Set `RBAC_ENFORCE=false` to fall back to enum-only guards. Note: the **frontend sidebar still gates on enum tier**, so a cross-facility role with a restricted matrix may see admin menu items but receive 403 from the API (secure, but a UX mismatch to address later).
- **Role names disallow digits** (use the person-name rule) — e.g. "Tier 2 Clerk" is rejected. Loosen `roleSchema.name` if numeric role names are required.
- **Existing facilities have no `address`** until edited (new optional field).
- **Enum-tier derivation** for custom roles is heuristic; cross-facility scope is set only via the explicit scope toggle.
- **No real email provider** is wired for password reset; relies on server-console logging in non-production.
- **Legacy backends** (`chat`, `whatsapp`, `shipments`, `vendor-orders`) remain mounted with no UI — out of scope for this release.
- **Unused exports** `ROLE_OPTIONS` / `roleSpansAllLocations` remain in `lib/roles.ts` (harmless; removable later).

## 7. Rollback Considerations

- **Feature branch:** revert by merging/deploying `main`; this branch is isolated.
- **Schema is additive except `sortOrder`:** rolling back code leaves the new nullable columns/table harmless. Restoring `sortOrder` requires re-adding the column via schema push (ordering data is not recoverable).
- **RBAC kill-switch:** set `RBAC_ENFORCE=false` to disable matrix checks without a redeploy; enum guards continue to protect routes.
- **DB snapshot:** take a database snapshot immediately before `db push` + backfill so the pre-release state can be restored.
- **Tokens:** existing JWTs lacking `roleId` fall back to enum-derived permissions; no forced logout on deploy.

## 8. Production Deployment Steps

1. **Back up the database** (snapshot/dump).
2. Deploy the branch code to the target environment.
3. **Stop the API process** (on Windows dev, stop `tsx watch` to release the Prisma engine lock).
4. `cd backend && npx prisma generate`.
5. `npx prisma db push` (use `--accept-data-loss` to drop `sortOrder`).
6. Run the **non-destructive backfill**: `npm run db:backfill` (`prisma/backfill.ts`) — upserts system roles and sets `roleId` + `passwordChangedAt` on existing users without deleting anything. **Do NOT run `db:seed` in production** — it wipes transactional data and is now blocked when `NODE_ENV=production`.
7. Set environment variables: `JWT_SECRET` (non-default), `APP_BASE_URL` (reset links), `CORS_ORIGIN`. **`RBAC_ENFORCE` defaults to on**; the permission matrix is authoritative on Role/Facility/User routes. Set `RBAC_ENFORCE=false` only to fall back to enum-only guards.
8. Configure an **email provider** before enabling self-service password reset.
9. Start the API; verify `/health`, then smoke-test `POST /auth/login` (returns `roleId` + `permissions`), `GET /roles`, `GET /facilities`.
10. Deploy/start the frontend; run `docs/UAT_CHECKLIST.md`. Sign off when all Critical pass.
11. With `RBAC_ENFORCE` on (default), verify in staging that each role's matrix grants the intended access on Role/Facility/User routes before going live.
