# Balaji Enterprises

Transport, distribution and accounts management for Balaji Enterprises.

React + Vite + TypeScript on the front, Supabase (Postgres, Auth, Storage) behind
it, deployed to Cloudflare Pages as an installable PWA. There is no custom API
server — the browser talks to Postgres directly and **Row-Level Security is the
security boundary**.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical design.

---

## Status

**Phase 1 is built and working.** Each phase is usable on its own, so the app can
go into daily use now and grow from there.

| Phase | Scope | State |
|---|---|---|
| 1 | Vehicle, driver, client and broker masters · trip entry · expense logging · dashboard | ✅ Done |
| 2 | Invoicing (GST / non-GST) · ledgers · credit & debit notes · receipts · driver advances and salary | ✅ Done |
| 3 | Distribution planning · multi-stop and multi-vehicle | Planned |
| 4 | Reports · CA export pack · PDF and Excel export | Planned |
| 5 | Asset care (service-by-km, tyres, claims) · helper & CA roles in-app · audit trail | Planned |

The full database schema for all five phases is already migrated, so later phases
add screens rather than reshaping tables. Role permissions and the storage bucket
are enforced in the database today, ahead of the Phase 5 UI for managing staff.

### What Phase 1 gives you

- **Dashboard** — freight billed, outstanding, expenses and margin for the month;
  vehicle and licence papers falling due inside 30 days; trips currently on the road.
- **Trips** — the operational core. Search and filter by status, one-tap movement
  through `booked → in_transit → delivered → payment_pending → closed`, live balance
  due, broker commission pre-filled from the broker's agreed rate, and the vehicle's
  odometer kept current from each trip's closing reading.
- **Expenses** — 11 categories, optional per-vehicle attribution, monthly total.
- **Masters** — vehicles with document expiry tracking, drivers with licence and
  salary terms, clients with credit terms, brokers with commission terms.
- **Settings** — business details and financial-year start used by invoices and reports.
- **Installable** — add to a phone home screen; the app shell is cached so it opens
  instantly. Offline write-queueing is still to come; the app needs a connection to
  save.

### What Phase 2 adds

- **Invoices** — GST and non-GST, numbered per financial year (`GST/2025-26/0001`)
  by Postgres rather than by counting rows, so two people billing at once cannot
  collide or leave a gap in the series. CGST+SGST or IGST is decided from the place
  of supply against your own GSTIN; reverse charge is supported. Billing a trip
  pre-fills the party, freight and agreed bill type.
- **Credit and debit notes** — short delivery, rate corrections, detention. The
  original invoice is never edited, which is what GST requires.
- **Receipts and payouts** — record part-payments from clients and commission
  payouts to brokers, with a reference you can match against the bank statement.
- **Ledgers** — client receivable, broker (both directions, netted), and driver
  payable. Computed live as Postgres views, so a balance can never drift from the
  trips, invoices, notes and receipts behind it. Each client row expands into the
  full derivation.
- **Driver advances and salary runs** — recovering an advance through a salary run
  marks it recovered, so the same rupee is never chased twice.

---

## Getting started

Requires Node 20 or newer.

```bash
npm install
cp .env.example .env.local     # then fill in your Supabase URL + anon key
npm run dev
```

Without credentials in `.env.local` the app shows a setup screen explaining what is
missing, rather than failing on the first query.

### Database

The schema lives in versioned migration files, not in the Supabase dashboard.
See [`supabase/README.md`](supabase/README.md) for applying them — with or without
the Supabase CLI.

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

