-- =============================================================================
-- Assertions.
--
-- Every check raises on failure, so the runner exits non-zero on the first
-- problem. Impersonation works the way PostgREST does it: become the
-- `authenticated` role and set the JWT sub claim.
-- =============================================================================

\set ON_ERROR_STOP on
\set biz_a aaaaaaaa-0000-0000-0000-00000000000a
\set owner_a 11111111-0000-0000-0000-000000000001
\set help_a 11111111-0000-0000-0000-000000000002
\set ca_a 11111111-0000-0000-0000-000000000003
\set owner_b 22222222-0000-0000-0000-000000000001
\set cli_a 55555555-0000-0000-0000-000000000001
\set brk_a 66666666-0000-0000-0000-000000000001
\set veh_a 33333333-0000-0000-0000-000000000001
\set drv_a 44444444-0000-0000-0000-000000000001
\set trip1 77777777-0000-0000-0000-000000000001

create or replace function pg_temp.expect(
  label text, actual anyelement, expected anyelement
) returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception '% : expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok   %  (%)', label, actual;
end;
$$;

/**
 * Asserts a statement raises. Correct for INSERT, where a failed WITH CHECK is
 * an error, and for CHECK-constraint violations.
 */
create or replace function pg_temp.expect_denied(
  label text, stmt text
) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok   %  (blocked: %)', label, replace(sqlerrm, E'\n', ' ');
    return;
  end;
  raise exception '% : statement was allowed but should have been blocked', label;
end;
$$;

/**
 * Asserts a statement changes nothing.
 *
 * UPDATE and DELETE behave differently from INSERT under RLS: a row the USING
 * clause excludes is simply not visible to the statement, so it matches zero
 * rows and returns without error. Checking for an exception there would pass
 * for the wrong reason, or fail on a policy that is in fact working — so the
 * probe below reads the value back and asserts it is untouched.
 */
create or replace function pg_temp.expect_no_write(
  label text, stmt text, probe text, expected text
) returns void language plpgsql as $$
declare
  actual text;
  raised text;
begin
  begin
    execute stmt;
  exception when others then
    raised := replace(sqlerrm, E'\n', ' ');
  end;

  execute probe into actual;

  if actual is distinct from expected then
    raise exception '% : write took effect — probe returned %, expected %',
      label, actual, expected;
  end if;

  raise notice 'ok   %  (%)', label,
    coalesce('blocked: ' || raised, 'no rows affected');
end;
$$;

-- =============================================================================
-- Tenancy: business A cannot see business B
-- =============================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

select pg_temp.expect('owner A sees only own vehicles',
  (select count(*)::int from public.vehicles), 1);
select pg_temp.expect('owner A sees only own clients',
  (select count(*)::int from public.clients), 1);
select pg_temp.expect('owner A sees only own business row',
  (select count(*)::int from public.businesses), 1);
-- Five: the owner, the helper, the CA and the two drivers with logins.
select pg_temp.expect('owner A sees own staff',
  (select count(*)::int from public.users), 5);

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_b', false);

select pg_temp.expect('owner B sees only own vehicles',
  (select count(*)::int from public.vehicles), 1);
select pg_temp.expect('owner B cannot see A''s trips',
  (select count(*)::int from public.trips), 0);
select pg_temp.expect('owner B ledger shows only own clients',
  (select count(*)::int from public.client_ledger), 1);

-- A cross-tenant write must be refused, not silently redirected.
select pg_temp.expect_denied('owner B cannot insert into business A',
  format('insert into public.vehicles (business_id, reg_no) values (%L, ''X'')', :'biz_a'));

-- =============================================================================
-- Roles
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'help_a', false);

select pg_temp.expect('helper reads masters',
  (select count(*)::int from public.vehicles), 1);

-- Helper writes trips and expenses, but not master data.
insert into public.trips (business_id, party_type, party_id, pickup, drop_location, freight_amount)
values (:'biz_a', 'client', :'cli_a', 'Warangal', 'Karimnagar', 12000);
select pg_temp.expect('helper can create a trip',
  (select count(*)::int from public.trips), 3);

insert into public.expenses (business_id, category, date, amount, payment_mode)
values (:'biz_a', 'toll', current_date, 500, 'cash');
select pg_temp.expect('helper can create an expense',
  (select count(*)::int from public.expenses), 3);

select pg_temp.expect_denied('helper cannot add a vehicle',
  format('insert into public.vehicles (business_id, reg_no) values (%L, ''TS 00 AA 0000'')', :'biz_a'));
select pg_temp.expect_denied('helper cannot add a client',
  format('insert into public.clients (business_id, name) values (%L, ''Nope'')', :'biz_a'));
select pg_temp.expect_no_write('helper cannot edit business settings',
  format('update public.businesses set name = ''Hacked'' where id = %L', :'biz_a'),
  format('select name from public.businesses where id = %L', :'biz_a'),
  'Balaji Enterprises');

-- Clean up the helper's rows so later totals stay predictable.
reset role;
delete from public.trips where pickup = 'Warangal';
delete from public.expenses where category = 'toll' and amount = 500;

set role authenticated;
select set_config('request.jwt.claim.sub', :'ca_a', false);

select pg_temp.expect('CA reads trips',
  (select count(*)::int from public.trips), 2);
select pg_temp.expect('CA reads ledgers',
  (select count(*)::int from public.client_ledger), 1);
