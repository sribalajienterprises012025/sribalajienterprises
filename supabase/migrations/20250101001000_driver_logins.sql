-- =============================================================================
-- Driver logins
--
-- Until now a driver was master data — a name, a licence, a salary rate — with
-- no way into the app. This gives one a login, and draws the line around what
-- it can reach.
--
-- The rule the whole file serves: a driver sees their own work and their own
-- money. Not what a trip earned, not a client's rate, not an invoice, not
-- another driver's advance. That is not a UI decision — a driver holds the
-- same publishable key as everyone else and can ask Postgres anything they
-- like — so it is enforced here, twice over:
--
--   1. A restrictive policy on every business table. Restrictive policies are
--      ANDed with the permissive ones, so this fences drivers out of the
--      tables wholesale without touching a single existing rule. Two tables
--      are excepted: businesses (a driver may know who they work for) and
--      users, narrowed to their own row so the app can read its own profile.
--
--   2. Three SECURITY DEFINER views, which are the only way a driver reads
--      anything. They run as the owner, so the fence above does not apply
--      inside them, and their WHERE clause is therefore the entire boundary:
--      every one filters on current_driver_id(), which is NULL for everybody
--      else and matches no row. Fail-closed by construction.
--
-- Writes go through three functions for the same reason a view is used for
-- reads: a policy cannot say "you may change these two columns and no others",
-- and odometer readings are the only thing on a trip a driver may touch.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The role, and the link from a login to the driver record it belongs to.
-- -----------------------------------------------------------------------------
alter table public.users drop constraint if exists users_role_check;
alter table public.users
  add constraint users_role_check
  check (role in ('owner', 'helper', 'ca', 'driver'));

alter table public.users
  add column if not exists driver_id uuid references public.drivers (id) on delete set null;

-- One login per driver record, and no sharing one between two people.
create unique index if not exists users_driver_id_key
  on public.users (driver_id)
  where driver_id is not null;

-- A driver login names a driver; no other role may. Without this, an owner
-- row carrying a driver_id would read every driver-scoped view as that driver.
alter table public.users drop constraint if exists users_driver_id_matches_role;
alter table public.users
  add constraint users_driver_id_matches_role
  check ((role = 'driver') = (driver_id is not null));

-- -----------------------------------------------------------------------------
-- Identity helper. NULL for everyone who is not a driver, which is what makes
-- the views below deny by default rather than by rule.
-- -----------------------------------------------------------------------------
create or replace function public.current_driver_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select driver_id from public.users where id = auth.uid();
$$;

revoke all on function public.current_driver_id() from public;
grant execute on function public.current_driver_id() to authenticated;

-- -----------------------------------------------------------------------------
-- The fence.
--
-- Every table carrying business data, except the two a driver's own session
-- needs. A restrictive policy denies unless it passes, and is ANDed with
-- whatever else is there, so nothing already granted to an owner, a helper or
-- a CA changes: their role is not 'driver' and the clause is simply true.
--
-- `is distinct from` rather than `<>`, because current_user_role() is NULL for
-- an account that has signed up but has no profile row yet, and `NULL <>
-- 'driver'` is NULL — which a restrictive policy reads as a refusal. That
-- account is mid-onboarding and has to be able to read the invitation
-- addressed to it. It can reach nothing else: every other policy here needs a
-- business_id, and theirs is NULL until they join one.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'vehicles', 'drivers', 'driver_advances', 'driver_salary_payments',
    'clients', 'brokers', 'quotations', 'trips', 'invoices',
    'credit_debit_notes', 'expenses', 'opening_balances',
    'vehicle_maintenance_log', 'insurance_claims', 'documents', 'audit_log',
    'payments', 'invoice_counters', 'consignments', 'trip_stops',
    'service_schedules', 'invites'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'no_driver_' || t, t);
    execute format($f$
      create policy %I on public.%I
        as restrictive
        for all to authenticated
        using (public.current_user_role() is distinct from 'driver')
        with check (public.current_user_role() is distinct from 'driver')
    $f$, 'no_driver_' || t, t);
  end loop;
end;
$$;

-- users: a driver reads their own row and nothing else. The app needs it on
-- every load — it is how the session learns its own role — and the staff list
-- is not a driver's business.
drop policy if exists no_driver_users on public.users;
create policy no_driver_users on public.users
  as restrictive
  for all to authenticated
  using (public.current_user_role() is distinct from 'driver' or id = auth.uid())
  with check (public.current_user_role() is distinct from 'driver');

