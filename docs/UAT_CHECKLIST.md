# MedFlow — UAT Checklist (Production Sign-off)

**Branch:** `feature/role-facility-master-and-workflow-overhaul`
**Test accounts (password `password123`):** Admin = `manager@scm.local` · Pharmacist = `pharmacist@hc001.local`
**Sign-off gate:** all **Critical** pass; **High** pass or accepted workaround; **Medium** logged, non-blocking.
**Note:** RBAC enforcement is intentionally off (`RBAC_ENFORCE=false`) — verify the permission matrix saves/loads (R3–R5), not that it blocks routes.

## Authentication & Password Policy
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| A1 | Log in as Admin with correct password | Lands in app; sidebar shows **Masters → Role Master, Facility Master, Users & Access** | Critical |
| A2 | Log in with a wrong password | Generic "Invalid credentials"; no login | Critical |
| A3 | Admin → Users & Access → create a user, set **Force password change = on** | New user gets a one-time temp password shown once | Critical |
| A4 | Log in as that new user | Blocked at a **forced password-change screen**; app not reachable until changed | Critical |
| A5 | Create/edit a user with a very short custom expiry, then log in as them after the window | Login forces a password change (server-side expiry) | High |
| A6 | Trigger **Forgot password** for a known email; inspect the API/network response | Response contains **only** a generic message — **no reset token/URL** in the body | Critical |

## Role Master (RBAC)
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| R1 | Masters → Role Master | Lists **Administrator** and **Pharmacist** as system roles (lock icon, no Delete) with user counts (3 / 9) | Critical |
| R2 | Try to delete a system role / deactivate Administrator | Both blocked with a clear message | Critical |
| R3 | Create a custom role: name, code, **Single-facility**, tick a few matrix cells, Save | Role saved; appears Active in the list | High |
| R4 | Edit that role; confirm **Code field is read-only** | Code cannot be changed after creation | High |
| R5 | In the matrix, check a non-applicable cell (e.g. Delete on Dashboard) | Rendered as a disabled "—", not a checkbox | Medium |
| R6 | Delete the custom role while 0 users assigned | Succeeds; (with users assigned, delete is blocked) | High |

## Facility Master
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| F1 | Masters → Facility Master | All 6 facilities list with code, province, district, status | High |
| F2 | Create a facility (name, code, type, province, district, address, phone) | Saved and listed; phone rejects non-numeric input | High |
| F3 | Edit it — confirm **Code is read-only**; deactivate it | Saves; status shows Inactive | High |
| F4 | Users & Access → create user → open the location dropdown | Inactive facility is **not** offered for assignment | Medium |

## Users & Access
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| U1 | Create user: Role dropdown sourced from **Role Master**; pick a single-facility role | Location field becomes **required** | Critical |
| U2 | Pick a **cross-facility** role | Location field disabled / "All locations" | High |
| U3 | **Edit** an existing user (name, role, expiry), Save | Changes persist on reload (edit now works) | Critical |
| U4 | **Reset password** on a user row | Temp password shown; that user is forced to change at next login | High |
| U5 | Try to deactivate **your own** account | Blocked | Medium |

## Validation (frontend + backend)
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| V1 | Any name field: enter digits only ("123") | Rejected — "cannot be only numbers" | High |
| V2 | Email field: "notanemail" | Rejected — invalid email | High |
| V3 | Phone field: letters / 3 digits | Rejected — 7–15 digits | High |
| V4 | Patient age (Dispense register): 0, negative, 999 | Only 0–120 whole numbers accepted | High |

## Dispensing (single workflow) — data integrity
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| D1 | Pharmacist → Dispense → search an existing patient → select | Advances to Prescription step; patient chip shown | Critical |
| D2 | "Register" a new patient inline | Saves and auto-advances without leaving the page | High |
| D3 | Choose an **existing active prescription** → Continue | Medicine lines **auto-load**; a **FEFO batch is pre-selected** (soonest expiry) per line | Critical |
| D4 | A line with no stock | Line shown **out of stock / disabled**, cannot be dispensed | Critical |
| D5 | Confirm & Dispense a multi-line prescription | Success; **all lines decrement stock atomically**; re-check batch quantities dropped by the dispensed amounts | Critical |
| D6 | Enter a quantity above the batch on-hand | Blocked with "Only N in batch" — nothing dispensed | Critical |
| D7 | "Create new" prescription (add meds, optional file upload) → dispense | Rx created, lines load, dispense completes | High |

## Transfers (merged)
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| T1 | Sidebar Inventory | **No "Redistribution"** entry; only Transfers | High |
| T2 | Visit `/admin/transfers` directly | Redirects to `/transfers/send` | Medium |
| T3 | As Admin, Send Transfer | A **Sending facility** selector appears; batches scoped to it; receiving excludes the source | High |
| T4 | As facility Pharmacist, send then receive a transfer by code | Transfer created with code; receipt confirms; history shows it | High |

## Medicine Master & Stock Categories
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| M1 | Medicines → type a generic name, dosage form, and a strength in the search box | List **filters** by each (name/generic/category/form/strength); placeholder is the new text | High |
| M2 | Masters → Stock Categories | Titled "Stock Categories"; **no Sort Order field** in add/edit | Medium |
| M3 | Delete a category, then restore it from Recovery | Recovery works without error | High |

## Navigation, dead links, audit
| ID | Test steps | Expected result | Priority |
|---|---|---|---|
| N1 | `/settings/users` directly | Redirects to `/users` (no duplicate page) | Medium |
| N2 | Stock page | Shows only stock actions (Order, Receipt, Usage, Adjustment, Transactions) — no Medicines/Expiry/Transfers/Returns duplicates | Medium |
| N3 | Global search (Ctrl+K / top bar): search a staff member and a prescription; click results | Both resolve to working **detail pages** (no 404); a Return result also appears | High |
| N4 | Audit Trail: find a Medicine or Category change | **No location/facility** shown for it; **before/after** values visible | High |
| N5 | Every sidebar item + Logout | All navigate/work; no dead links or placeholder actions | Medium |

---

### Result log
| ID | Pass/Fail | Notes |
|---|---|---|
| | | |