On first sign-in, an account with no profile row is sent to a one-time setup screen
that creates the business and the owner record together in a single transaction.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:5173 |
| `npm run build` | Typecheck, then production build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run typecheck` | TypeScript only, no build |
| `npm run lint` | ESLint |
| `npm run icons` | Regenerate the PWA icons in `public/icons/` |
| `npm run db:test` | Apply every migration to a throwaway Postgres and run the assertion suite |

---

## Deployment

Cloudflare Pages, auto-deploying from GitHub.

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Node version | 20 |

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in **Settings → Environment
variables**. They are never committed. The anon key is meant to be public — it
carries no privileges of its own, and every read and write is checked against the
RLS policies in `supabase/migrations/`.

`public/_redirects` routes every path to `index.html` so deep links work, and
`public/_headers` sets long-lived caching for hashed assets while keeping the shell
and service worker revalidating so a deploy actually reaches installed phones.

Every branch and pull request gets its own preview URL, which is the safe way to
try a change before it reaches the live app.

---

## Testing the database

`npm run db:test` applies every migration to a scratch database and runs ~50
assertions against it: that business A cannot see or write business B's rows, that a
helper can log a trip but not add a vehicle, that a CA cannot write at all, that the
ledger arithmetic comes out right, that invoice numbering is per-business and
per-year, and that the storage policies enforce the tenant folder.

It needs a local Postgres 15+ reachable over TCP:

```bash
initdb -D /tmp/pgdata -U postgres --auth=trust
pg_ctl -D /tmp/pgdata -o "-p 55432" start
npm run db:test
```

`supabase/test/00_shim.sql` recreates the parts of a Supabase project the migrations
depend on — the `auth` and `storage` schemas, the `anon`/`authenticated` roles, the
default grants. It is never applied to the real project.

One thing the suite encodes that is easy to get wrong: under RLS a failed `INSERT`
raises, but an `UPDATE` or `DELETE` the `USING` clause excludes simply matches zero
rows and returns successfully. Asserting "it threw" would pass for the wrong reason,
so those cases read the value back and assert it is untouched.

## Project layout

```
src/
  app/               routing, layout shells, providers (auth, toasts)
  features/
    auth/            login, one-time onboarding, setup gate
    dashboard/
    trips/           trip list, entry form, trip maths
    accounts/
      invoices/       invoice form with GST computation, credit/debit notes
      ledgers/        client, broker and driver ledgers, receipts
      expenses/
    vehicles/
    drivers/
    parties/         clients + brokers
    settings/
  components/ui/     buttons, fields, cards, status pills, bottom sheet
  lib/
    supabase.ts      the only API layer
    format.ts        ₹ / date / km formatting for en-IN
    gst.ts           CGST/SGST vs IGST, rates, state codes
    queries/         one typed module per table
  hooks/             auth, master data, toasts
  types/             database types, mirroring the migrations

supabase/migrations/ schema, RLS policies, storage, invoicing, ledger views
supabase/test/       shim, seed and assertions for npm run db:test
scripts/             PWA icon generator
docs/                architecture
```

### Roles

Enforced by RLS, so they hold even if someone bypasses the UI entirely.

| Role | Reads | Writes |
|---|---|---|
| **Owner** | Everything in the business | Everything |
| **Helper** | Everything in the business | Trips, expenses, invoices, credit/debit notes |
| **CA** | Everything in the business | Nothing — read and export only |

### Notes on the data model

- Every business-owned table carries `business_id`. That column is what RLS filters
  on, and what lets a second entity be added later without a redesign.
- Ledgers (client dues, broker payable, driver payable) are Postgres views, not
  tables — the numbers cannot drift from the entries behind them. A trip contributes
  either its invoice total or, while unbilled, its raw freight, never both. Cancelled
  invoices drop out, and the raw freight comes back.
- Every view is declared `security_invoker = on`. Without it a view runs with its
  owner's rights and would hand a helper or CA rows from another business straight
  past RLS.
- A `payments` table was added beyond the original architecture document, because
  `invoices.status = 'part_paid'` cannot be determined without a record of what has
  actually been received. Drivers are deliberately excluded from it — their money
  lives in `driver_advances` and `driver_salary_payments`, and a second home for it
  would double-count in the driver ledger.
- `trips.drop_location` is named that way because `DROP` is a reserved word in SQL.
- `party_id` on `trips` and `quotations` points at either a client or a broker, so it
  carries no foreign key; party names are resolved in the app from one merged lookup.