-- businesses is deliberately absent: a driver may see the name of the firm
-- they drive for. The row carries no money.

-- -----------------------------------------------------------------------------
-- What a driver reads.
--
-- security_invoker is off on purpose. These run as the view owner, so the
-- fence above does not apply inside them and the WHERE clause is the whole of
-- the boundary. Every one filters on current_driver_id().
-- -----------------------------------------------------------------------------
drop view if exists public.my_trips;
create view public.my_trips
with (security_invoker = off) as
select
  t.id,
  t.trip_date,
  t.status,
  t.pickup,
  t.drop_location,
  t.goods_description,
  t.lr_number,
  t.odometer_start,
  t.odometer_end,
  t.pod_file_url,
  t.notes,
  t.vehicle_id,
  v.reg_no                                   as vehicle_reg_no,
  v.type                                     as vehicle_type,
  -- Who the goods are for. A name is needed to hand a consignment over; what
  -- that name is being charged is not.
  case t.party_type
    when 'client' then c.name
    when 'broker' then b.name
  end                                        as party_name
from public.trips t
left join public.vehicles v on v.id = t.vehicle_id
left join public.clients  c on t.party_type = 'client' and c.id = t.party_id
left join public.brokers  b on t.party_type = 'broker' and b.id = t.party_id
where t.driver_id = public.current_driver_id()
  and t.status <> 'cancelled';

comment on view public.my_trips is
  'The signed-in driver''s own trips, without a single money column. Runs as '
  'the view owner, so its where clause is the security boundary.';

drop view if exists public.my_trip_expenses;
create view public.my_trip_expenses
with (security_invoker = off) as
select
  e.id,
  e.trip_id,
  e.date,
  e.category,
  e.amount,
  e.payment_mode,
  e.note
from public.expenses e
join public.trips t on t.id = e.trip_id
where t.driver_id = public.current_driver_id();

comment on view public.my_trip_expenses is
  'Fuel, toll and batta logged against the signed-in driver''s own trips. '
  'Their own spending, which they are entitled to see and to check.';

drop view if exists public.my_money;
create view public.my_money
with (security_invoker = off) as
select
  d.id                                  as driver_id,
  d.name                                as driver_name,
  d.salary_type,
  d.fixed_salary_amount,
  coalesce(a.advances_outstanding, 0)   as advances_outstanding,
  coalesce(s.salary_earned, 0)          as salary_earned,
  coalesce(s.salary_paid, 0)            as salary_paid,
  coalesce(s.salary_due, 0)             as salary_due,
  coalesce(t.trip_count, 0)             as trip_count
from public.drivers d
left join (
  select driver_id,
         sum(case when not adjusted then amount else 0 end) as advances_outstanding
  from public.driver_advances
  group by driver_id
) a on a.driver_id = d.id
left join (
  select driver_id,
         sum(salary_earned)                  as salary_earned,
         sum(amount_paid)                    as salary_paid,
         sum(net_payable) - sum(amount_paid) as salary_due
  from public.driver_salary_payments
  group by driver_id
) s on s.driver_id = d.id
left join (
  select driver_id, count(*) as trip_count
  from public.trips
  where status <> 'cancelled'
  group by driver_id
) t on t.driver_id = d.id
where d.id = public.current_driver_id();

comment on view public.my_money is
  'The signed-in driver''s own salary, advances and dues. Same arithmetic as '
  'driver_ledger, one row, and no other driver in it.';

drop view if exists public.my_advances;
create view public.my_advances
with (security_invoker = off) as
select id, date, amount, reason, adjusted
from public.driver_advances
where driver_id = public.current_driver_id();

drop view if exists public.my_salary_runs;
create view public.my_salary_runs
with (security_invoker = off) as
select
  id,
  period_month,
  salary_earned,
  advances_deducted,
  other_deductions,
  net_payable,
  amount_paid,
  paid_date
from public.driver_salary_payments
where driver_id = public.current_driver_id();

grant select on public.my_trips         to authenticated;
grant select on public.my_trip_expenses to authenticated;
grant select on public.my_money         to authenticated;
grant select on public.my_advances      to authenticated;
grant select on public.my_salary_runs   to authenticated;

