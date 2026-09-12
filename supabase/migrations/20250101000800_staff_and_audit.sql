-- =============================================================================
-- Phase 5b — staff invitations and the audit trail
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The signed-in account's email address.
--
-- SECURITY DEFINER because `authenticated` has no read on auth.users. Reading
-- the table rather than auth.jwt() ->> 'email' means an invite cannot be
-- claimed by forging a claim.
-- -----------------------------------------------------------------------------
create or replace function public.current_email()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select email from auth.users where id = auth.uid();
$$;

revoke all on function public.current_email() from public;
grant execute on function public.current_email() to authenticated;

-- -----------------------------------------------------------------------------
-- invites — how an owner adds a helper or a CA.
--
-- The owner cannot create the other person's auth account, and the anon key
-- cannot reach the admin API. So the invite is recorded here against an email
-- address; the invitee signs up themselves and claims it, which is also what
-- proves they control that address.
--
-- Owners are deliberately not invitable: a second owner should be a deliberate
-- act on an existing staff row, not something an email can grant.
-- -----------------------------------------------------------------------------
create table if not exists public.invites (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  email          text not null,
  name           text,
  role           text not null check (role in ('helper', 'ca')),
  invited_by     uuid references auth.users (id) on delete set null,
  accepted_at    timestamptz,
  accepted_by    uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Stored lowercase so a claim cannot miss because of capitalisation.
create index if not exists invites_email_idx on public.invites (lower(email));
create index if not exists invites_business_idx on public.invites (business_id);

-- One pending invite per email per business; accepted ones stay as a record.
create unique index if not exists invites_pending_unique
  on public.invites (business_id, lower(email))
  where accepted_at is null;

drop trigger if exists set_updated_at on public.invites;
create trigger set_updated_at before update on public.invites
  for each row execute function public.set_updated_at();

alter table public.invites enable row level security;

-- An invitee has no profile row yet, so current_business_id() is null for
-- them. They can still see an invite addressed to their own email, which is
-- what lets the app offer to claim it.
drop policy if exists invites_select on public.invites;
create policy invites_select on public.invites
  for select to authenticated
  using (
    business_id = public.current_business_id()
    or lower(email) = lower(coalesce(public.current_email(), ''))
  );

drop policy if exists invites_insert on public.invites;
create policy invites_insert on public.invites
  for insert to authenticated
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists invites_update on public.invites;
create policy invites_update on public.invites
  for update to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists invites_delete on public.invites;
create policy invites_delete on public.invites
  for delete to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  );

-- -----------------------------------------------------------------------------
-- claim_invite — the invitee joins the business.
--
-- Only ever creates the caller's own users row, only from an invite matching
-- the caller's own verified email, only once, and only at the role the invite
-- names — so it cannot be used to join a business uninvited or to arrive as an
-- owner.
-- -----------------------------------------------------------------------------
create or replace function public.claim_invite()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_invite public.invites;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if exists (select 1 from public.users where id = v_uid) then
    raise exception 'this account already belongs to a business';
  end if;

  v_email := public.current_email();
  if coalesce(v_email, '') = '' then
    raise exception 'this account has no email address to match an invitation against';
  end if;

  select * into v_invite
  from public.invites
  where lower(email) = lower(v_email)
    and accepted_at is null
  order by created_at
  limit 1;

  if v_invite.id is null then
    raise exception 'no pending invitation for %', v_email;
  end if;

  insert into public.users (id, business_id, name, role)
  values (
    v_uid,
    v_invite.business_id,
    coalesce(nullif(btrim(v_invite.name), ''), split_part(v_email, '@', 1)),
    v_invite.role
  );

  update public.invites
  set accepted_at = now(), accepted_by = v_uid
  where id = v_invite.id;

  return v_invite.business_id;
end;
$$;

revoke all on function public.claim_invite() from public;
grant execute on function public.claim_invite() to authenticated;

-- -----------------------------------------------------------------------------
-- Audit trail
--
-- SECURITY DEFINER so it can write audit_log, which no client policy allows
-- inserting into. The business key column is passed as a trigger argument
-- because `businesses` keys on id while every other table uses business_id.
-- -----------------------------------------------------------------------------
create or replace function public.record_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_business_column text := coalesce(TG_ARGV[0], 'business_id');
  v_row jsonb;
  v_old jsonb;
  v_business_id uuid;
  v_record_id uuid;
  v_diff jsonb;
begin
  if TG_OP = 'DELETE' then
    v_row := to_jsonb(old);
    v_diff := v_row;
  elsif TG_OP = 'INSERT' then
    v_row := to_jsonb(new);
    v_diff := v_row;
  else
    v_row := to_jsonb(new);
    v_old := to_jsonb(old);

    -- Only the columns that actually changed, as from/to pairs. Storing the
    -- whole row on every update would make the log unreadable and large.
    -- updated_at changes on every write by definition, so it is not a change.
    select jsonb_object_agg(
             key,
             jsonb_build_object('from', v_old -> key, 'to', v_row -> key)
           )
    into v_diff
    from jsonb_object_keys(v_row) as key
    where (v_row -> key) is distinct from (v_old -> key)
      and key <> 'updated_at';

    -- A write that changed nothing is not worth a log entry.
    if v_diff is null or v_diff = '{}'::jsonb then
      return new;
    end if;
  end if;

  v_business_id := (v_row ->> v_business_column)::uuid;
  v_record_id := (v_row ->> 'id')::uuid;

  insert into public.audit_log (business_id, user_id, table_name, record_id, action, diff)
  values (v_business_id, auth.uid(), TG_TABLE_NAME, v_record_id, lower(TG_OP), v_diff);

  return coalesce(new, old);
end;
$$;

-- Attached to the tables where "who changed this, and when" is a question
-- someone will actually ask: money, master data and access.
do $$
declare
  t text;
begin
  foreach t in array array[
    'trips', 'invoices', 'credit_debit_notes', 'expenses', 'payments',
    'vehicles', 'drivers', 'clients', 'brokers',
    'driver_advances', 'driver_salary_payments',
    'opening_balances', 'consignments', 'service_schedules',
    'vehicle_maintenance_log', 'insurance_claims', 'users', 'invites'
  ]
  loop
    execute format('drop trigger if exists record_audit on public.%I', t);
    execute format(
      'create trigger record_audit after insert or update or delete on public.%I
         for each row execute function public.record_audit()', t);
  end loop;
end;
$$;

-- businesses keys on id, not business_id.
drop trigger if exists record_audit on public.businesses;
create trigger record_audit after insert or update or delete on public.businesses
  for each row execute function public.record_audit('id');

-- -----------------------------------------------------------------------------
-- audit_feed — the log with the actor's name resolved, for the viewer screen.
-- -----------------------------------------------------------------------------
create or replace view public.audit_feed
with (security_invoker = on) as
select
  a.id,
  a.business_id,
  a.user_id,
  u.name        as user_name,
  u.role        as user_role,
  a.table_name,
  a.record_id,
  a.action,
  a.changed_at,
  a.diff
from public.audit_log a
left join public.users u on u.id = a.user_id;

grant select on public.audit_feed to authenticated;
