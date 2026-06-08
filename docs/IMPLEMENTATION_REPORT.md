# MedFlow — Role Master, Facility Master & Workflow Overhaul

**Branch:** `feature/role-facility-master-and-workflow-overhaul`
**Status:** Code complete; backend + frontend typecheck clean; DB synced & seeded; end-to-end smoke test passed.

---

## 1. New Modules Added

| Module | Backend | Frontend |
|---|---|---|
| **Role Master (RBAC)** | `routes/roles.ts`, `services/permissions.ts`, `middleware/permission.ts`, `utils/permissionMatrix.ts` | `app/(app)/masters/roles/page.tsx`, `lib/permissions.ts` |
| **Facility Master** | `routes/facilities.ts` | `app/(app)/masters/facilities/page.tsx` |
| **Validation framework** | `utils/validators.ts` | `lib/validation.ts` (extended) |
| **Unified Dispensing** | `routes/dispensing.ts` (`/prescription/:id/plan`, `/batch`) | `app/(app)/dispense/page.tsx` (stepper) |
| **Staff detail** | (existing `GET /healthcare-workers/:id`) | `app/(app)/healthcare-workers/[id]/page.tsx` |
| **Prescription detail** | (existing `GET /prescriptions/:id`) | `app/(app)/prescriptions/[id]/page.tsx` |

---

## 2. Database Changes

Applied via `prisma db push` (the repo has no migration history; the init migration dir is empty).

- **New table `Role`**: `id, name (unique), code (unique), description, isActive, isSystem, scopeAllFacilities, permissions (Json), createdAt, updatedAt`.
- **`User`**: added `roleId` (FK → Role), `roleMaster` relation, `passwordChangedAt`, `passwordExpiryDays`.
- **`Facility`**: added `address`.
- **`MedicineCategory`**: removed `sortOrder` (dropped 19 ordering values — intentional, accepted via `--accept-data-loss`).
- **`UserRole` enum + `User.role`**: unchanged (kept as the immutable "system tier").

**Seed/backfill** (`prisma/seed.ts`): seeds two protected system roles — **Administrator** (`ADMIN`, cross-facility, full matrix) and **Pharmacist** (`PHARMACIST`, single-facility, operational matrix); assigns every user a `roleId` by tier and sets `passwordChangedAt = now`, `passwordExpiryDays = null` (Never).

---

## 3. Permission Model

- **Dual-layer (additive):** the legacy `UserRole` enum still drives cross-facility scope, the JWT, and existing `requireRoles` guards. A new **Role Master** record (`roleId`) supplies the managed permission matrix.
- **Matrix:** `Record<ModuleKey, ActionKey[]>` stored as `Role.permissions` JSON. **16 modules** (Dashboard, Users & Access, Facility Master, Role Master, Stock Categories, Medicines, Stock, Expiry, Transfers, Returns, Patients, Prescriptions, Medicine Dispensing, Alert Center, Audit Trail, Recovery) × **5 actions** (View, Create, Edit, Delete, Approve). Non-applicable actions are disabled in the UI and stripped server-side by `sanitizeMatrix`.
- **Enforcement:** `requirePermission(module, action)` middleware, **gated by `RBAC_ENFORCE`** (default `false`). When off it is a pass-through and the enum guards still protect every route → zero behavior change at deploy. When on, it checks the user's effective matrix (loaded from `roleId` with a 45s in-process cache; enum fallback for legacy tokens).
- **Custom roles:** admins can create roles with a **Single-facility / Cross-facility** scope toggle; the enum tier is derived from the role (`deriveEnumTier`). System roles (`isSystem`) cannot be deleted; the Administrator role cannot be deactivated; role codes are immutable after creation.
- **JWT** now carries `roleId`; `/auth/login` and `/auth/me` return the effective `permissions` matrix for the frontend.

---

## 4. Validation Rules (frontend + backend, shared definitions)

`backend/src/utils/validators.ts` (Zod) mirrored by `frontend/src/lib/validation.ts` (predicate + sanitizers):

- **Names** — required, must contain a letter, cannot be only numbers; allows letters/spaces/`-`/`'`/`.`.
- **Email** — RFC-ish format, lowercased.
- **Phone** — optional leading `+`, 7–15 digits; non-digits stripped.
- **Codes** (facility/role) — uppercase A–Z/0–9/`-`, ≥2 chars, immutable after creation.
- **Integers** — digits only (no decimals/negatives/scientific notation); **Age** 0–120.
- **Password expiry** — 0/null = Never, else N days; enforced **server-side at login** (expired → forced change via the existing hard gate).

Applied to: Users & Access, Facility Master, Role Master, Patient registration (in Dispense), and existing medicine/category forms.

---

## 5. Navigation Changes

- **Masters** (new order): Role Master · Facility Master · Users & Access · Stock Categories · Medicines.
- **Inventory:** Redistribution removed; **Transfers** is the single inter-facility movement workflow.
- **Stock hub** (`/stock`) trimmed to stock-only actions (Order, Receipt, Monthly Usage, Adjustment, Transactions) — no longer duplicates Medicines/Expiry/Transfers/Returns.
- **Redirects:** `/admin/transfers` → `/transfers/send`; `/settings/users` → `/users` (duplicate user-management page consolidated).
- Min font raised to 10px (`Soon` badge).