-- -----------------------------------------------------------------------------
-- What a driver writes.
--
-- A policy cannot say "these two columns and no others", and on a trip the
-- odometer readings are the only thing a driver may touch — not the freight,
-- not the party, not the status beyond saying they have started or delivered.
-- So writes go through functions that each begin by proving the trip belongs
-- to the caller. They run as the owner, which means these checks are the whole
-- of the boundary; there is no policy behind them to catch a mistake.
--
-- Every one of them raises on a trip that is not the caller's rather than
-- quietly updating nothing, so a bug in the app surfaces as an error instead
-- of a write that silently went nowhere.
-- -----------------------------------------------------------------------------

/**
 * The caller's own trip, or an exception. Every function below starts here.
 */
create or replace function public.driver_own_trip(p_trip_id uuid)
returns public.trips
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_driver uuid := public.current_driver_id();
  v_trip   public.trips;
begin
  if v_driver is null then
    raise exception 'Only a driver can do that' using errcode = '42501';
  end if;

  select * into v_trip
  from public.trips
  where id = p_trip_id
    and driver_id = v_driver
    and business_id = public.current_business_id();

  if not found then
    raise exception 'That trip is not yours' using errcode = '42501';
  end if;

  return v_trip;
end;
$$;

create or replace function public.driver_log_odometer(
  p_trip_id uuid,
  p_start   integer,
  p_end     integer
)
returns public.trips
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips := public.driver_own_trip(p_trip_id);
  v_row  public.trips;
begin
  if v_trip.status in ('closed', 'cancelled') then
    raise exception 'That trip is closed' using errcode = '42501';
  end if;

  if p_start is not null and p_start < 0 then
    raise exception 'A meter reading cannot be negative' using errcode = '22023';
  end if;

  if p_start is not null and p_end is not null and p_end < p_start then
    raise exception 'The closing reading is below the opening one'
      using errcode = '22023';
  end if;

  update public.trips
     set odometer_start = coalesce(p_start, odometer_start),
         odometer_end   = coalesce(p_end, odometer_end),
         updated_at     = now()
   where id = p_trip_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.driver_set_trip_status(
  p_trip_id uuid,
  p_status  text
)
returns public.trips
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips := public.driver_own_trip(p_trip_id);
  v_row  public.trips;
begin
  -- A driver says "I have started" and "I have delivered". Everything after
  -- that — payment pending, closed — is the office's word, not theirs.
  if p_status not in ('in_transit', 'delivered') then
    raise exception 'A driver cannot set a trip to %', p_status
      using errcode = '42501';
  end if;

  if v_trip.status in ('closed', 'cancelled') then
    raise exception 'That trip is closed' using errcode = '42501';
  end if;

  update public.trips
     set status = p_status, updated_at = now()
   where id = p_trip_id
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.driver_log_expense(
  p_trip_id      uuid,
  p_category     text,
  p_amount       numeric,
  p_payment_mode text default 'cash',
  p_note         text default null,
  p_date         date default null
)
returns public.expenses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips := public.driver_own_trip(p_trip_id);
  v_row  public.expenses;
begin
  -- What a driver spends on the road. Salary, EMI, insurance and the rest are
  -- the office's to record, and are not in this list for that reason.
  if p_category not in ('fuel', 'toll', 'other') then
    raise exception 'A driver cannot log a % expense', p_category
      using errcode = '42501';
  end if;

  if p_category = 'other' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say what the expense was for' using errcode = '23514';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'An amount is needed' using errcode = '23514';
  end if;

  if p_payment_mode not in ('cash', 'upi', 'bank', 'card', 'credit') then
    raise exception 'Unknown payment mode %', p_payment_mode using errcode = '23514';
  end if;

  insert into public.expenses
    (business_id, category, vehicle_id, trip_id, date, amount, payment_mode, note)
  values
    (v_trip.business_id, p_category, v_trip.vehicle_id, v_trip.id,
     coalesce(p_date, current_date), p_amount, p_payment_mode, nullif(btrim(p_note), ''))
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.driver_attach_pod(
  p_trip_id  uuid,
  p_file_url text
)
returns public.trips
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips := public.driver_own_trip(p_trip_id);
  v_row  public.trips;
