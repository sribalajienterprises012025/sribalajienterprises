-- =============================================================================
-- An account that made its own business by accident can still join yours.
--
-- The trap: anyone who signs up without an invitation waiting is offered
-- "create your business", and taking that offer starts a separate, empty set
-- of books. From then on the two accounts cannot see each other's work — which
-- is the tenancy rule doing exactly its job, and is indistinguishable from the
-- app being broken.
--
-- Until now claim_invite() refused outright: "this account already belongs to
-- a business". True, and useless — the business it belonged to was one it had
-- created thirty seconds earlier and never used. There was no way out of it
-- from inside the app.
--
-- So an invitation can now absorb such an account, on two conditions that make
-- it safe: the business it is leaving has no work in it at all, and it is the
-- only member. Nothing can be lost, because there is nothing there. A business
-- with so much as one trip in it is refused, and merging those is a decision
-- someone has to make deliberately — see supabase/merge-business.sql.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Replaces the version in the staff-and-audit migration, with one guard added.
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
  -- A deletion of the business row itself cannot be logged: the entry has to
  -- name the business it belongs to, and by the time this runs there is no
  -- such business to name — the insert fails on the foreign key. Nothing is
  -- lost by skipping it, because audit_log cascades from businesses, so every
  -- entry for that business is going the same way in the same statement.
  --
  -- Reached when an account that created its own books by accident accepts an
  -- invitation and its empty business is removed. See claim_invite() below.
  if TG_OP = 'DELETE' and TG_TABLE_NAME = 'businesses' then
    return old;
  end if;

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

/**
 * Has anything at all been entered against this business?
 *
 * Every table that holds work, which is every table carrying a business_id
 * except the bookkeeping ones: users (the members themselves), invites (how
 * they got here), audit_log (a record of nothing, if there is nothing) and
 * invoice_counters (a number series with no invoices under it).
 */
create or replace function public.business_is_empty(p_business_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  t text;
  n bigint;
begin
  foreach t in array array[
    'trips', 'expenses', 'invoices', 'credit_debit_notes', 'payments',
    'vehicles', 'drivers', 'clients', 'brokers', 'quotations',
    'driver_advances', 'driver_salary_payments', 'opening_balances',
    'vehicle_maintenance_log', 'insurance_claims', 'documents',
    'consignments', 'service_schedules'
  ]
  loop
    execute format('select count(*) from public.%I where business_id = $1', t)
      into n using p_business_id;
    if n > 0 then
      return false;
    end if;
  end loop;

  return true;
end;
$$;

revoke all on function public.business_is_empty(uuid) from public, anon, authenticated;

create or replace function public.claim_invite()
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_invite   public.invites;
  v_current  uuid;
  v_members  integer;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select business_id into v_current from public.users where id = v_uid;

  if v_current is not null then
    select count(*) into v_members from public.users where business_id = v_current;

    -- Leaving a business with other people in it is not an invitation's
    -- business, and leaving one with work in it would strand the work.
    if v_members > 1 then
      raise exception
        'This account is already part of a business with other people in it. '
        'Ask its owner to remove your access first.'
        using errcode = '42501';
    end if;

    if not public.business_is_empty(v_current) then
      raise exception
        'This account already has its own books, with work entered in them. '
        'Joining would leave that work behind, so it has to be moved first.'
        using errcode = '42501';
    end if;
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

  if v_current is null then
    insert into public.users (id, business_id, name, role)
    values (
      v_uid,
      v_invite.business_id,
      coalesce(nullif(btrim(v_invite.name), ''), split_part(v_email, '@', 1)),
      v_invite.role
    );
  else
    -- Move first, delete after: users.business_id cascades on delete, so
    -- removing the empty business while the account still points at it would
    -- take the account with it.
    update public.users
       set business_id = v_invite.business_id,
           role        = v_invite.role,
           name        = coalesce(nullif(btrim(v_invite.name), ''), name),
           updated_at  = now()
     where id = v_uid;

    delete from public.invites where business_id = v_current;
    delete from public.businesses where id = v_current;
  end if;

  update public.invites
  set accepted_at = now(), accepted_by = v_uid
  where id = v_invite.id;

  return v_invite.business_id;
end;
$$;

revoke all on function public.claim_invite() from public, anon;
grant execute on function public.claim_invite() to authenticated;
