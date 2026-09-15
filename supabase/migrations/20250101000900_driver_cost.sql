-- =============================================================================
-- What a driver costs is what the driver earned.
--
-- Both views summed driver_salary_payments.net_payable, which is what is left
-- to hand over after advances already given are deducted:
--
--     net_payable = salary_earned - advances_deducted - other_deductions
--
-- An advance is cash that has already left the business; recovering it out of a
-- salary run does not make the work cheaper. Summing net_payable therefore
-- charged the P&L less than the driver was actually paid, by exactly the amount
-- of every advance deducted, and that money was charged nowhere else --
-- driver_advances is not an expense table. A driver earning 3,600 with 2,000 of
-- it recovering an advance was booked as a 1,600 cost, overstating profit by
-- 2,000. The same figure is what the CA export pack reports.
--
-- Earnings and the balance still owed are two different questions, so they now
-- come from two different columns:
--
--   * cost, and salary_earned on the ledger -> salary_earned
--   * what is still to be handed over       -> net_payable - amount_paid
-- =============================================================================

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
    sum(amount)                                                          as expenses_total,
    sum(amount) filter (where category = 'fuel')                         as fuel,
    sum(amount) filter (where category = 'toll')                         as toll,
    sum(amount) filter (where category in ('maintenance', 'tyre'))       as maintenance,
    sum(amount) filter (where category = 'driver_batta')                 as driver_batta,
    sum(amount) filter (where category in ('insurance', 'permit'))       as compliance,
    sum(amount) filter (where category = 'loan_emi')                     as loan_emi,
    sum(amount) filter (where category = 'office')                       as office,
    sum(amount) filter (where category = 'salary')                       as salary_expense,
    sum(amount) filter (where category = 'other')                        as other
  from public.expenses
  group by 1, 2
),
salary_side as (
  select
    business_id,
    date_trunc('month', period_month)::date as month,
    -- What the work cost, not what was left to hand over.
    sum(salary_earned)                      as driver_salaries
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
  'Month-by-month P&L. driver_salaries is what drivers earned that month, not '
  'what was left to hand over after advances -- an advance already left the '
  'business and does not make the work cheaper. net_profit excludes expenses '
  'booked in the salary category and uses the salary run instead, so a salary '
  'recorded in both places is not deducted twice.';

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
         -- What the driver earned, and what is still owed on those runs. The
         -- two differ by any advance the run recovered.
         sum(salary_earned)                    as salary_earned,
         sum(net_payable) - sum(amount_paid)   as salary_due,
         sum(amount_paid)                      as salary_paid
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
  coalesce(s.salary_due, 0)                   as salary_due,
  coalesce(t.trip_count, 0)                   as trip_count,
  -- positive means the business owes the driver
  coalesce(s.salary_due, 0)
    - coalesce(ob.amount, 0)                  as net_payable
from public.drivers d
left join advance_side a
  on a.business_id = d.business_id and a.driver_id = d.id
left join salary_side s
  on s.business_id = d.business_id and s.driver_id = d.id
left join trip_side t
  on t.business_id = d.business_id and t.driver_id = d.id
left join public.opening_balances ob
  on ob.business_id = d.business_id and ob.party_type = 'driver' and ob.party_id = d.id;

comment on view public.driver_ledger is
  'Driver money. salary_earned is what the driver earned; salary_due is what is '
  'still to be handed over, which is lower by any advance a salary run already '
  'recovered. advances_outstanding is cash given that no run has recovered yet.';

grant select on public.monthly_pl    to authenticated;
grant select on public.driver_ledger to authenticated;

-- -----------------------------------------------------------------------------
-- Indexes for the six foreign keys that had none.
--
-- Postgres indexes the referenced side of a foreign key automatically but not
-- the referencing side, so every one of these was a sequential scan whenever
-- the parent row was touched. Removing a staff member checks audit_log and
-- invites for references to them; deleting a vehicle or a driver checks the
-- other; a trip's payments are looked up by trip_id. Cheap now, and the kind
-- of thing nobody notices until a year of trips has accumulated.
-- -----------------------------------------------------------------------------
create index if not exists audit_log_user_id_idx           on public.audit_log (user_id);
create index if not exists drivers_assigned_vehicle_id_idx on public.drivers (assigned_vehicle_id);
create index if not exists invites_accepted_by_idx         on public.invites (accepted_by);
create index if not exists invites_invited_by_idx          on public.invites (invited_by);
create index if not exists payments_trip_id_idx            on public.payments (trip_id);
create index if not exists vehicles_assigned_driver_id_idx on public.vehicles (assigned_driver_id);
