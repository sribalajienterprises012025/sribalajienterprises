-- =============================================================================
-- Phase 2 — ledger views
--
-- Ledgers are views, not tables. The numbers are derived from the entries
-- behind them on every read, so a client's outstanding can never drift away
-- from the trips, invoices and receipts that make it up.
--
-- Every view is declared `security_invoker = on`, which makes it run with the
-- querying user's rights. Without it a view runs as its owner and would hand a
-- helper or CA rows from another business straight past RLS.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- trip_financials — one row per trip, with expenses attributed to it.
-- The building block for trip margin and vehicle profitability.
-- -----------------------------------------------------------------------------
create or replace view public.trip_financials
with (security_invoker = on) as
select
  t.id                                              as trip_id,
  t.business_id,
  t.vehicle_id,
  t.driver_id,
  t.party_type,
  t.party_id,
  t.trip_date,
  t.status,
  t.bill_type,
  t.freight_amount,
  t.broker_commission,
  t.advance_received,
  t.tds_deducted,
  coalesce(e.trip_expenses, 0)                      as trip_expenses,
  case
    when t.odometer_start is not null and t.odometer_end is not null
      then t.odometer_end - t.odometer_start
  end                                               as distance_km,
  t.freight_amount - t.broker_commission - coalesce(e.trip_expenses, 0)
                                                    as net_margin,
  t.freight_amount - t.advance_received - t.tds_deducted
                                                    as balance_due
from public.trips t
left join (
  select trip_id, sum(amount) as trip_expenses
  from public.expenses
  where trip_id is not null
  group by trip_id
) e on e.trip_id = t.id;

comment on view public.trip_financials is
  'Per-trip money. net_margin counts only expenses booked against the trip, so '
  'it is a contribution figure, not a fully-loaded profit.';

-- -----------------------------------------------------------------------------
-- client_ledger — what each client owes.
--
-- A trip contributes either its invoice total or, while still unbilled, its raw
-- freight — never both. That is what the `not exists` guard below is for.
-- -----------------------------------------------------------------------------
create or replace view public.client_ledger
with (security_invoker = on) as
with trip_side as (
  select
    t.business_id,
    t.party_id,
    sum(case
      when not exists (
        select 1 from public.invoices i
        where i.trip_id = t.id and i.status <> 'cancelled'
      ) then t.freight_amount else 0
    end)                        as unbilled_freight,
    sum(t.advance_received)     as advances,
    sum(t.tds_deducted)         as tds,
    count(*)                    as trip_count
  from public.trips t
  where t.party_type = 'client'
    and t.status <> 'cancelled'
  group by t.business_id, t.party_id
),
invoice_side as (
  select business_id, party_id,
         sum(amount) as invoiced,
         count(*)    as invoice_count
  from public.invoices
  where party_type = 'client'
    and status <> 'cancelled'
  group by business_id, party_id
),
note_side as (
  select business_id, party_id,
         sum(case when type = 'debit'  then amount else 0 end) as debit_notes,
         sum(case when type = 'credit' then amount else 0 end) as credit_notes
  from public.credit_debit_notes
  where party_type = 'client'
  group by business_id, party_id
),
receipt_side as (
  select business_id, party_id, sum(amount) as receipts
  from public.payments
  where party_type = 'client' and direction = 'in'
  group by business_id, party_id
)
select
  c.business_id,
  c.id                                        as client_id,
  c.name                                      as client_name,
  c.credit_limit,
  c.credit_period_days,
  coalesce(ob.amount, 0)                      as opening_balance,
  coalesce(i.invoiced, 0)                     as invoiced,
  coalesce(t.unbilled_freight, 0)             as unbilled_freight,
  coalesce(n.debit_notes, 0)                  as debit_notes,
  coalesce(n.credit_notes, 0)                 as credit_notes,
  coalesce(t.advances, 0)                     as advances_received,
  coalesce(t.tds, 0)                          as tds_deducted,
  coalesce(r.receipts, 0)                     as receipts,
  coalesce(t.trip_count, 0)                   as trip_count,
  coalesce(i.invoice_count, 0)                as invoice_count,
  coalesce(ob.amount, 0)
    + coalesce(i.invoiced, 0)
    + coalesce(t.unbilled_freight, 0)
    + coalesce(n.debit_notes, 0)
    - coalesce(n.credit_notes, 0)
    - coalesce(t.advances, 0)
    - coalesce(t.tds, 0)
    - coalesce(r.receipts, 0)                 as balance