begin
  if coalesce(btrim(p_file_url), '') = '' then
    raise exception 'No file was given' using errcode = '23514';
  end if;

  -- The path is checked, not trusted: an upload that landed outside this
  -- business's folder must not be recordable against one of its trips.
  if split_part(p_file_url, '/', 1) <> v_trip.business_id::text then
    raise exception 'That file does not belong to this business'
      using errcode = '42501';
  end if;

  update public.trips
     set pod_file_url = p_file_url, updated_at = now()
   where id = p_trip_id
  returning * into v_row;

  insert into public.documents (business_id, owner_type, owner_id, file_url, doc_type)
  values (v_trip.business_id, 'trip', v_trip.id, p_file_url, 'pod');

  return v_row;
end;
$$;

revoke all on function public.driver_own_trip(uuid)                          from public;
revoke all on function public.driver_log_odometer(uuid, integer, integer)    from public;
revoke all on function public.driver_set_trip_status(uuid, text)             from public;
revoke all on function public.driver_log_expense(uuid, text, numeric, text, text, date) from public;
revoke all on function public.driver_attach_pod(uuid, text)                  from public;

grant execute on function public.driver_log_odometer(uuid, integer, integer) to authenticated;
grant execute on function public.driver_set_trip_status(uuid, text)          to authenticated;
grant execute on function public.driver_log_expense(uuid, text, numeric, text, text, date) to authenticated;
grant execute on function public.driver_attach_pod(uuid, text)               to authenticated;

-- -----------------------------------------------------------------------------
-- Storage.
--
-- The read policy written in the storage migration lets anyone in the business
-- read anything in its folder. With a driver in the business that is a leak:
-- the same bucket holds invoice PDFs, insurance papers and licence scans. So
-- both policies are rewritten here — a driver may touch the folder of a trip
-- that is theirs, and their own driver folder, and nothing else.
--
-- Update and delete are deliberately not extended. A proof of delivery that
-- the person who uploaded it can replace or remove afterwards is not evidence
-- of anything.
--
-- Same ownership dance as the storage migration, and the same reason for it:
-- on a hosted project storage.objects belongs to supabase_storage_admin, and
-- if this connection cannot become that role the migration must warn and carry
-- on rather than take everything after it down. Where that happens, the
-- policies here are in supabase/storage-policies.sql, to be run once by hand.
-- -----------------------------------------------------------------------------
create or replace function public.driver_may_touch_object(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_driver uuid := public.current_driver_id();
  parts    text[];
begin
  if v_driver is null then
    return false;
  end if;

  parts := storage.foldername(object_name);

  if parts[1] is distinct from public.current_business_id()::text then
    return false;
  end if;

  -- Their own licence and papers.
  if parts[2] = 'driver' then
    return parts[3] = v_driver::text;
  end if;

  -- A trip that is theirs. Read directly rather than through my_trips, so a
  -- cancelled trip's photo stays reachable to the person who took it.
  if parts[2] = 'trip' then
    return exists (
      select 1 from public.trips
      where id::text = parts[3] and driver_id = v_driver
    );
  end if;

  return false;
end;
$$;

revoke all on function public.driver_may_touch_object(text) from public;
grant execute on function public.driver_may_touch_object(text) to authenticated;

do $$
declare
  v_owner name;
  v_can_manage boolean := false;
begin
  select pg_get_userbyid(c.relowner) into v_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects';

  if v_owner is null then
    raise warning
      'Storage is not enabled on this project, so a driver cannot attach a '
      'delivery photo. Everything else in the driver app works.';
    return;
  end if;

  if v_owner = current_user then
    v_can_manage := true;
  elsif pg_has_role(current_user, v_owner, 'MEMBER') then
    execute format('set role %I', v_owner);
    v_can_manage := true;
  end if;

  if not v_can_manage then
    raise warning
      'Storage policies were NOT updated for drivers: % owns storage.objects '
      'and % is not a member of it. A driver cannot attach a delivery photo, '
      'and — more importantly — the read policy still lets any member of the '
      'business read any file in it. Run supabase/storage-policies.sql as a '
      'role that owns storage.objects.', v_owner, current_user;
    return;
  end if;

  execute $p$
    drop policy if exists documents_read on storage.objects;
    create policy documents_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_business_id()::text
        and (
          public.current_user_role() in ('owner', 'helper', 'ca')
          or public.driver_may_touch_object(name)
        )
      );
  $p$;

  execute $p$
    drop policy if exists documents_upload on storage.objects;
    create policy documents_upload on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_business_id()::text
        and (
          public.current_user_role() in ('owner', 'helper')
          or public.driver_may_touch_object(name)
        )
      );
  $p$;

  reset role;
end;
$$;