select pg_temp.expect_denied('CA cannot create a trip',
  format('insert into public.trips (business_id, party_type, party_id, pickup, drop_location)
          values (%L, ''client'', %L, ''A'', ''B'')', :'biz_a', :'cli_a'));
select pg_temp.expect_denied('CA cannot log an expense',
  format('insert into public.expenses (business_id, category, amount) values (%L, ''fuel'', 100)', :'biz_a'));
select pg_temp.expect_no_write('CA cannot delete a trip',
  format('delete from public.trips where id = %L', :'trip1'),
  format('select count(*)::text from public.trips where id = %L', :'trip1'),
  '1');

-- Owners must not be able to demote themselves out of the only owner seat.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);
select pg_temp.expect_no_write('owner cannot demote self',
  format('update public.users set role = ''helper'' where id = %L', :'owner_a'),
  format('select role from public.users where id = %L', :'owner_a'),
  'owner');

-- =============================================================================
-- Ledger arithmetic
--
-- Client A: opening 12,000 + unbilled freight 50,000 - advance 10,000
--           - TDS 1,000 = 51,000
-- =============================================================================
select pg_temp.expect('client ledger balance',
  (select balance::numeric from public.client_ledger where client_id = :'cli_a'), 51000::numeric);
select pg_temp.expect('client ledger counts unbilled freight',
  (select unbilled_freight::numeric from public.client_ledger where client_id = :'cli_a'), 50000::numeric);

-- Broker A: freight 60,000 receivable, 2,400 commission payable.
select pg_temp.expect('broker freight receivable',
  (select freight_receivable::numeric from public.broker_ledger where broker_id = :'brk_a'), 60000::numeric);
select pg_temp.expect('broker commission payable',
  (select commission_payable::numeric from public.broker_ledger where broker_id = :'brk_a'), 2400::numeric);
select pg_temp.expect('broker net balance',
  (select net_balance::numeric from public.broker_ledger where broker_id = :'brk_a'), 57600::numeric);

-- Driver A: one unadjusted 3,000 advance, no salary run yet.
select pg_temp.expect('driver advances outstanding',
  (select advances_outstanding::numeric from public.driver_ledger where driver_id = :'drv_a'), 3000::numeric);

-- Trip 1: freight 50,000 - commission 0 - trip expenses 8,000 = 42,000.
-- The 5,000 office expense is not booked to a trip, so it must not appear.
select pg_temp.expect('trip margin counts only trip expenses',
  (select net_margin::numeric from public.trip_financials where trip_id = :'trip1'), 42000::numeric);
select pg_temp.expect('trip balance due',
  (select balance_due::numeric from public.trip_financials where trip_id = :'trip1'), 39000::numeric);
select pg_temp.expect('trip distance',
  (select distance_km::int from public.trip_financials where trip_id = :'trip1'), 750);

-- =============================================================================
-- Invoicing: a receipt moves the ledger, and an invoice replaces raw freight
-- rather than adding to it
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

select pg_temp.expect('financial year label',
  public.fy_label(:'biz_a', '2025-09-12'::date), '2025-26');
select pg_temp.expect('FY label before April rolls back',
  public.fy_label(:'biz_a', '2025-02-12'::date), '2024-25');

select pg_temp.expect('first GST invoice number',
  public.next_invoice_number(:'biz_a', 'gst', '2025-09-12'::date), 'GST/2025-26/0001');
select pg_temp.expect('invoice numbers increment',
  public.next_invoice_number(:'biz_a', 'gst', '2025-09-12'::date), 'GST/2025-26/0002');
select pg_temp.expect('non-GST has its own series',
  public.next_invoice_number(:'biz_a', 'non_gst', '2025-09-12'::date), 'NG/2025-26/0001');
select pg_temp.expect('a new FY restarts numbering',
  public.next_invoice_number(:'biz_a', 'gst', '2026-05-01'::date), 'GST/2026-27/0001');

-- Bill trip 1 at 5% GST: 50,000 taxable + 2,500 tax = 52,500.
insert into public.invoices (
  business_id, trip_id, party_type, party_id, invoice_type, invoice_number,
  invoice_date, taxable_value, tax_amount, amount, gst_rate, place_of_supply,
  tax_breakup, status
) values (
  :'biz_a', :'trip1', 'client', :'cli_a', 'gst', 'GST/2025-26/0100',
  current_date, 50000, 2500, 52500, 5, '27',
  '{"igst_rate": 5, "igst_amount": 2500}'::jsonb, 'unpaid'
);

-- 12,000 opening + 52,500 invoiced - 10,000 advance - 1,000 TDS = 53,500.
-- The 50,000 raw freight must have dropped out now that the trip is billed.
select pg_temp.expect('invoice replaces unbilled freight',
  (select unbilled_freight::numeric from public.client_ledger where client_id = :'cli_a'), 0::numeric);
select pg_temp.expect('ledger picks up the invoice',
  (select balance::numeric from public.client_ledger where client_id = :'cli_a'), 53500::numeric);

insert into public.payments (business_id, party_type, party_id, direction, date, amount, mode)
values (:'biz_a', 'client', :'cli_a', 'in', current_date, 30000, 'bank');

select pg_temp.expect('receipt reduces the balance',
  (select balance::numeric from public.client_ledger where client_id = :'cli_a'), 23500::numeric);

-- A credit note for a short delivery reduces it further.
insert into public.credit_debit_notes (business_id, invoice_id, party_type, party_id, type, amount, reason)
select :'biz_a', id, 'client', :'cli_a', 'credit', 1500, 'Short delivery'
from public.invoices where invoice_number = 'GST/2025-26/0100';

select pg_temp.expect('credit note reduces the balance',
  (select balance::numeric from public.client_ledger where client_id = :'cli_a'), 22000::numeric);

-- A cancelled invoice must leave the ledger entirely.
update public.invoices set status = 'cancelled' where invoice_number = 'GST/2025-26/0100';
select pg_temp.expect('cancelled invoice drops out, freight returns',
  (select unbilled_freight::numeric from public.client_ledger where client_id = :'cli_a'), 50000::numeric);
update public.invoices set status = 'unpaid' where invoice_number = 'GST/2025-26/0100';

-- Numbering is scoped per business, so B starts its own series at 0001.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_b', false);
select pg_temp.expect('numbering is per business',
  public.next_invoice_number('bbbbbbbb-0000-0000-0000-00000000000b', 'gst', '2025-09-12'::date),
  'GST/2025-26/0001');
select pg_temp.expect_denied('cannot allocate a number for another business',
  format('select public.next_invoice_number(%L, ''gst'')', :'biz_a'));

-- =============================================================================
-- Constraints the forms rely on
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

select pg_temp.expect_denied('odometer order enforced',
  format('insert into public.trips (business_id, party_type, party_id, pickup, drop_location,
          odometer_start, odometer_end) values (%L, ''client'', %L, ''A'', ''B'', 500, 100)',
         :'biz_a', :'cli_a'));
