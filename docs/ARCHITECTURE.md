# Balaji Enterprises App — Technical Architecture

**Stack:** React (Vite + TypeScript) · Supabase (Postgres, Auth, Storage) · Cloudflare Pages · PWA
**Owner:** Jashwanth Goud Alvala · Balaji Enterprises (Transport, Distribution & Accounts)

---

## 1. Why this stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend | React + Vite + TypeScript | Fast dev/build, no server rendering needed for an internal business app |
| Backend | Supabase (Postgres + Auth + Storage) | One managed service gives you a real relational DB, login, and file storage — no separate backend server to run or pay for |
| Hosting | Cloudflare Pages | Free/near-free, global CDN, auto-deploys from GitHub on every push |
| Install | PWA (manifest + service worker) | Installable on phone home screen without an app store, works like a native app for your daily use |
| Data access | Supabase client (`supabase-js`) directly from the frontend | No custom API server needed — security is enforced by Postgres Row-Level Security (RLS) policies, not by a middle layer |

No custom backend server is needed. The frontend talks to Supabase directly; Postgres RLS policies are the security boundary (this is the standard, supported way to use Supabase — not a shortcut).

---

## 2. Database schema (Postgres tables)

```
businesses
  id, name, gstin, pan, address, bank_details, fy_start_month

vehicles
  id, business_id, reg_no, type, capacity, purchase_date,
  insurance_expiry, permit_expiry, fitness_expiry,
  current_odometer, status, assigned_driver_id

drivers
  id, business_id, name, phone, license_no, license_expiry,
  assigned_vehicle_id, salary_type, fixed_salary_amount, joining_date

driver_advances
  id, driver_id, date, amount, reason, adjusted (bool)

driver_salary_payments
  id, driver_id, period_month, salary_earned, advances_deducted,
  other_deductions, net_payable, amount_paid, paid_date

clients
  id, business_id, name, gstin, contact, address,
  credit_limit, credit_period_days

brokers
  id, business_id, name, contact, commission_type, commission_rate, gstin

quotations
  id, business_id, party_type (client/broker), party_id,
  route, expected_goods, quoted_rate, validity_date, status

trips
  id, business_id, vehicle_id, driver_id,
  party_type (client/broker), party_id,
  pickup, drop, goods_description,
  odometer_start, odometer_end, trip_date,
  freight_amount, broker_commission, advance_received,
  bill_type (gst/non_gst), lr_number, eway_bill_no, tds_deducted,
  pod_file_url, status

invoices
  id, business_id, trip_id, invoice_type (gst/non_gst),
  invoice_number, invoice_date, amount, tax_breakup (jsonb), status

credit_debit_notes
  id, invoice_id, type (credit/debit), amount, reason, date

expenses
  id, business_id, category, vehicle_id (nullable), trip_id (nullable),
  date, amount, payment_mode, note

opening_balances
  id, business_id, party_type, party_id, amount, as_of_date

vehicle_maintenance_log
  id, vehicle_id, type (tyre/battery/service/other), date,
  cost, odometer_reading, note

insurance_claims
  id, vehicle_id, claim_date, incident_note, claim_amount,
  settlement_amount, status

documents
  id, owner_type (vehicle/driver/trip), owner_id, file_url, doc_type

users
  id (auth.users), business_id, name, role (owner/helper/ca)

audit_log
  id, user_id, table_name, record_id, action, changed_at, diff (jsonb)
```

**Design notes:**
- Every business-owned table carries `business_id` — this is what RLS policies filter on, and what makes the schema ready to extend to a second entity later without redesign.
- `trips.status` drives the whole operational flow: `booked → in_transit → delivered → payment_pending → closed`.
- Ledgers (client dues, broker payable, driver payable) are **views**, not stored tables — computed live from `trips`, `invoices`, `expenses`, `driver_advances`, and `opening_balances`. This means the numbers are never out of sync with the source entries.

---

## 3. Authentication & Roles (Supabase Auth + RLS)

| Role | Access |
|---|---|
| **Owner** (you) | Full read/write on everything under your `business_id` |
| **Helper** (office staff) | Read/write on trips, expenses, invoices — no access to reports or settings |
| **CA** | Read-only on everything, plus export actions — cannot edit or delete |

