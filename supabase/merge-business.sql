-- Move one set of books into another.
--
-- For the case the app cannot fix by itself: an account created its own
-- business by accident AND entered real work in it. An invitation will absorb
-- an empty business automatically; one with trips in it needs a decision,
-- because merging is not reversible.
--
-- Run supabase/who-sees-what.sql first. It gives you the two business ids and
-- tells you which one holds what.
--
-- This runs as one transaction: either everything moves or nothing does. If it
-- stops on a duplicate key, the same registration number, invoice number or
-- client name exists in both sets of books. Rename one of the two and run it
-- again.
--
-- One thing to look at afterwards: a moved account keeps the role it had. The
-- person who started the other books was their owner, so they arrive as an
-- owner of yours. Step 4 prints everybody's role; to change one:
--
--   update public.users set role = 'helper' where name = 'Dinesh';
--
-- Back up first: Supabase dashboard → Database → Backups.

-- 1. The two ids. Edit these, and nothing else in this file.
select
  set_config('merge.from', 'PASTE-THE-BOOKS-TO-EMPTY', false),
  set_config('merge.into', 'PASTE-THE-BOOKS-TO-KEEP',  false);

-- 2. Look before you leap. Nothing has moved yet.
select 'moving out of' as direction, b.name, b.id,
       (select count(*) from public.trips    t where t.business_id = b.id) as trips,
       (select count(*) from public.expenses e where e.business_id = b.id) as expenses,
       (select count(*) from public.invoices i where i.business_id = b.id) as invoices,
       (select count(*) from public.users    u where u.business_id = b.id) as people
from public.businesses b where b.id = current_setting('merge.from')::uuid
union all
select 'into', b.name, b.id,
       (select count(*) from public.trips    t where t.business_id = b.id),
       (select count(*) from public.expenses e where e.business_id = b.id),
       (select count(*) from public.invoices i where i.business_id = b.id),
       (select count(*) from public.users    u where u.business_id = b.id)
from public.businesses b where b.id = current_setting('merge.into')::uuid;

-- 3. The move. Stop here if the two rows above are not the ones you meant.
do $$
declare
  v_from uuid := current_setting('merge.from')::uuid;
  v_into uuid := current_setting('merge.into')::uuid;
  t text;
  n bigint;
begin
  if v_from = v_into then
    raise exception 'The two ids are the same.';
  end if;
  if not exists (select 1 from public.businesses where id = v_into) then
    raise exception 'The business to keep does not exist. Check the id.';
  end if;

  -- Every table that carries a business_id, the business row itself aside.
  -- invoice_counters is not moved: it is a number series, and the one in the
  -- books being kept carries on. It is removed with the rest below.
  foreach t in array array[
    'trips', 'trip_stops', 'expenses', 'invoices', 'credit_debit_notes',
    'payments', 'vehicles', 'drivers', 'clients', 'brokers', 'quotations',
    'driver_advances', 'driver_salary_payments', 'opening_balances',
    'vehicle_maintenance_log', 'insurance_claims', 'documents',
    'consignments', 'service_schedules', 'audit_log', 'users'
  ]
  loop
    execute format(
      'update public.%I set business_id = $1 where business_id = $2', t
    ) using v_into, v_from;
    get diagnostics n = row_count;
    if n > 0 then
      raise notice 'moved % row(s) of %', n, t;
    end if;
  end loop;

  -- Anything left belonging to the old books goes with them.
  delete from public.invites where business_id = v_from;
  delete from public.invoice_counters where business_id = v_from;
  delete from public.businesses where id = v_from;

  raise notice 'done — the old books are gone and everything is in one place';
end;
$$;

-- 4. Check. Everyone should now show the same business — and read the roles:
--    whoever owned the old books still says "owner" here.
select u.name as "user", u.role, b.name as "business"
from public.users u join public.businesses b on b.id = u.business_id
order by b.name, u.created_at;