select pg_temp.expect_denied('negative freight rejected',
  format('insert into public.trips (business_id, party_type, party_id, pickup, drop_location,
          freight_amount) values (%L, ''client'', %L, ''A'', ''B'', -1)', :'biz_a', :'cli_a'));
select pg_temp.expect_denied('unknown expense category rejected',
  format('insert into public.expenses (business_id, category, amount) values (%L, ''bribes'', 100)', :'biz_a'));
select pg_temp.expect_denied('duplicate registration rejected',
  format('insert into public.vehicles (business_id, reg_no) values (%L, ''TS 07 UB 4512'')', :'biz_a'));
select pg_temp.expect_denied('unknown trip status rejected',
  format('update public.trips set status = ''teleported'' where id = %L', :'trip1'));

-- =============================================================================
-- Storage: the tenant key in the object path is enforced
-- =============================================================================
select pg_temp.expect('documents bucket is private',
  (select public from storage.buckets where id = 'documents'), false);

insert into storage.objects (bucket_id, name)
values ('documents', 'aaaaaaaa-0000-0000-0000-00000000000a/trip/x/pod.jpg');
select pg_temp.expect('can upload under own business folder',
  (select count(*)::int from storage.objects), 1);

select pg_temp.expect_denied('cannot upload under another business folder',
  'insert into storage.objects (bucket_id, name)
   values (''documents'', ''bbbbbbbb-0000-0000-0000-00000000000b/trip/x/pod.jpg'')');

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_b', false);
select pg_temp.expect('cannot read another business''s files',
  (select count(*)::int from storage.objects), 0);

-- =============================================================================
-- bootstrap_business
-- =============================================================================
reset role;
insert into auth.users (id, email)
values ('99999999-0000-0000-0000-000000000009', 'fresh@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', '99999999-0000-0000-0000-000000000009', false);
select pg_temp.expect('fresh account has no profile',
  (select count(*)::int from public.users), 0);

select public.bootstrap_business('New Transport Co', 'Fresh Owner') is not null as bootstrapped;
select pg_temp.expect('bootstrap creates the owner profile',
  (select role from public.users where id = '99999999-0000-0000-0000-000000000009'), 'owner');
select pg_temp.expect_denied('bootstrap cannot run twice',
  'select public.bootstrap_business(''Another Co'', ''Same Owner'')');

reset role;

-- =============================================================================
-- Phase 3 — distribution planning
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

-- 60 tonnes ordered, dispatched across two trucks.
insert into public.consignments (
  id, business_id, reference, party_type, party_id, goods_description,
  total_quantity, unit, pickup, drop_location, planned_date
) values (
  '88888888-0000-0000-0000-000000000001', :'biz_a', 'CON-001', 'client', :'cli_a',
  'Cement bags', 60, 'tonnes', 'Hyderabad', 'Nagpur', current_date
);

insert into public.trips (
  business_id, vehicle_id, party_type, party_id, pickup, drop_location,
  trip_date, freight_amount, consignment_id, planned_quantity, status
) values
  (:'biz_a', :'veh_a', 'client', :'cli_a', 'Hyderabad', 'Nagpur',
   current_date, 40000, '88888888-0000-0000-0000-000000000001', 20, 'delivered'),
  (:'biz_a', :'veh_a', 'client', :'cli_a', 'Hyderabad', 'Nagpur',
   current_date, 40000, '88888888-0000-0000-0000-000000000001', 20, 'booked');

select pg_temp.expect('consignment counts its trips',
  (select trip_count::int from public.consignment_progress
   where id = '88888888-0000-0000-0000-000000000001'), 2);
select pg_temp.expect('consignment sums dispatched quantity',
  (select dispatched_quantity::numeric from public.consignment_progress
   where id = '88888888-0000-0000-0000-000000000001'), 40::numeric);
select pg_temp.expect('consignment computes what is left',
  (select pending_quantity::numeric from public.consignment_progress
   where id = '88888888-0000-0000-0000-000000000001'), 20::numeric);
select pg_temp.expect('consignment counts only delivered trips as delivered',
  (select delivered_count::int from public.consignment_progress
   where id = '88888888-0000-0000-0000-000000000001'), 1);

-- Two trips on one vehicle for one day is a double-booking the grid must flag.
select pg_temp.expect('utilisation spots a double-booked day',
  (select trip_count::int from public.vehicle_utilisation
   where vehicle_id = :'veh_a' and trip_date = current_date), 2);

-- Multi-stop: a trip that loads twice and drops three times.
insert into public.trip_stops (business_id, trip_id, sequence, stop_type, location, quantity, unit)
values
  (:'biz_a', :'trip1', 1, 'pickup', 'Godown A', 10, 'tonnes'),
  (:'biz_a', :'trip1', 2, 'pickup', 'Godown B', 6, 'tonnes'),
  (:'biz_a', :'trip1', 3, 'drop', 'Shop 1', 5, 'tonnes'),
  (:'biz_a', :'trip1', 4, 'drop', 'Shop 2', 6, 'tonnes'),
  (:'biz_a', :'trip1', 5, 'drop', 'Shop 3', 5, 'tonnes');

select pg_temp.expect('stops are recorded in order',
  (select count(*)::int from public.trip_stops where trip_id = :'trip1'), 5);
select pg_temp.expect('first stop is the first pickup',
  (select location from public.trip_stops
   where trip_id = :'trip1' order by sequence limit 1), 'Godown A');

select pg_temp.expect_denied('two stops cannot share a position',
  format('insert into public.trip_stops (business_id, trip_id, sequence, stop_type, location)
          values (%L, %L, 1, ''drop'', ''Clash'')', :'biz_a', :'trip1'));
select pg_temp.expect_denied('stop sequence must be positive',
  format('insert into public.trip_stops (business_id, trip_id, sequence, stop_type, location)
          values (%L, %L, 0, ''drop'', ''Zero'')', :'biz_a', :'trip1'));

-- Helpers update stops as a driver calls them in, but do not plan consignments.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'help_a', false);

update public.trip_stops set status = 'completed', reached_at = now()
where trip_id = :'trip1' and sequence = 1;
select pg_temp.expect('helper can complete a stop',
  (select status from public.trip_stops where trip_id = :'trip1' and sequence = 1),
  'completed');

select pg_temp.expect_denied('helper cannot plan a consignment',
  format('insert into public.consignments (business_id, party_type, party_id, pickup, drop_location)
          values (%L, ''client'', %L, ''A'', ''B'')', :'biz_a', :'cli_a'));

-- Deleting a trip must take its stops with it, not orphan them.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);
delete from public.trips where consignment_id = '88888888-0000-0000-0000-000000000001';
select pg_temp.expect('consignment survives its trips being deleted',
  (select trip_count::int from public.consignment_progress
   where id = '88888888-0000-0000-0000-000000000001'), 0);

-- Tenancy again, on the new tables.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_b', false);
select pg_temp.expect('owner B sees no consignments of A',
  (select count(*)::int from public.consignments), 0);
select pg_temp.expect('owner B sees no stops of A',
  (select count(*)::int from public.trip_stops), 0);
select pg_temp.expect('owner B sees no utilisation of A',
  (select count(*)::int from public.vehicle_utilisation), 0);

reset role;

-- =============================================================================
-- Phase 4 — report views
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

-- Seed state at this point, all in the current month:
--   trips     50,000 + 60,000 freight, 2,400 broker commission, 1,000 TDS
--   expenses  8,000 fuel (on trip 1) + 5,000 office
--   invoice   52,500 GST at 5% (IGST 2,500), one 1,500 credit note
select pg_temp.expect('P&L freight for the month',
  (select freight::numeric from public.monthly_pl
   where month = date_trunc('month', current_date)::date), 110000::numeric);
select pg_temp.expect('P&L expense total',
  (select expenses_total::numeric from public.monthly_pl
   where month = date_trunc('month', current_date)::date), 13000::numeric);
select pg_temp.expect('P&L splits fuel out',
  (select fuel::numeric from public.monthly_pl
   where month = date_trunc('month', current_date)::date), 8000::numeric);
select pg_temp.expect('P&L keeps broker commission separate',
  (select broker_commission::numeric from public.monthly_pl
   where month = date_trunc('month', current_date)::date), 2400::numeric);
-- 110,000 freight - 2,400 commission - 13,000 expenses = 94,600
select pg_temp.expect('P&L net profit',
  (select net_profit::numeric from public.monthly_pl
   where month = date_trunc('month', current_date)::date), 94600::numeric);

-- A month with an expense but no trip must still appear, or it drops out of
-- the P&L entirely.
insert into public.expenses (business_id, category, date, amount, payment_mode)
values (:'biz_a', 'maintenance', current_date - interval '4 months', 26000, 'bank');
select pg_temp.expect('a month with expenses but no trips still appears',
  (select expenses_total::numeric from public.monthly_pl
   where month = date_trunc('month', current_date - interval '4 months')::date),
  26000::numeric);
select pg_temp.expect('that month shows a loss',
  (select net_profit::numeric from public.monthly_pl
   where month = date_trunc('month', current_date - interval '4 months')::date),
  -26000::numeric);

-- A salary run must not be deducted twice when a salary expense also exists.
insert into public.driver_salary_payments (
  business_id, driver_id, period_month, salary_earned, advances_deducted,
  other_deductions, net_payable, amount_paid
) values (
  :'biz_a', :'drv_a', date_trunc('month', current_date)::date,
  22000, 3000, 0, 19000, 19000
);
insert into public.expenses (business_id, category, date, amount, payment_mode)
values (:'biz_a', 'salary', current_date, 19000, 'bank');

-- The run above: the driver earned 22,000, of which 3,000 recovered an earlier
-- advance, leaving 19,000 to hand over.
--
-- The cost of that month's driving is 22,000. The 3,000 advance had already
-- left the business and is booked nowhere else -- driver_advances is not an
-- expense table -- so charging only the 19,000 net would lose it, and overstate
-- profit by exactly the advance. This assertion previously expected 75,600,
-- which was that mistake written down as a rule.
--
-- expenses_total is now 32,000 (13,000 + 19,000); net_profit adds the 19,000
-- salary expense back so it is not deducted twice, and deducts what was earned:
-- 110,000 - 2,400 - 32,000 + 19,000 - 22,000 = 72,600
select pg_temp.expect('salary counted once, not twice',
  (select net_profit::numeric from public.monthly_pl
   where month = date_trunc('month', current_date)::date), 72600::numeric);

select pg_temp.expect('the P&L charges what the driver earned, not what was left after an advance',
  (select driver_salaries::numeric from public.monthly_pl
   where month = date_trunc('month', current_date)::date), 22000::numeric);

select pg_temp.expect('the driver ledger reports earnings as earnings',
  (select salary_earned::numeric from public.driver_ledger
   where driver_id = :'drv_a'), 22000::numeric);

-- Still to hand over: 19,000 payable on the run, all of it paid.
select pg_temp.expect('salary due is net of the advance the run recovered',
  (select salary_due::numeric from public.driver_ledger
   where driver_id = :'drv_a'), 0::numeric);

-- GST summary
select pg_temp.expect('GST summary taxable value',
  (select taxable_value::numeric from public.gst_summary
   where month = date_trunc('month', current_date)::date and gst_rate = 5), 50000::numeric);
select pg_temp.expect('GST summary reads IGST out of the breakup jsonb',
  (select igst::numeric from public.gst_summary
   where month = date_trunc('month', current_date)::date and gst_rate = 5), 2500::numeric);
select pg_temp.expect('GST summary excludes non-GST invoices',
  (select count(*)::int from public.gst_summary), 1);

-- Vehicle economics. Trip 1 covered 750 km; trip 2 has no closing reading.
-- Vehicle expenses: 8,000 fuel + 26,000 maintenance = 34,000 across two months.
select pg_temp.expect('vehicle distance for the month',
  (select distance_km::int from public.vehicle_monthly
   where vehicle_id = :'veh_a' and month = date_trunc('month', current_date)::date), 750);
select pg_temp.expect('vehicle cost per km',
  (select cost_per_km::numeric from public.vehicle_monthly
   where vehicle_id = :'veh_a' and month = date_trunc('month', current_date)::date),
  10.67::numeric);
select pg_temp.expect('vehicle revenue per km',
  (select revenue_per_km::numeric from public.vehicle_monthly
   where vehicle_id = :'veh_a' and month = date_trunc('month', current_date)::date),
  146.67::numeric);
-- The maintenance month has no trips, so no per-km figure can be computed.
select pg_temp.expect('no distance means no cost per km',
  (select cost_per_km from public.vehicle_monthly
   where vehicle_id = :'veh_a'
     and month = date_trunc('month', current_date - interval '4 months')::date),
  null::numeric);

-- Compliance gaps. Trip 2 is GST with no LR, no e-way bill, no POD and no
-- invoice, so it must be flagged on all four counts.
select pg_temp.expect('compliance flags a trip with no paperwork',
  (select count(*)::int from public.compliance_gaps
   where missing_lr and missing_eway and missing_pod and not_invoiced), 1);
-- Trip 1 has an LR and an e-way bill and is invoiced, but no POD on file.
select pg_temp.expect('compliance flags a missing POD on its own',
  (select missing_pod from public.compliance_gaps where trip_id = :'trip1'), true);
select pg_temp.expect('compliance does not flag an LR that is present',
  (select missing_lr from public.compliance_gaps where trip_id = :'trip1'), false);

-- Reports are exactly what a CA needs, and a CA is read-only.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'ca_a', false);
select pg_temp.expect('CA can read the P&L',
  (select count(*)::int > 0 from public.monthly_pl), true);
select pg_temp.expect('CA can read the GST summary',
  (select count(*)::int > 0 from public.gst_summary), true);
select pg_temp.expect('CA can read compliance gaps',
  (select count(*)::int > 0 from public.compliance_gaps), true);

-- And the reports respect tenancy like everything else.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_b', false);
select pg_temp.expect('owner B sees no P&L of A',
  (select count(*)::int from public.monthly_pl), 0);
select pg_temp.expect('owner B sees no GST of A',
  (select count(*)::int from public.gst_summary), 0);
select pg_temp.expect('owner B sees no vehicle economics of A',
  (select count(*)::int from public.vehicle_monthly), 0);
select pg_temp.expect('owner B sees no compliance gaps of A',
  (select count(*)::int from public.compliance_gaps), 0);

reset role;

-- =============================================================================
-- Phase 5 — asset care
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

-- The vehicle sits at 180,000 km (the seed). Three schedules, deliberately
-- at different distances from due.
insert into public.service_schedules (
  id, business_id, vehicle_id, service_type, interval_km, last_done_odometer, last_done_date
) values
  ('99990000-0000-0000-0000-000000000001', :'biz_a', :'veh_a', 'engine_oil',
   15000, 170000, current_date - 60),
  ('99990000-0000-0000-0000-000000000002', :'biz_a', :'veh_a', 'general_service',
   20000, 165000, current_date - 90),
  ('99990000-0000-0000-0000-000000000003', :'biz_a', :'veh_a', 'tyre_rotation',
   10000, 179500, current_date - 10);

-- engine_oil due at 185,000; 5,000 km to go
select pg_temp.expect('service due computes the odometer it falls due at',
  (select due_at_odometer::int from public.service_due
   where id = '99990000-0000-0000-0000-000000000001'), 185000);
select pg_temp.expect('service due computes km remaining',
  (select km_remaining::int from public.service_due
   where id = '99990000-0000-0000-0000-000000000001'), 5000);
select pg_temp.expect('a service 5000 km away is ok',
  (select status from public.service_due
   where id = '99990000-0000-0000-0000-000000000001'), 'ok');

-- general_service due at 185,000 too... no: 165,000 + 20,000 = 185,000.
-- tyre_rotation due at 189,500 - wait, 179,500 + 10,000 = 189,500, so 9,500 to go.
select pg_temp.expect('tyre rotation km remaining',
  (select km_remaining::int from public.service_due
   where id = '99990000-0000-0000-0000-000000000003'), 9500);

-- Push the odometer past a due point and the status must follow.
update public.vehicles set current_odometer = 184500 where id = :'veh_a';
select pg_temp.expect('within 1000 km reads due soon',
  (select status from public.service_due
   where id = '99990000-0000-0000-0000-000000000001'), 'due_soon');

update public.vehicles set current_odometer = 186000 where id = :'veh_a';
select pg_temp.expect('past the due point reads overdue',
  (select status from public.service_due
   where id = '99990000-0000-0000-0000-000000000001'), 'overdue');

-- A day-interval schedule comes due on time even with no kilometres.
insert into public.service_schedules (
  id, business_id, vehicle_id, service_type, interval_days, last_done_date
) values (
  '99990000-0000-0000-0000-000000000004', :'biz_a', :'veh_a', 'greasing',
  30, current_date - 29
);
select pg_temp.expect('a day-interval schedule reads due soon at 1 day left',
  (select status from public.service_due
   where id = '99990000-0000-0000-0000-000000000004'), 'due_soon');

-- A schedule never marked done has no baseline to measure from.
insert into public.service_schedules (business_id, vehicle_id, service_type, interval_km)
values (:'biz_a', :'veh_a', 'battery', 40000);
select pg_temp.expect('a schedule never done reads not_started',
  (select status from public.service_due
   where service_type = 'battery' and vehicle_id = :'veh_a'), 'not_started');

select pg_temp.expect_denied('a schedule with no interval is rejected',
  format('insert into public.service_schedules (business_id, vehicle_id, service_type)
          values (%L, %L, ''clutch'')', :'biz_a', :'veh_a'));
select pg_temp.expect_denied('one schedule per service type per vehicle',
  format('insert into public.service_schedules
            (business_id, vehicle_id, service_type, interval_km)
          values (%L, %L, ''engine_oil'', 15000)', :'biz_a', :'veh_a'));

-- complete_service must log the cost and reset the schedule together.
select public.complete_service(
  '99990000-0000-0000-0000-000000000001', current_date, 186200, 9400,
  'Sri Ganesh Motors', 'Oil + filter'
) is not null as logged;

select pg_temp.expect('completing a service resets the schedule',
  (select last_done_odometer::int from public.service_schedules
   where id = '99990000-0000-0000-0000-000000000001'), 186200);
select pg_temp.expect('the service is no longer overdue',
  (select status from public.service_due
   where id = '99990000-0000-0000-0000-000000000001'), 'ok');
select pg_temp.expect('completing a service logs the cost',
  (select cost::numeric from public.vehicle_maintenance_log
   where service_schedule_id = '99990000-0000-0000-0000-000000000001'), 9400::numeric);
select pg_temp.expect('completing a service carries the odometer forward',
  (select current_odometer::int from public.vehicles where id = :'veh_a'), 186200);

-- A helper does the workshop entry; the schedule itself is the owner's.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'help_a', false);
select public.complete_service(
  '99990000-0000-0000-0000-000000000003', current_date, 186300, 2200, 'Tyre House', null
) is not null as helper_logged;
select pg_temp.expect_denied('helper cannot create a service schedule',
  format('insert into public.service_schedules (business_id, vehicle_id, service_type, interval_km)
          values (%L, %L, ''air_filter'', 20000)', :'biz_a', :'veh_a'));

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'ca_a', false);
select pg_temp.expect_denied('CA cannot complete a service',
  'select public.complete_service(''99990000-0000-0000-0000-000000000002'', current_date, 190000, 100)');

-- And not across tenants, even through the definer function.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_b', false);
select pg_temp.expect_denied('cannot complete another business''s service',
  'select public.complete_service(''99990000-0000-0000-0000-000000000002'', current_date, 190000, 100)');
select pg_temp.expect('owner B sees no schedules of A',
  (select count(*)::int from public.service_due), 0);

-- =============================================================================
-- Phase 5 — staff invitations
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

insert into public.invites (business_id, email, name, role, invited_by)
values (:'biz_a', 'NewHelper@Example.com', 'New Helper', 'helper', :'owner_a');

select pg_temp.expect('owner sees the invite',
  (select count(*)::int from public.invites), 1);
select pg_temp.expect_denied('an owner cannot be invited by email',
  format('insert into public.invites (business_id, email, role)
          values (%L, ''boss@example.com'', ''owner'')', :'biz_a'));
select pg_temp.expect_denied('one pending invite per email',
  format('insert into public.invites (business_id, email, role)
          values (%L, ''newhelper@example.com'', ''ca'')', :'biz_a'));

-- A helper cannot invite anyone.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'help_a', false);
select pg_temp.expect_denied('helper cannot invite staff',
  format('insert into public.invites (business_id, email, role)
          values (%L, ''sneaky@example.com'', ''helper'')', :'biz_a'));

-- The invitee signs up. Capitalisation of the email must not matter.
reset role;
insert into auth.users (id, email)
values ('aaaa0000-0000-0000-0000-00000000000a', 'newhelper@example.com');

set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaa0000-0000-0000-0000-00000000000a', false);

select pg_temp.expect('an invitee with no profile can still see their invite',
  (select count(*)::int from public.invites), 1);
select pg_temp.expect('claiming an invite joins the business',
  public.claim_invite(), 'aaaaaaaa-0000-0000-0000-00000000000a'::uuid);
select pg_temp.expect('the claimed role is the invited role',
  (select role from public.users where id = 'aaaa0000-0000-0000-0000-00000000000a'), 'helper');
select pg_temp.expect_denied('an invite cannot be claimed twice',
  'select public.claim_invite()');

-- Someone with no invitation must not be able to join.
reset role;
insert into auth.users (id, email)
values ('bbbb0000-0000-0000-0000-00000000000b', 'stranger@example.com');
set role authenticated;
select set_config('request.jwt.claim.sub', 'bbbb0000-0000-0000-0000-00000000000b', false);
select pg_temp.expect('a stranger sees no invites',
  (select count(*)::int from public.invites), 0);
select pg_temp.expect_denied('a stranger cannot claim their way in',
  'select public.claim_invite()');

-- =============================================================================
-- Phase 5 — audit trail
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

-- An update records only the columns that changed, as from/to pairs.
update public.trips set freight_amount = 55000 where id = :'trip1';

select pg_temp.expect('an update is recorded',
  (select count(*)::int from public.audit_log
   where table_name = 'trips' and record_id = :'trip1' and action = 'update'), 1);
select pg_temp.expect('the diff records the old value',
  (select (diff -> 'freight_amount' ->> 'from') from public.audit_log
   where table_name = 'trips' and record_id = :'trip1' and action = 'update'
   order by changed_at desc limit 1), '50000.00');
select pg_temp.expect('the diff records the new value',
  (select (diff -> 'freight_amount' ->> 'to') from public.audit_log
   where table_name = 'trips' and record_id = :'trip1' and action = 'update'
   order by changed_at desc limit 1), '55000.00');
select pg_temp.expect('the diff carries only what changed',
  (select count(*)::int from jsonb_object_keys(
     (select diff from public.audit_log
      where table_name = 'trips' and record_id = :'trip1' and action = 'update'
      order by changed_at desc limit 1)) ), 1);
select pg_temp.expect('the actor is recorded',
  (select user_id from public.audit_log
   where table_name = 'trips' and record_id = :'trip1' and action = 'update'
   order by changed_at desc limit 1), :'owner_a'::uuid);
select pg_temp.expect('the audit feed resolves the actor''s name',
  (select user_name from public.audit_feed
   where table_name = 'trips' and record_id = :'trip1' and action = 'update'
   order by changed_at desc limit 1), 'Owner A');

-- A write that changes nothing is not worth an entry.
update public.trips set freight_amount = 55000 where id = :'trip1';
select pg_temp.expect('a no-op update is not logged',
  (select count(*)::int from public.audit_log
   where table_name = 'trips' and record_id = :'trip1' and action = 'update'), 1);

-- Deletes keep the whole row, since there is nothing left to look at after.
insert into public.expenses (id, business_id, category, date, amount, payment_mode)
values ('cccc0000-0000-0000-0000-00000000000c', :'biz_a', 'toll', current_date, 750, 'cash');
delete from public.expenses where id = 'cccc0000-0000-0000-0000-00000000000c';
select pg_temp.expect('a delete is recorded with the row',
  (select (diff ->> 'amount') from public.audit_log
   where table_name = 'expenses' and record_id = 'cccc0000-0000-0000-0000-00000000000c'
     and action = 'delete'), '750.00');

-- businesses keys on id rather than business_id, hence its own trigger arg.
update public.businesses set address = 'Kukatpally, Hyderabad' where id = :'biz_a';
select pg_temp.expect('the business row is audited under its own id',
  (select business_id from public.audit_log
   where table_name = 'businesses' order by changed_at desc limit 1), :'biz_a'::uuid);

-- The log is the owner's to read, and nobody's to write or rewrite.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'help_a', false);
select pg_temp.expect('helper cannot read the audit log',
  (select count(*)::int from public.audit_log), 0);

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'ca_a', false);
select pg_temp.expect('CA cannot read the audit log',
  (select count(*)::int from public.audit_log), 0);

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);
select pg_temp.expect('owner can read the audit log',
  (select count(*)::int > 0 from public.audit_log), true);
select pg_temp.expect_denied('nobody can forge an audit entry',
  format('insert into public.audit_log (business_id, table_name, action)
          values (%L, ''trips'', ''update'')', :'biz_a'));
select pg_temp.expect_no_write('nobody can rewrite history',
  'update public.audit_log set action = ''insert'' where action = ''update''',
  format('select count(*)::text from public.audit_log
          where action = ''update'' and business_id = %L', :'biz_a'),
  (select count(*)::text from public.audit_log
   where action = 'update' and business_id = 'aaaaaaaa-0000-0000-0000-00000000000a'));

-- Tenancy holds on the log too.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_b', false);
-- B legitimately sees its own entries (the seed's inserts are audited too),
-- so the isolation check has to name A's rows rather than count everything.
select pg_temp.expect('owner B sees no audit entries of A',
  (select count(*)::int from public.audit_log where business_id = :'biz_a'), 0);
select pg_temp.expect('owner B does see its own audit entries',
  (select count(*)::int > 0 from public.audit_log), true);
select pg_temp.expect('owner B sees no invites of A',
  (select count(*)::int from public.invites), 0);

reset role;

-- =============================================================================
-- Opening balances, quotations and documents
-- =============================================================================
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);

-- The broker had no opening balance, so this is a clean starting point.
-- Negative means the business owes them.
insert into public.opening_balances (business_id, party_type, party_id, amount, as_of_date)
values (:'biz_a', 'broker', :'brk_a', -4000, '2025-04-01');

select pg_temp.expect('broker opening balance is recorded',
  (select opening_balance::numeric from public.broker_ledger where broker_id = :'brk_a'),
  -4000::numeric);

-- A party has one opening position, not a history of them. A second insert on
-- the same key must replace, not add a row the ledger would double-count.
insert into public.opening_balances (business_id, party_type, party_id, amount, as_of_date)
values (:'biz_a', 'broker', :'brk_a', -6500, '2025-04-01')
on conflict (business_id, party_type, party_id)
  do update set amount = excluded.amount, as_of_date = excluded.as_of_date;

select pg_temp.expect('an opening balance is replaced, not duplicated',
  (select count(*)::int from public.opening_balances
   where party_type = 'broker' and party_id = :'brk_a'), 1);
select pg_temp.expect('the replaced opening balance is the one used',
  (select opening_balance::numeric from public.broker_ledger where broker_id = :'brk_a'),
  -6500::numeric);

select pg_temp.expect_denied('an unknown opening-balance party type is rejected',
  format('insert into public.opening_balances (business_id, party_type, party_id, amount, as_of_date)
          values (%L, ''vendor'', %L, 100, current_date)', :'biz_a', :'cli_a'));

-- Quotations: owner writes, helper reads only.
insert into public.quotations (
  business_id, party_type, party_id, route, expected_goods, quoted_rate, validity_date
) values (
  :'biz_a', 'client', :'cli_a', 'Hyderabad to Nagpur', 'Cement, 16T loads',
  48000, current_date + 30
);
select pg_temp.expect('a quotation defaults to open',
  (select status from public.quotations where route = 'Hyderabad to Nagpur'), 'open');
select pg_temp.expect_denied('an unknown quotation status is rejected',
  'update public.quotations set status = ''maybe'' where route = ''Hyderabad to Nagpur''');

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'help_a', false);
select pg_temp.expect('helper can read quotations',
  (select count(*)::int from public.quotations), 1);
select pg_temp.expect_denied('helper cannot create a quotation',
  format('insert into public.quotations (business_id, party_type, party_id, route)
          values (%L, ''client'', %L, ''Sneaky route'')', :'biz_a', :'cli_a'));

-- Documents: a helper attaches a proof of delivery, only under their own
-- business folder, and only the owner can remove it.
insert into public.documents (business_id, owner_type, owner_id, file_url, doc_type)
values (
  :'biz_a', 'trip', :'trip1',
  'aaaaaaaa-0000-0000-0000-00000000000a/trip/77777777-0000-0000-0000-000000000001/pod.jpg',
  'Proof of delivery'
);
select pg_temp.expect('helper can attach a document record',
  (select count(*)::int from public.documents where owner_id = :'trip1'), 1);

insert into storage.objects (bucket_id, name)
values ('documents',
  'aaaaaaaa-0000-0000-0000-00000000000a/trip/77777777-0000-0000-0000-000000000001/pod.jpg');
select pg_temp.expect('helper can upload under their own business folder',
  (select count(*)::int from storage.objects
   where name like '%/trip/77777777-0000-0000-0000-000000000001/%'), 1);

select pg_temp.expect_denied('helper cannot upload under another business folder',
  'insert into storage.objects (bucket_id, name)
   values (''documents'', ''bbbbbbbb-0000-0000-0000-00000000000b/trip/x/stolen.jpg'')');

select pg_temp.expect_no_write('helper cannot delete a stored file',
  'delete from storage.objects
   where name like ''%/trip/77777777-0000-0000-0000-000000000001/%''',
  'select count(*)::text from storage.objects
   where name like ''%/trip/77777777-0000-0000-0000-000000000001/%''',
  '1');

-- Recording a POD on the trip is what the compliance report reads.
update public.trips
set pod_file_url = 'aaaaaaaa-0000-0000-0000-00000000000a/trip/77777777-0000-0000-0000-000000000001/pod.jpg'
where id = :'trip1';
-- The POD was this trip's last remaining gap (it already had an LR, an e-way
-- bill and an invoice), so recording one drops it out of the report entirely
-- rather than leaving it listed with every flag clear.
select pg_temp.expect('a trip with nothing missing leaves the compliance report',
  (select count(*)::int from public.compliance_gaps where trip_id = :'trip1'), 0);

-- A CA reads the paperwork but attaches nothing.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'ca_a', false);
select pg_temp.expect('CA can read documents',
  (select count(*)::int from public.documents), 1);
select pg_temp.expect_denied('CA cannot attach a document',
  format('insert into public.documents (business_id, owner_type, owner_id, file_url)
          values (%L, ''trip'', %L, ''x/y/z.jpg'')', :'biz_a', :'trip1'));

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_b', false);
select pg_temp.expect('owner B sees no documents of A',
  (select count(*)::int from public.documents), 0);
select pg_temp.expect('owner B sees no quotations of A',
  (select count(*)::int from public.quotations), 0);
select pg_temp.expect('owner B sees no opening balances of A',
  (select count(*)::int from public.opening_balances), 0);

reset role;

-- The documents policies must match the storage policies exactly: a helper
-- attaches, only the owner removes. When these two disagree, an upload lands
-- in the bucket and is then refused its metadata row.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'help_a', false);
select pg_temp.expect_no_write('helper cannot delete a document record',
  format('delete from public.documents where owner_id = %L', :'trip1'),
  format('select count(*)::text from public.documents where owner_id = %L', :'trip1'),
  '1');

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);
delete from public.documents where owner_id = :'trip1';
select pg_temp.expect('owner can delete a document record',
  (select count(*)::int from public.documents where owner_id = :'trip1'), 0);

reset role;

-- =============================================================================
-- A driver sees their own work and their own money, and nothing else
--
-- This is the whole point of the driver role, and the app is not where it is
-- decided: a driver holds the same publishable key as the owner and can ask
-- Postgres anything. So every one of these is asked of the database directly,
-- the way a driver with a browser console would ask it.
-- =============================================================================
\set biz_b bbbbbbbb-0000-0000-0000-00000000000b
\set drv_a2 44444444-0000-0000-0000-000000000002
\set drv_login_a 11111111-0000-0000-0000-000000000004
\set drv2_login_a 11111111-0000-0000-0000-000000000005
\set trip2 77777777-0000-0000-0000-000000000002

reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'drv_login_a', false);

-- --- the fence: the tables answer nothing ------------------------------------
select pg_temp.expect('driver cannot read the trips table',
  (select count(*)::int from public.trips), 0);
select pg_temp.expect('driver cannot read invoices',
  (select count(*)::int from public.invoices), 0);
select pg_temp.expect('driver cannot read clients',
  (select count(*)::int from public.clients), 0);
select pg_temp.expect('driver cannot read expenses',
  (select count(*)::int from public.expenses), 0);
select pg_temp.expect('driver cannot read the driver list',
  (select count(*)::int from public.drivers), 0);
select pg_temp.expect('driver cannot read the advances table',
  (select count(*)::int from public.driver_advances), 0);
select pg_temp.expect('driver cannot read salary runs',
  (select count(*)::int from public.driver_salary_payments), 0);
select pg_temp.expect('driver cannot read documents',
  (select count(*)::int from public.documents), 0);
select pg_temp.expect('driver cannot read the audit log',
  (select count(*)::int from public.audit_log), 0);
select pg_temp.expect('driver cannot read the P&L',
  (select count(*)::int from public.monthly_pl), 0);
select pg_temp.expect('driver cannot read the driver ledger',
  (select count(*)::int from public.driver_ledger), 0);
select pg_temp.expect('driver cannot read the client ledger',
  (select count(*)::int from public.client_ledger), 0);

-- Two exceptions, both needed by the driver's own session.
select pg_temp.expect('driver reads their own profile and no other',
  (select count(*)::int from public.users), 1);
select pg_temp.expect('and it is their own',
  (select id from public.users), :'drv_login_a'::uuid);
select pg_temp.expect('driver may know who they drive for',
  (select count(*)::int from public.businesses), 1);

-- --- what they do see --------------------------------------------------------
select pg_temp.expect('driver sees their own trips',
  (select count(*)::int from public.my_trips), 2);
select pg_temp.expect('and they are exactly the two that are theirs',
  (select count(*)::int from public.my_trips
   where id in (:'trip1'::uuid, :'trip2'::uuid)), 2);

-- The money columns are not filtered out of the answer — they are not in the
-- view at all, so there is nothing to filter.
select pg_temp.expect('my_trips carries no money column',
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'my_trips'
      and column_name in ('freight_amount', 'broker_commission',
                          'advance_received', 'tds_deducted')), 0);
select pg_temp.expect('but it does carry what a driver needs',
  (select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'my_trips'
      and column_name in ('pickup', 'drop_location', 'vehicle_reg_no',
                          'odometer_start', 'party_name')), 5);

select pg_temp.expect('driver sees their own salary',
  (select salary_earned::numeric from public.my_money), 22000::numeric);
select pg_temp.expect('driver sees their own outstanding advance',
  (select advances_outstanding::numeric from public.my_money), 3000::numeric);
select pg_temp.expect('my_money has one row, theirs',
  (select count(*)::int from public.my_money), 1);
select pg_temp.expect('driver sees their own advances only',
  (select sum(amount)::numeric from public.my_advances), 3000::numeric);
select pg_temp.expect('the other driver''s 5,000 is not among them',
  (select count(*)::int from public.my_advances where amount = 5000), 0);
select pg_temp.expect('driver sees their own salary runs',
  (select count(*)::int from public.my_salary_runs), 1);

-- --- writes: the tables refuse, the functions decide -------------------------
select pg_temp.expect_denied('driver cannot insert an expense directly',
  format('insert into public.expenses (business_id, category, amount) values (%L, ''fuel'', 100)',
         :'biz_a'));
select pg_temp.expect_denied('driver cannot insert a trip',
  format('insert into public.trips (business_id, party_type, party_id, pickup, drop_location) '
         'values (%L, ''client'', %L, ''X'', ''Y'')', :'biz_a', :'cli_a'));
select pg_temp.expect_no_write('driver cannot promote themselves',
  format('update public.users set role = ''owner'' where id = %L', :'drv_login_a'),
  format('select role from public.users where id = %L', :'drv_login_a'),
  'driver');

-- A direct update on a fenced table matches no rows rather than raising, so
-- the check is that the value did not move. Asked as the owner, because the
-- driver cannot see the row either way.
update public.trips set freight_amount = 1 where id = :'trip1';
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_a', false);
-- Asked as "is it still more than the 1 the driver tried to set", so the check
-- does not go stale the moment an assertion above it edits this trip.
select pg_temp.expect('the driver''s attempt did not touch the freight',
  (select freight_amount > 1 from public.trips where id = :'trip1'), true);

-- --- the functions -----------------------------------------------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'drv_login_a', false);

-- The write functions hand nothing back, and the result is read from the
-- driver's own view. They used to return the trip row — which carries the
-- freight, the commission and the TDS — so a driver who called the RPC
-- directly was handed everything my_trips exists to keep out of their hands.
select pg_temp.expect('the driver functions return nothing at all',
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('driver_log_odometer', 'driver_set_trip_status',
                       'driver_log_expense', 'driver_attach_pod')
     and p.prorettype = 'void'::regtype), 4);

-- The lookup they all start with does return the trip row, so nobody may call
-- it. `revoke from public` does not do this on Supabase: its default
-- privileges grant EXECUTE to anon and authenticated by name, and a revoke
-- from PUBLIC leaves a named grant alone.
select pg_temp.expect('a driver cannot call the internal trip lookup',
  has_function_privilege('authenticated', 'public.driver_own_trip(uuid)', 'execute'), false);
select pg_temp.expect('nor can an anonymous visitor',
  has_function_privilege('anon', 'public.driver_own_trip(uuid)', 'execute'), false);
select pg_temp.expect('and nobody signed out can call the write functions',
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('driver_log_odometer', 'driver_set_trip_status',
                       'driver_log_expense', 'driver_attach_pod')
     and has_function_privilege('anon', p.oid, 'execute')), 0);

-- The rule behind all of the above, asked of the whole schema rather than of
-- the four functions that broke it. A function that returns a table's row type
-- hands back every column of that row — including the ones a view was built to
-- leave out — so none of them may be callable from a browser. This would have
-- caught the bug above on the day it was written.
select pg_temp.expect('no function hands a whole table row to a caller',
  (select count(*)::int
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   join pg_type t on t.oid = p.prorettype
   join pg_class c on c.oid = t.typrelid
   where n.nspname = 'public'
     and c.relkind = 'r'
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))), 0);

select public.driver_log_odometer(:'trip2', null, 181000);
select pg_temp.expect('driver logs a closing meter reading',
  (select odometer_end from public.my_trips where id = :'trip2'), 181000);
select pg_temp.expect_denied('a closing reading below the opening one is refused',
  format('select public.driver_log_odometer(%L, 181000, 180000)', :'trip2'));

select public.driver_set_trip_status(:'trip2', 'delivered');
select pg_temp.expect('driver marks a trip delivered',
  (select status from public.my_trips where id = :'trip2'), 'delivered');
select pg_temp.expect_denied('driver cannot close a trip',
  format('select public.driver_set_trip_status(%L, ''closed'')', :'trip2'));

select public.driver_log_expense(:'trip2', 'fuel', 2500, 'cash', 'Diesel');
select pg_temp.expect('driver logs diesel against their own trip',
  (select sum(amount)::numeric from public.my_trip_expenses where amount = 2500),
  2500::numeric);
select pg_temp.expect_denied('driver cannot log a salary as an expense',
  format('select public.driver_log_expense(%L, ''salary'', 1000)', :'trip2'));
select pg_temp.expect_denied('driver cannot log an expense with no amount',
  format('select public.driver_log_expense(%L, ''fuel'', 0)', :'trip2'));

-- A proof of delivery has to land inside this business's folder.
select pg_temp.expect_denied('a photo from outside the business is refused',
  format('select public.driver_attach_pod(%L, ''%s/trip/%s/pod.jpg'')',
         :'trip2', :'biz_b', :'trip2'));
select public.driver_attach_pod(:'trip2', format('%s/trip/%s/pod.jpg', :'biz_a', :'trip2'));
select pg_temp.expect('driver attaches a delivery photo',
  (select pod_file_url from public.my_trips where id = :'trip2'),
  format('%s/trip/%s/pod.jpg', :'biz_a', :'trip2'));

-- --- one driver against another ----------------------------------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'drv2_login_a', false);

select pg_temp.expect('the other driver has no trips of their own',
  (select count(*)::int from public.my_trips), 0);
select pg_temp.expect('and sees their own advance, not Ramesh''s',
  (select sum(amount)::numeric from public.my_advances), 5000::numeric);
select pg_temp.expect_denied('and cannot touch a trip that is not theirs',
  format('select public.driver_log_odometer(%L, null, 999999)', :'trip1'));
select pg_temp.expect_denied('nor log an expense against it',
  format('select public.driver_log_expense(%L, ''fuel'', 100)', :'trip1'));
select pg_temp.expect_denied('nor attach a photo to it',
  format('select public.driver_attach_pod(%L, ''%s/trip/%s/pod.jpg'')',
         :'trip1', :'biz_a', :'trip1'));

-- --- everyone else is unaffected ---------------------------------------------
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'help_a', false);
select pg_temp.expect('a helper still reads a trip, money and all',
  (select count(*)::int from public.trips
   where id = :'trip1' and freight_amount > 0), 1);
select pg_temp.expect('and the client list the driver cannot see',
  (select count(*)::int from public.clients), 1);
select pg_temp.expect_denied('and cannot call a driver function',
  format('select public.driver_log_odometer(%L, null, 1)', :'trip1'));

reset role;
