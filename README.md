# Balaji Enterprises

Transport, distribution and accounts management for Balaji Enterprises.

React + Vite + TypeScript on the front, Supabase (Postgres, Auth, Storage) behind
it, deployed to Cloudflare Pages as an installable PWA. There is no custom API
server — the browser talks to Postgres directly and **Row-Level Security is the
security boundary**.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full technical design.

---

## Status

**All five phases are built.** Nothing is stubbed or mocked; the remaining work is
pointing it at a real Supabase project and deploying it.

| Phase | Scope | State |
|---|---|---|
| 1 | Vehicle, driver, client and broker masters · trip entry · expense logging · dashboard | ✅ Done |
| 2 | Invoicing (GST / non-GST) · ledgers · credit & debit notes · receipts · driver advances and salary | ✅ Done |
| 3 | Distribution planning · multi-stop and multi-vehicle | ✅ Done |
| 4 | Reports · CA export pack · PDF and Excel export | ✅ Done |
| 5 | Asset care (service-by-km, tyres, claims) · helper & CA roles in-app · audit trail | ✅ Done |

Still to come, deliberately left out: offline write-queueing (the app needs a
connection to save), and push notifications for document expiry, which is the one
feature that would need a native wrapper such as Capacitor.

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

### What Phase 3 adds

- **Week plan** — a vehicle × day grid. It exists to surface the two things that
  cost money: a truck sitting idle (dashed cell) and a truck promised to two loads
  on the same day (red cell). Both are counted in the header rather than left for
  you to spot.
- **Consignments** — one customer order carried by several trucks. Dispatch as many
  trips against it as it takes; the planner tracks quantity dispatched against
  ordered and shows what is still to go.
- **Multi-stop trips** — an ordered list of loads and unloads per trip, each
  markable reached or done as the driver calls in, and reorderable. The trip's own
  pickup and drop stay as the headline route, so every existing list, invoice and
  report reads the same as before.

### What Phase 4 adds

- **Reports** — P&L (month by month, and expenses by head), GST summary grouped
  the way GSTR-1 reads, vehicle economics with cost and revenue per kilometre, and
  a compliance register of trips missing an LR, e-way bill, proof of delivery or
  invoice. Date ranges include the financial year taken from your own FY start
  month, not a hardcoded April.
- **Exports** — every report downloads as PDF (to read) or Excel (to filter and
  pivot). Tax invoices download as a proper GST invoice PDF.
- **CA export pack** — one zip holding the P&L and GST summary as PDFs, a
  nine-sheet workbook (P&L, GST, invoice and trip registers, vehicle economics,
  the three ledgers, compliance gaps), and a plain-text README stating the period
  and how the numbers were arrived at. Built entirely in the browser — there is no
  server-side job to run or pay for.

### What Phase 5 adds

- **Service by kilometres** — an interval per truck per service item (engine oil
  every 15,000 km, greasing every 30 days, or both, whichever comes first). Due
  status is measured against the odometer your trips already keep current, so
  nothing has to be read off a dial and typed in separately. Overdue sorts first.
- **Mark done in one step** — logs the cost to the workshop history, restarts the
  interval and carries the odometer forward in a single database transaction, so a
  truck can never show a service as overdue while its bill is already on the books.
- **Insurance claims** — filed through to settled, with the shortfall against what
  was claimed.
- **Staff access** — an owner invites a helper or a CA by email; the invitee signs
  up and accepts on first sign-in. Roles are changeable, access is revocable.
- **Activity** — an owner-only audit trail written by database triggers, showing
  who changed what, with from/to values for each changed column.

### Also built

Three things the architecture document had in its schema but no phase claimed.
They are small, and leaving them out would have left visible holes:

- **Attachments** — proof of delivery on a trip (the camera opens straight to it
  on a phone), and RC, insurance, permit, fitness or licence copies on a vehicle or
  driver. Without this the compliance report flagged a missing POD that there was
  no way to supply. Files live in a private bucket under a path beginning with the
  business id, which is what the storage policies check, so links are signed on
  demand rather than stored.
