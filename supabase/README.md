# Supabase — database setup

The schema lives in versioned migration files, not in the dashboard. Editing
tables by hand in the Supabase UI will drift from this repo; make every change
as a new migration file instead.

## First-time setup

1. Create a project at [supabase.com](https://supabase.com) (region: Mumbai / `ap-south-1`).
2. Install the CLI: `npm i -g supabase`
3. Link and push:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   `db push` applies everything in `migrations/` in filename order.

4. Copy the project URL and **anon** key from Project Settings → API into
   `.env.local` (local) and Cloudflare Pages environment variables (production).

## Applying migrations without the CLI

Paste each file in `migrations/` into the SQL Editor in filename order and run
them one at a time. They are written to be re-runnable, so a repeated run is
harmless.

## Adding a change later

```bash
supabase migration new add_something
# edit the generated file
supabase db push
```

## Migration files

| File | What it does |
|---|---|
| `20250101000000_initial_schema.sql` | All tables, indexes, `updated_at` triggers |
| `20250101000100_rls_policies.sql` | RLS helpers, tenant + role policies, `bootstrap_business()` |
| `20250101000200_storage.sql` | `documents` bucket and its per-tenant access policies |

## First login

The app calls `bootstrap_business(business_name, owner_name)` the first time an
account signs in without a `public.users` row. That creates the business and the
owner record together. It refuses to run twice for the same account, so it
cannot be used to create extra businesses or move between them.

## Roles

| Role | Reads | Writes |
|---|---|---|
| `owner` | everything in the business | everything |
| `helper` | everything in the business | trips, expenses, invoices, credit/debit notes |
| `ca` | everything in the business | nothing |

To add a helper: invite them via Supabase Auth, then insert a `public.users` row
with their auth user id, your `business_id`, and `role = 'helper'`.
