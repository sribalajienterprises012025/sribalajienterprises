-- =============================================================================
-- Phase 4 — report views
--
-- Every view here is grouped by month rather than over a fixed window, because
-- a view takes no parameters. The app sums the months in the range the user
-- picked, which means one view serves a month, a quarter, a financial year or
-- an arbitrary range without a round trip per period.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- monthly_pl — freight in, costs out, month by month.
--
-- The month list is built from a union of every source, so a month with
-- expenses but no trips (a workshop month) still appears instead of silently
-- dropping out of the P&L.
-- -----------------------------------------------------------------------------
create or replace view public.monthly_pl
with (security_invoker = on) as
with all_months as (
  select business_id, date_trunc('month', trip_date)::date as month
  from public.trips
  where status <> 'cancelled'
  union
  select business_id, date_trunc('month', date)::date
  from public.expenses
  union
  select business_id, date_trunc('month', period_month)::date
  from public.driver_salary_payments
  union
  select business_id, date_trunc('month', invoice_date)::date
  from public.invoices
  where status <> 'cancelled'
),
trip_side as (
  select
    business_id,
    date_trunc('month', trip_date)::date as month,
    count(*)                             as trip_count,
    sum(freight_amount)                  as freight,
    sum(broker_commission)               as broker_commission,
    sum(tds_deducted)                    as tds_deducted,
    sum(
      case
        when odometer_start is not null and odometer_end is not null
          then odometer_end - odometer_start
        else 0
      end
    )                                    as distance_km
  from public.trips
  where status <> 'cancelled'
  group by 1, 2
),
expense_side as (
  select
    business_id,
    date_trunc('month', date)::date as month,
    sum(amount)                                                      as expenses_total,
    sum(amount) filter (where category = 'fuel')                     as fuel,
    sum(amount) filter (where category = 'toll')                     as toll,
    sum(amount) filter (where category in ('maintenance', 'tyre'))   as maintenance,
    sum(amount) filter (where category = 'driver_batta')             as driver_batta,
    sum(amount) filter (where category in ('insurance', 'permit'))   as compliance,
    sum(amount) filter (where category = 'loan_emi')                 as loan_emi,
    sum(amount) filter (where category = 'office')                   as office,
    sum(amount) filter (where category = 'salary')                   as salary_expense,
    sum(amount) filter (
      where category not in ('fuel', 'toll', 'maintenance', 'tyre', 'driver_batta',
                             'insurance', 'permit', 'loan_emi', 'office', 'salary')
    )                                                                as other
  from public.expenses
  group by 1, 2
),
salary_side as (
  select
    business_id,
    date_trunc('month', period_month)::date as month,
    sum(net_payable)                        as driver_salaries
  from public.driver_salary_payments
  group by 1, 2
)
select
  m.business_id,
  m.month,
  coalesce(t.trip_count, 0)           as trip_count,
  coalesce(t.freight, 0)              as freight,
  coalesce(t.broker_commission, 0)    as broker_commission,
  coalesce(t.tds_deducted, 0)         as tds_deducted,
  coalesce(t.distance_km, 0)          as distance_km,
  coalesce(e.expenses_total, 0)       as expenses_total,
  coalesce(e.fuel, 0)                 as fuel,
  coalesce(e.toll, 0)                 as toll,
  coalesce(e.maintenance, 0)          as maintenance,
  coalesce(e.driver_batta, 0)         as driver_batta,
  coalesce(e.compliance, 0)           as compliance,
  coalesce(e.loan_emi, 0)             as loan_emi,
  coalesce(e.office, 0)               as office,
  coalesce(e.salary_expense, 0)       as salary_expense,
  coalesce(e.other, 0)                as other_expenses,
  coalesce(s.driver_salaries, 0)      as driver_salaries,
  -- Driver salaries recorded as a salary run are counted here; a salary also
  -- entered as an expense would double-count, so the two are shown separately
  -- and only the salary run feeds net_profit.
  coalesce(t.freight, 0)
    - coalesce(t.broker_commission, 0)
    - coalesce(e.expenses_total, 0)
    + coalesce(e.salary_expense, 0)
    - coalesce(s.driver_salaries, 0)  as net_profit
from (select distinct business_id, month from all_months) m
left join trip_side t on t.business_id = m.business_id and t.month = m.month
left join expense_side e on e.business_id = m.business_id and e.month = m.month
left join salary_side s on s.business_id = m.business_id and s.month = m.month;

comment on view public.monthly_pl is
  'Month-by-month P&L. net_profit excludes expenses booked in the salary '
  'category and uses driver_salary_payments instead, so a salary recorded in '
  'both places is not deducted twice.';