- **Opening balances** — what a party already owed before the app was in use. A
  business starting mid-year would otherwise show every party as square on day one
  and the ledgers would be quietly wrong. Direction is a dropdown rather than a
  minus sign to remember.
- **Quotations** — rate quotes per route, moved to accepted or rejected, with
  lapsed validity flagged.

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

### 1. Supabase

Create a project at [supabase.com](https://supabase.com). Pick the **Mumbai
(ap-south-1)** region — every user is in India and it removes ~200 ms per request.
Save the database password somewhere safe; it is shown once.

Postgres 15 or newer is required. The ledger and report views are declared
`security_invoker`, which older versions do not support.

```bash
npm i -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push
```

`db push` applies all nine migrations in filename order. It is safe to re-run.
`supabase/config.toml` is committed, so there is no need to run `supabase init`
first — which is easy to run in the wrong directory.

Then copy **Project Settings → API** → the Project URL, and the browser key from
**API Keys**.

Supabase issues two generations of that key and the app takes either:

| Key | Shape | Env variable |
|---|---|---|
| Publishable (new projects) | `sb_publishable_…` | `VITE_SUPABASE_PUBLISHABLE_KEY` |
| Anon (older projects) | `eyJ…`, a JWT | `VITE_SUPABASE_ANON_KEY` |

Both map to the `anon` Postgres role, so they are interchangeable; if both are
set the publishable one wins. Either is meant to be public — it carries no
privileges of its own, and every read and write is checked against the RLS
policies.

The **secret** key (`sb_secret_…`, formerly `service_role`) is the opposite: it
bypasses every policy. It must never go into this app, a Cloudflare variable, or
the repo. The app refuses to start if it finds one, and says so.

**Auth settings worth changing** (Authentication → Providers → Email):

- Turn **Confirm email** off while setting up, or you will need to click a link
  before the first sign-in works. Turn it back on before adding staff.
- Set **Site URL** to your Cloudflare Pages URL once you have it, so confirmation
  and recovery links come back to the right place.

### 1b. The create-staff function (optional)

Everything in the app works without this. Deploy it only if you want to create
staff logins outright — setting their password yourself and handing it over —
rather than inviting them by email.

```bash
supabase functions deploy create-staff
```

It needs no secrets set by hand: Supabase injects the project URL and secret key
into the function's own environment. That is the whole point of it being a
function — creating another person's auth account needs the secret key, which
bypasses every RLS policy and must never reach a browser.

The function uses two clients deliberately. The secret key does exactly one
thing: create (and, if the follow-up fails, remove) the auth account. Every
database read and write goes through the **caller's** JWT, so RLS still applies
— `business_id` is read from the caller's own profile rather than taken from the
request, the `users_insert` policy independently requires an owner, and the audit
trail records the owner who acted instead of "System".

Without it deployed, **Settings → Staff → Create a login** explains the one
command and points back at invitations.

### 2. Cloudflare Pages

Connect the repository, then:

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` — **not blank, and not `/`** |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` |

Node is pinned to 20 by `.nvmrc`; no `NODE_VERSION` variable is needed. The build
fetches SheetJS from `cdn.sheetjs.com` (see the note under **Notes on exports**),
which Cloudflare's build network allows.

If the output directory is left blank, Cloudflare serves the **repository root**
instead of the build. The symptom is a blank page whose HTML still references
`/src/main.tsx` — the unbuilt entry point, which a browser cannot execute — and
`/package.json` returning real content. Setting it to `dist` and redeploying is
the whole fix.

`public/_redirects` routes every path to `index.html` so deep links work before
the service worker is installed, and `public/_headers` caches hashed assets for a
year while keeping the shell and service worker revalidating, so a deploy actually
reaches phones with the app already installed. Both are copied into `dist`
automatically.

Every branch and pull request gets its own preview URL, which is the safe way to
try a change before it reaches the live app.

### 3. First run

Open the site and create an account. With no invitation waiting, the first
sign-in offers to create the business; that runs `bootstrap_business()`, which
makes the business and your owner record in one transaction. From there,
**Settings → Staff** invites a helper or a CA.

### If `db push` stops on the storage migration

`20250101000200_storage.sql` sets access policies on `storage.objects`, a table
owned by `supabase_storage_admin` rather than by the role running the migration.
The migration handles this by becoming whoever owns the table, and resets the role
afterwards. If it still refuses, it says which role owns the table and which role
you are; applying that one file from the Supabase SQL Editor resolves it, since the
editor runs with the necessary rights.

## Project layout

```
src/
  app/               routing, layout shells, providers (auth, toasts)
  features/
    auth/            login, one-time onboarding, setup gate
    dashboard/
    trips/           trip list, entry form, trip maths
    assets/           service schedules, workshop history, insurance claims
    distribution/     week planning grid, consignments, trip stops
    accounts/
      invoices/       invoice form with GST computation, credit/debit notes
      ledgers/        client, broker and driver ledgers, receipts
      reports/        P&L, GST, vehicle economics, compliance, CA pack
      expenses/
    vehicles/
    drivers/
    parties/         clients + brokers
    settings/         business details, staff access, activity log
  components/          DocumentsSheet (attachments for any record)
  components/ui/       buttons, fields, cards, status pills, bottom sheet
  lib/
    supabase.ts      the only API layer
    storage.ts       private-bucket uploads and signed links
    format.ts        ₹ / date / km formatting for en-IN, plus PDF-safe variants
    gst.ts           CGST/SGST vs IGST, rates, state codes
    export/          PDF, Excel and the zipped CA pack, all lazily loaded
    queries/         one typed module per table
  hooks/             auth, master data, toasts
  types/             database types, mirroring the migrations

supabase/migrations/ schema, RLS, storage, invoicing, ledgers, distribution,
                     report views, asset care, staff invites, audit triggers
supabase/functions/  create-staff: owner-only staff login creation
supabase/config.toml committed, so no `supabase init` step
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

### Notes on staff and the audit trail

- `claim_invite()` only ever creates the caller's own profile row, only from an
  invite matching the caller's own email as read from `auth.users` (not from a JWT
  claim, which a client could shape), only once, and only at the role the invite
  names.
- The audit trail is written by `AFTER` triggers, not by the app, so a change made
  through the Supabase dashboard or a direct SQL session is recorded too. An update
  stores only the columns that actually changed as `{from, to}` pairs; inserts and
  deletes store the whole row. `updated_at` is not treated as a change, and a write
  that changed nothing is not logged at all.
- Nobody can insert into or update `audit_log` — there is no policy that permits
  it, including for the owner. The triggers write it as the table owner, which
  bypasses RLS.

### Notes on exports

- jsPDF, SheetJS and JSZip are **dynamically imported**, so the ~1.2 MB of export
  libraries never reaches a phone that only enters trips. They are also excluded
  from the service worker precache and cached at runtime on first use instead,
  which keeps the install payload at ~760 KB rather than ~2 MB.
- PDF text goes through `pdfSafe()` in `src/lib/format.ts`. jsPDF's built-in
  Helvetica is WinAnsi-encoded and has no rupee glyph; handed one it switches the
  string to UTF-16 while still drawing through a Latin-1 font, and the line comes
  out as mangled, space-separated digits. Amounts in PDFs are written `Rs.
  1,20,000.00`, which is what most Indian invoices print anyway. Arrows, dashes and
  smart quotes are substituted the same way. On screen the rupee symbol is used
  normally.
- SheetJS is installed from `https://cdn.sheetjs.com/...`, not from npm. The npm
  package is abandoned at 0.18.5 with two open advisories; the CDN tarball is the
  maintainers' supported distribution and is patched. This means a build needs
  network access to that host — which Cloudflare Pages has.

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
- Consignments and trip stops are both optional additions beyond the original
  architecture document, which listed no backend change for Phase 3. Multi-stop and
  multi-vehicle cannot be represented by the Phase 1 `trips` table alone — it has one
  pickup, one drop, and nothing that groups several trucks onto one order. A trip with
  no stops and no consignment behaves exactly as it did before.
- `party_id` on `trips` and `quotations` points at either a client or a broker, so it
  carries no foreign key; party names are resolved in the app from one merged lookup.