from public.clients c
left join trip_side t
  on t.business_id = c.business_id and t.party_id = c.id
left join invoice_side i
  on i.business_id = c.business_id and i.party_id = c.id
left join note_side n
  on n.business_id = c.business_id and n.party_id = c.id
left join receipt_side r
  on r.business_id = c.business_id and r.party_id = c.id
left join public.opening_balances ob
  on ob.business_id = c.business_id
 and ob.party_type = 'client'
 and ob.party_id = c.id;

comment on view public.client_ledger is
  'Positive balance = the client owes the business.';

-- -----------------------------------------------------------------------------
-- broker_ledger — two directions at once.
--
-- A broker both owes freight on loads they routed to us and is owed commission
-- on them, so the two sides are kept separate and netted at the end rather than
-- collapsed into one signed number that nobody can reconcile.
-- -----------------------------------------------------------------------------
create or replace view public.broker_ledger
with (security_invoker = on) as
with trip_side as (
  select
    t.business_id,
    t.party_id,
    sum(case
      when not exists (
        select 1 from public.invoices i
        where i.trip_id = t.id and i.status <> 'cancelled'
      ) then t.freight_amount else 0
    end)                          as unbilled_freight,
    sum(t.broker_commission)      as commission_earned,
    sum(t.advance_received)        as advances,
    sum(t.tds_deducted)            as tds,
    count(*)                       as trip_count
  from public.trips t
  where t.party_type = 'broker'
    and t.status <> 'cancelled'
  group by t.business_id, t.party_id
),
invoice_side as (
  select business_id, party_id, sum(amount) as invoiced
  from public.invoices
  where party_type = 'broker' and status <> 'cancelled'
  group by business_id, party_id
),
note_side as (
  select business_id, party_id,
         sum(case when type = 'debit'  then amount else 0 end) as debit_notes,
         sum(case when type = 'credit' then amount else 0 end) as credit_notes
  from public.credit_debit_notes
  where party_type = 'broker'
  group by business_id, party_id
),
money_side as (
  select business_id, party_id,
         sum(case when direction = 'in'  then amount else 0 end) as receipts,
         sum(case when direction = 'out' then amount else 0 end) as paid_out
  from public.payments
  where party_type = 'broker'
  group by business_id, party_id
)
select
  b.business_id,
  b.id                                        as broker_id,
  b.name                                      as broker_name,
  b.commission_type,
  b.commission_rate,
  coalesce(ob.amount, 0)                      as opening_balance,
  coalesce(i.invoiced, 0)                     as invoiced,
  coalesce(t.unbilled_freight, 0)             as unbilled_freight,
  coalesce(t.advances, 0)                     as advances_received,
  coalesce(t.tds, 0)                          as tds_deducted,
  coalesce(m.receipts, 0)                     as receipts,
  coalesce(n.debit_notes, 0)                  as debit_notes,
  coalesce(n.credit_notes, 0)                 as credit_notes,
  coalesce(t.trip_count, 0)                   as trip_count,
  -- what the broker owes us for freight
  coalesce(ob.amount, 0)
    + coalesce(i.invoiced, 0)
    + coalesce(t.unbilled_freight, 0)
    + coalesce(n.debit_notes, 0)
    - coalesce(n.credit_notes, 0)
    - coalesce(t.advances, 0)
    - coalesce(t.tds, 0)
    - coalesce(m.receipts, 0)                 as freight_receivable,
  -- what we owe the broker in commission
  coalesce(t.commission_earned, 0)            as commission_earned,
  coalesce(m.paid_out, 0)                     as commission_paid,
  coalesce(t.commission_earned, 0) - coalesce(m.paid_out, 0)
                                              as commission_payable,
  -- net position: positive means the broker owes us
  (coalesce(ob.amount, 0)
    + coalesce(i.invoiced, 0)
    + coalesce(t.unbilled_freight, 0)
    + coalesce(n.debit_notes, 0)
    - coalesce(n.credit_notes, 0)
    - coalesce(t.advances, 0)
    - coalesce(t.tds, 0)
    - coalesce(m.receipts, 0))
  - (coalesce(t.commission_earned, 0) - coalesce(m.paid_out, 0))
                                              as net_balance