---

## 6. Key Behavior Changes

- **Dispensing** is now one screen: search/register patient → select/create prescription (optional upload) → auto-loaded medicine lines with **FEFO batch auto-selected** → confirm quantities → **atomic multi-line dispense** (`POST /dispensing/batch`, single transaction).
- **Medicine Master search** filters the list across **name, generic, category, dosage form, strength** (was autocomplete-only); placeholder updated.
- **Transfers** — cross-facility admins pick the sending facility directly in Send Transfer (merged redistribution).
- **Audit Trail** — location hidden for `Medicine` / `MedicineCategory` / `Role`; before/after diffs already rendered.
- **Security** — `forgot-password` no longer returns the reset token in the response (dev-only console log); password reset/change set `passwordChangedAt`.

---

## 7. Files Changed

**Backend (new):** `routes/roles.ts`, `routes/facilities.ts`, `services/permissions.ts`, `middleware/permission.ts`, `utils/permissionMatrix.ts`, `utils/validators.ts`.
**Backend (modified):** `prisma/schema.prisma`, `prisma/seed.ts`, `app.ts`, `middleware/auth.ts`, `utils/config.ts`, `routes/auth.ts`, `routes/users.ts`, `routes/dispensing.ts`, `routes/categories.ts`, `routes/medicines.ts`, `routes/admin.ts` (removed duplicate recovery block), `routes/audit.ts`.
**Frontend (new):** `app/(app)/masters/roles/page.tsx`, `app/(app)/masters/facilities/page.tsx`, `app/(app)/healthcare-workers/[id]/page.tsx`, `app/(app)/prescriptions/[id]/page.tsx`, `lib/permissions.ts`.
**Frontend (modified):** `lib/auth-context.tsx`, `lib/validation.ts`, `components/layout/app-shell.tsx`, `components/layout/global-search.tsx`, `app/(app)/users/page.tsx`, `app/(app)/settings/users/page.tsx`, `app/(app)/dispense/page.tsx`, `app/(app)/transfers/page.tsx`, `app/(app)/transfers/send/page.tsx`, `app/(app)/admin/transfers/page.tsx`, `app/(app)/stock/page.tsx`, `app/(app)/medicines/page.tsx`, `app/(app)/medicines/categories/page.tsx`.

---

## 8. Testing Performed

- **Backend `tsc --noEmit`** — clean (after Prisma client regen).
- **Frontend `tsc --noEmit`** — clean.
- **Prisma** — `generate` + `db push --accept-data-loss` succeeded; database in sync.
- **Seed** — system roles created; 3 users on Administrator, 9 on Pharmacist.
- **Boot** — backend starts on :4000 with new routes mounted, no runtime errors.
- **End-to-end smoke** — `POST /auth/login` returns `roleId` + full 16-module permission matrix; `GET /roles` returns both seeded system roles with user counts; `GET /facilities` returns all 6 facilities.

**Not yet exercised manually (recommended before release):** full dispense flow in the browser; create/edit a custom role and assign it to a user; password-expiry forced-change at login; facility deactivation behavior in assignment dropdowns.

---

## 9. Known Limitations

- **RBAC enforcement is off by default** (`RBAC_ENFORCE=false`). Existing routes still rely on enum guards; flipping enforcement on should be done after verifying each role's matrix in staging.
- **Role names** currently disallow digits (uses the person-name rule) — e.g. "Tier 2 Clerk" would be rejected. Loosen `roleSchema.name` if numeric role names are needed.
- **Existing facilities have no `address`** until edited (new optional field).
- **`roleId` derivation** maps custom roles to one of three enum tiers heuristically; deeply custom permission sets still resolve cross-facility scope only via the explicit toggle.
- Legacy `ROLE_OPTIONS` / `roleSpansAllLocations` exports in `lib/roles.ts` are now unused (kept for safety; can be removed later).

---

## 10. Deployment Considerations

- **Migration:** run `prisma generate` then `prisma db push` (no migration files exist). On Windows, stop the `tsx watch` dev server first (Prisma engine DLL lock). Take a DB snapshot before pushing in production.
- **Backfill:** run the seed/backfill (or an equivalent script) so existing users get a `roleId` and `passwordChangedAt`; default `passwordExpiryDays = null` avoids forcing everyone to reset on day one.
- **Env:** set `RBAC_ENFORCE` (default off), `APP_BASE_URL` (for reset links), and a real email provider before enabling self-service password reset in production.
- **Rollback:** schema changes are additive except the `sortOrder` drop; an `RBAC_ENFORCE=false` kill-switch disables permission checks without redeploying.
- **Sprawl:** `chat`, `whatsapp`, `shipments`, `vendor-orders` backends remain mounted but have no UI — gate or remove before production hardening (not done here to avoid scope creep).
