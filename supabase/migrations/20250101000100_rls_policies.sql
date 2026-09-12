-- =============================================================================
-- Row-Level Security
--
-- RLS is the security boundary for this app. The browser talks to Postgres
-- directly with the anon key, so every rule that matters is enforced here —
-- bypassing the UI gains an attacker nothing.
--
-- Two axes:
--   1. Tenancy  — you only ever see rows whose business_id is your own.
--   2. Role     — owner: full write. helper: writes operational tables only.
--                 ca: read-only everywhere.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Identity helpers
--
-- SECURITY DEFINER so they can read public.users without tripping that table's
-- own RLS policy (which would recurse). search_path is pinned so the function
-- body cannot be redirected by a caller-controlled search_path.
-- -----------------------------------------------------------------------------
create or replace function public.current_business_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select business_id from public.users where id = auth.uid();
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.users where id = auth.uid();
$$;

revoke all on function public.current_business_id() from public;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_business_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere. A table with RLS enabled and no policy denies all
-- access by default, so enabling first and adding policies after is safe.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'businesses', 'users', 'vehicles', 'drivers', 'driver_advances',
    'driver_salary_payments', 'clients', 'brokers', 'quotations', 'trips',
    'invoices', 'credit_debit_notes', 'expenses', 'opening_balances',
    'vehicle_maintenance_log', 'insurance_claims', 'documents', 'audit_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Generated policies for business-owned tables.
--
-- read_roles  — everyone in the business can read their own data.
-- write_roles — differs by table group, see the two arrays below.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
  -- Operational tables. Helpers do the day-to-day data entry here.
  operational text[] := array['trips', 'expenses', 'invoices', 'credit_debit_notes'];
  -- Master data, asset records and ledger anchors. Owner-only writes.
  -- `documents` is deliberately not here: it gets its own policies below,
  -- because a helper must be able to attach a proof of delivery but not
  -- delete one.
  owner_only text[] := array[
    'vehicles', 'drivers', 'driver_advances', 'driver_salary_payments',
    'clients', 'brokers', 'quotations', 'opening_balances',
    'vehicle_maintenance_log', 'insurance_claims'
  ];
  writers text;
begin
  foreach t in array operational || owner_only
  loop
    writers := case
      when t = any (operational) then '''owner'', ''helper'''
      else '''owner'''
    end;

    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    -- Read: any role, own business only.
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (business_id = public.current_business_id())
    $f$, t || '_select', t);

    -- Insert: rows must be stamped with the caller's own business_id, so a
    -- client cannot write into another tenant's data.
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (
          business_id = public.current_business_id()
          and public.current_user_role() in (%s)
        )
    $f$, t || '_insert', t, writers);

    -- Update: both the existing row and the updated row must stay in-tenant.
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (
          business_id = public.current_business_id()
          and public.current_user_role() in (%s)
        )
        with check (
          business_id = public.current_business_id()
          and public.current_user_role() in (%s)
        )
    $f$, t || '_update', t, writers, writers);

    execute format($f$
      create policy %I on public.%I
        for delete to authenticated
        using (
          business_id = public.current_business_id()
          and public.current_user_role() in (%s)
        )
    $f$, t || '_delete', t, writers);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- businesses — the tenant row itself. Everyone reads it, only the owner edits.
-- No insert policy: businesses are created through bootstrap_business() below.
-- -----------------------------------------------------------------------------
drop policy if exists businesses_select on public.businesses;
create policy businesses_select on public.businesses
  for select to authenticated
  using (id = public.current_business_id());

drop policy if exists businesses_update on public.businesses;
create policy businesses_update on public.businesses
  for update to authenticated
  using (id = public.current_business_id() and public.current_user_role() = 'owner')
  with check (id = public.current_business_id() and public.current_user_role() = 'owner');

-- -----------------------------------------------------------------------------
-- users — staff list. Readable by the whole business, writable by the owner.
-- The owner cannot change their own row's role, which stops the only owner in
-- a business from accidentally demoting themselves and locking everyone out.
-- -----------------------------------------------------------------------------
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (business_id = public.current_business_id());

drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert to authenticated
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
    and (id <> auth.uid() or role = 'owner')
  );

drop policy if exists users_delete on public.users;
create policy users_delete on public.users
  for delete to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
    and id <> auth.uid()
  );

-- -----------------------------------------------------------------------------
-- documents — file metadata.
--
-- Writes follow the storage policies in the storage migration exactly: a
-- helper attaches a proof of delivery (which is captured at the drop point, by
-- whoever is doing the data entry), but only the owner removes one. Letting the
-- two disagree would mean an upload that lands in the bucket and is then
-- refused a metadata row, leaving a file nobody can find.
-- -----------------------------------------------------------------------------
drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (business_id = public.current_business_id());

drop policy if exists documents_insert on public.documents;
create policy documents_insert on public.documents
  for insert to authenticated
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  );

drop policy if exists documents_update on public.documents;
create policy documents_update on public.documents
  for update to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  )
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  );

drop policy if exists documents_delete on public.documents;
create policy documents_delete on public.documents
  for delete to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  );

-- -----------------------------------------------------------------------------
-- audit_log — owner reads, nobody writes from the client. Rows are written by
-- triggers running as the table owner, which bypass RLS.
-- -----------------------------------------------------------------------------
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  );

-- -----------------------------------------------------------------------------
-- bootstrap_business — first-run setup.
--
-- A freshly signed-up auth user has no row in public.users, so every RLS check
-- fails and they can see nothing. This creates their business and owner record
-- in one transaction. It refuses to run twice for the same user, so it cannot
-- be used to hop tenants or mint extra businesses.
-- -----------------------------------------------------------------------------
create or replace function public.bootstrap_business(
  business_name text,
  owner_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  new_business_id uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.users where id = uid) then
    raise exception 'this account already belongs to a business';
  end if;

  if coalesce(trim(business_name), '') = '' then
    raise exception 'business name is required';
  end if;

  insert into public.businesses (name)
  values (trim(business_name))
  returning id into new_business_id;

  insert into public.users (id, business_id, name, role)
  values (uid, new_business_id, coalesce(nullif(trim(owner_name), ''), 'Owner'), 'owner');

  return new_business_id;
end;
$$;

revoke all on function public.bootstrap_business(text, text) from public;
grant execute on function public.bootstrap_business(text, text) to authenticated;