from public.brokers b
left join trip_side t
  on t.business_id = b.business_id and t.party_id = b.id
left join invoice_side i
  on i.business_id = b.business_id and i.party_id = b.id
left join note_side n
  on n.business_id = b.business_id and n.party_id = b.id
left join money_side m
  on m.business_id = b.business_id and m.party_id = b.id
left join public.opening_balances ob
  on ob.business_id = b.business_id
 and ob.party_type = 'broker'
 and ob.party_id = b.id;

-- -----------------------------------------------------------------------------
-- driver_ledger — advances outstanding and salary still to pay.
--
-- Driver money has exactly two homes: driver_advances and
-- driver_salary_payments. The payments table deliberately excludes drivers so
-- the same rupee cannot be recorded in two places.
-- -----------------------------------------------------------------------------
create or replace view public.driver_ledger
with (security_invoker = on) as
with advance_side as (
  select business_id, driver_id,
         sum(case when not adjusted then amount else 0 end) as advances_outstanding,
         sum(amount)                                        as advances_total
  from public.driver_advances
  group by business_id, driver_id
),
salary_side as (
  select business_id, driver_id,
         sum(net_payable)  as salary_earned,
         sum(amount_paid)  as salary_paid
  from public.driver_salary_payments
  group by business_id, driver_id
),
trip_side as (
  select business_id, driver_id, count(*) as trip_count
  from public.trips
  where driver_id is not null and status <> 'cancelled'
  group by business_id, driver_id
)
select
  d.business_id,
  d.id                                        as driver_id,
  d.name                                      as driver_name,
  d.salary_type,
  d.fixed_salary_amount,
  coalesce(ob.amount, 0)                      as opening_balance,
  coalesce(a.advances_outstanding, 0)         as advances_outstanding,
  coalesce(a.advances_total, 0)               as advances_total,
  coalesce(s.salary_earned, 0)                as salary_earned,
  coalesce(s.salary_paid, 0)                  as salary_paid,
  coalesce(s.salary_earned, 0) - coalesce(s.salary_paid, 0)
                                              as salary_due,
  coalesce(t.trip_count, 0)                   as trip_count,
  -- positive means the business owes the driver
  coalesce(s.salary_earned, 0)
    - coalesce(s.salary_paid, 0)
    - coalesce(ob.amount, 0)                  as net_payable
from public.drivers d
left join advance_side a
  on a.business_id = d.business_id and a.driver_id = d.id
left join salary_side s
  on s.business_id = d.business_id and s.driver_id = d.id
left join trip_side t
  on t.business_id = d.business_id and t.driver_id = d.id
left join public.opening_balances ob
  on ob.business_id = d.business_id
 and ob.party_type = 'driver'
 and ob.party_id = d.id;

grant select on public.trip_financials to authenticated;
grant select on public.client_ledger  to authenticated;
grant select on public.broker_ledger  to authenticated;
grant select on public.driver_ledger  to authenticated;