Implementation: a `users` table maps each Supabase Auth user to a `role` and `business_id`. Every table's RLS policy checks `business_id = auth.jwt() business_id` AND role permissions for that action (select/insert/update/delete). This is enforced at the database level — even if someone bypassed the app UI, they couldn't see or change data outside their role.

---

## 4. Frontend structure

```
src/
  app/                  routing, layout shells (mobile bottom-nav, desktop sidebar)
  features/
    dashboard/
    trips/
    distribution/
    accounts/
      invoices/
      expenses/
      ledgers/
      reports/
    vehicles/
    drivers/
    parties/            clients + brokers
    settings/
  components/           shared UI (buttons, cards, status pills, tables)
  lib/
    supabase.ts         Supabase client init
    queries/             typed query functions per table
  hooks/                 data-fetching hooks (React Query)
  types/                 TypeScript types generated from Supabase schema
```

**Key libraries:**
- **@tanstack/react-query** — data fetching, caching, and auto-refresh from Supabase; avoids manual loading-state juggling
- **@supabase/supabase-js** — the only "API layer" needed
- **react-hook-form + zod** — form handling and validation (trip entry, invoice entry, expense entry all have many fields)
- **jsPDF or react-pdf** — generate invoice PDFs and the CA export pack
- **SheetJS (xlsx)** — Excel export for reports
- **vite-plugin-pwa** — generates the manifest and service worker for installability and basic offline caching

---

## 5. Offline behavior (PWA)

Since drivers/trips happen in areas with patchy signal:
- Cache the app shell (JS/CSS) so it opens instantly even offline
- Queue trip/expense entries locally (IndexedDB) if submitted while offline, and sync automatically once back online
- Read-heavy screens (dashboard, reports) show last-cached data with a "last updated" timestamp when offline

This is a Phase 2+ concern — Phase 1 can work online-only, with offline queuing added once the core flows are stable.

---

## 6. Deployment pipeline

```
Local dev → GitHub repo → Cloudflare Pages (auto-deploy on push to main)
                              ↓
                    Supabase project (separate, not redeployed —
                    schema changes go through migration files)
```

- **Environment variables** (Supabase URL + anon key) are set in Cloudflare Pages project settings — never committed to the repo.
- **Database migrations** — use Supabase CLI migration files checked into the repo, so schema changes are versioned and repeatable, not made ad-hoc in the Supabase dashboard.
- **Preview deployments** — Cloudflare Pages auto-generates a preview URL for every branch/PR, useful for testing a new feature before it goes live on your main app.

---

## 7. Reports & CA export

- Every report screen has an "Export" button — PDF for review documents (P&L, GST summary), Excel for working data (ledgers, trip lists) the CA might want to filter/pivot.
- "CA Export Pack" bundles P&L + GST summary + ledgers for a selected date range into one downloadable set — this is a client-side operation (fetch the data, generate the files, zip them) with no separate backend job needed.

---

## 8. Build order (maps to earlier spec phases)

| Phase | What gets built | Backend | Frontend |
|---|---|---|---|
| 1 | Vehicle, Driver, Client, Broker masters + Trip entry + basic Expense logging | Core tables + RLS for owner role | Dashboard, Trips, Vehicles, Drivers, Parties screens |
| 2 | Invoicing (GST/Non-GST) + Ledgers + Credit/Debit notes | Invoice + ledger views | Accounts module |
| 3 | Distribution planning + multi-stop/multi-vehicle | — | Distribution calendar/grid |
| 4 | Reports + CA Export Pack + compliance fields (LR, E-way Bill, TDS) | Report views | Reports screens, PDF/Excel export |
| 5 | Asset care (service-by-km, tyre/battery, insurance claims) + Helper/CA roles + audit trail | Roles + audit_log table | Settings, role-gated UI |

Each phase is a working, usable app on its own — you don't have to wait for Phase 5 to start using Phase 1 day to day.

---

## Notes
- No custom backend server (Node/Express etc.) is needed for this app — Supabase + RLS covers it. This keeps hosting cost near-zero and there's one less moving part to maintain.
- If push notifications for document-expiry alerts become important later, that's the one feature that would require moving part of the app to a native wrapper (e.g. Capacitor) — not a rebuild, just an addition.