-- -----------------------------------------------------------------------------
-- gst_summary — taxable value and tax, by month, rate and reverse-charge flag.
--
-- Grouped the way GSTR-1 wants it read. Cancelled invoices are excluded but
-- their numbers stay in the series, which is why they are filtered here rather
-- than deleted upstream.
-- -----------------------------------------------------------------------------
create or replace view public.gst_summary
with (security_invoker = on) as
select
  business_id,
  date_trunc('month', invoice_date)::date                       as month,
  gst_rate,
  is_rcm,
  place_of_supply,
  count(*)                                                      as invoice_count,
  sum(taxable_value)                                            as taxable_value,
  sum(coalesce((tax_breakup ->> 'cgst_amount')::numeric, 0))     as cgst,
  sum(coalesce((tax_breakup ->> 'sgst_amount')::numeric, 0))     as sgst,
  sum(coalesce((tax_breakup ->> 'igst_amount')::numeric, 0))     as igst,
  sum(tax_amount)                                               as total_tax,
  sum(amount)                                                   as invoice_total
from public.invoices
where invoice_type = 'gst'
  and status <> 'cancelled'
group by business_id, month, gst_rate, is_rcm, place_of_supply;

-- -----------------------------------------------------------------------------
-- vehicle_monthly — per truck, per month. The basis for cost per kilometre.
--
-- Expenses attributed to the vehicle count whether or not they were booked
-- against a trip: a tyre change on an idle day is still that truck's cost.
-- -----------------------------------------------------------------------------
create or replace view public.vehicle_monthly
with (security_invoker = on) as
with months as (
  select business_id, vehicle_id, date_trunc('month', trip_date)::date as month
  from public.trips
  where vehicle_id is not null and status <> 'cancelled'
  union
  select business_id, vehicle_id, date_trunc('month', date)::date
  from public.expenses
  where vehicle_id is not null
),
trip_side as (
  select
    business_id,
    vehicle_id,
    date_trunc('month', trip_date)::date as month,
    count(*)                             as trip_count,
    sum(freight_amount)                  as freight,
    sum(broker_commission)               as broker_commission,
    sum(
      case
        when odometer_start is not null and odometer_end is not null
          then odometer_end - odometer_start
        else 0
      end
    )                                    as distance_km
  from public.trips
  where vehicle_id is not null and status <> 'cancelled'
  group by 1, 2, 3
),
expense_side as (
  select
    business_id,
    vehicle_id,
    date_trunc('month', date)::date               as month,
    sum(amount)                                   as expenses,
    sum(amount) filter (where category = 'fuel')  as fuel
  from public.expenses
  where vehicle_id is not null
  group by 1, 2, 3
)
select
  m.business_id,
  m.vehicle_id,
  v.reg_no,
  m.month,
  coalesce(t.trip_count, 0)         as trip_count,
  coalesce(t.freight, 0)            as freight,
  coalesce(t.broker_commission, 0)  as broker_commission,
  coalesce(t.distance_km, 0)        as distance_km,
  coalesce(e.expenses, 0)           as expenses,
  coalesce(e.fuel, 0)               as fuel,
  coalesce(t.freight, 0) - coalesce(t.broker_commission, 0) - coalesce(e.expenses, 0)
                                    as margin,
  case
    when coalesce(t.distance_km, 0) > 0
      then round(coalesce(e.expenses, 0) / t.distance_km, 2)
  end                               as cost_per_km,
  case
    when coalesce(t.distance_km, 0) > 0
      then round(coalesce(t.freight, 0) / t.distance_km, 2)
  end                               as revenue_per_km
from (select distinct business_id, vehicle_id, month from months) m
join public.vehicles v on v.id = m.vehicle_id
left join trip_side t
  on t.business_id = m.business_id and t.vehicle_id = m.vehicle_id and t.month = m.month
left join expense_side e
  on e.business_id = m.business_id and e.vehicle_id = m.vehicle_id and e.month = m.month;

-- -----------------------------------------------------------------------------
-- compliance_gaps — GST trips missing the paperwork a CA will ask for.
--
-- The e-way bill threshold is a value, not a rule this app can decide, so a
-- missing one is reported rather than treated as an error.
-- -----------------------------------------------------------------------------
create or replace view public.compliance_gaps
with (security_invoker = on) as
select
  t.business_id,
  t.id                          as trip_id,
  t.trip_date,
  t.pickup,
  t.drop_location,
  t.freight_amount,
  t.bill_type,
  t.lr_number,
  t.eway_bill_no,
  t.pod_file_url,
  t.status,
  (t.lr_number is null or btrim(t.lr_number) = '')       as missing_lr,
  (t.eway_bill_no is null or btrim(t.eway_bill_no) = '') as missing_eway,
  (t.pod_file_url is null)                               as missing_pod,
  not exists (
    select 1 from public.invoices i
    where i.trip_id = t.id and i.status <> 'cancelled'
  )                                                      as not_invoiced
from public.trips t
where t.status <> 'cancelled'
  and (
    t.lr_number is null or btrim(t.lr_number) = ''
    or (t.bill_type = 'gst' and (t.eway_bill_no is null or btrim(t.eway_bill_no) = ''))
    or t.pod_file_url is null
    or not exists (
      select 1 from public.invoices i
      where i.trip_id = t.id and i.status <> 'cancelled'
    )
  );

grant select on public.monthly_pl to authenticated;
grant select on public.gst_summary to authenticated;
grant select on public.vehicle_monthly to authenticated;
grant select on public.compliance_gaps to authenticated;
