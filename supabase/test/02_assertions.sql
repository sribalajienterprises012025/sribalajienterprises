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
select pg_temp.expect('owner A sees own staff',
  (select count(*)::int from public.users), 3);

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
