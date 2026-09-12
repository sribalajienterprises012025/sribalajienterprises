-- =============================================================================
-- Phase 5a — asset care
--
-- Service intervals, the maintenance log and insurance claims already had
-- tables from Phase 1 (vehicle_maintenance_log, insurance_claims). What is
-- missing is the schedule: what is due, on which truck, in how many kilometres.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- service_schedules — one row per vehicle per service item.
--
-- Either interval works on its own: engine oil is a kilometre interval,
-- insurance a day interval, a general service often both. Whichever comes
-- first is what the due view reports.
-- -----------------------------------------------------------------------------
create table if not exists public.service_schedules (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  vehicle_id           uuid not null references public.vehicles (id) on delete cascade,
  service_type         text not null
                         check (service_type in ('engine_oil', 'gearbox_oil', 'differential_oil',
                                                 'air_filter', 'tyre_rotation', 'tyre_change',
                                                 'battery', 'brake', 'clutch', 'general_service',
                                                 'greasing', 'other')),
  interval_km          integer check (interval_km > 0),
  interval_days        integer check (interval_days > 0),
  last_done_odometer   integer check (last_done_odometer >= 0),
  last_done_date       date,
  note                 text,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (vehicle_id, service_type),
  -- A schedule with neither interval can never come due, so it is not a
  -- schedule. Rejecting it here beats silently never reminding anyone.
  constraint service_schedules_needs_an_interval
    check (interval_km is not null or interval_days is not null)
);

create index if not exists service_schedules_vehicle_idx
  on public.service_schedules (vehicle_id);
create index if not exists service_schedules_business_idx
  on public.service_schedules (business_id);

drop trigger if exists set_updated_at on public.service_schedules;
create trigger set_updated_at before update on public.service_schedules
  for each row execute function public.set_updated_at();

alter table public.service_schedules enable row level security;

drop policy if exists service_schedules_select on public.service_schedules;
create policy service_schedules_select on public.service_schedules
  for select to authenticated
  using (business_id = public.current_business_id());

drop policy if exists service_schedules_write on public.service_schedules;
create policy service_schedules_write on public.service_schedules
  for all to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  );

-- -----------------------------------------------------------------------------
-- service_due — what is coming up, measured against the vehicle's odometer.
--
-- The odometer is kept current from each trip's closing reading (see
-- syncVehicleOdometer in the app), which is what makes service-by-kilometre
-- work without anyone reading a dial and typing it in separately.
-- -----------------------------------------------------------------------------
create or replace view public.service_due
with (security_invoker = on) as
with computed as (
  select
    s.id,
    s.business_id,
    s.vehicle_id,
    v.reg_no,
    v.current_odometer,
    s.service_type,
    s.interval_km,
    s.interval_days,
    s.last_done_odometer,
    s.last_done_date,
    s.note,
    case
      when s.interval_km is not null and s.last_done_odometer is not null
        then s.last_done_odometer + s.interval_km
    end as due_at_odometer,
    case
      when s.interval_days is not null and s.last_done_date is not null
        then s.last_done_date + s.interval_days
    end as due_on_date
  from public.service_schedules s
  join public.vehicles v on v.id = s.vehicle_id
  where s.active
    and v.status <> 'sold'
)
select
  c.*,
  case
    when c.due_at_odometer is not null then c.due_at_odometer - c.current_odometer
  end as km_remaining,
  case
    when c.due_on_date is not null then c.due_on_date - current_date
  end as days_remaining,
  -- Whichever limit is nearer decides the status. 1,000 km or 15 days of
  -- warning is roughly the notice needed to book a workshop slot without
  -- taking the truck off a booked load.
  case
    when (c.due_at_odometer is not null and c.current_odometer >= c.due_at_odometer)
      or (c.due_on_date is not null and current_date >= c.due_on_date)
      then 'overdue'
    when (c.due_at_odometer is not null and c.due_at_odometer - c.current_odometer <= 1000)
      or (c.due_on_date is not null and c.due_on_date - current_date <= 15)
      then 'due_soon'
    when c.due_at_odometer is null and c.due_on_date is null
      then 'not_started'
    else 'ok'
  end as status
from computed c;

comment on view public.service_due is
  'not_started means the schedule exists but has never been marked done, so '
  'there is no baseline to measure the next service from.';

grant select on public.service_due to authenticated;

-- -----------------------------------------------------------------------------
-- vehicle_maintenance_log gained nothing in Phase 1 to link it back to the
-- schedule it satisfied. Without that, marking a service done and logging its
-- cost are two unconnected acts.
-- -----------------------------------------------------------------------------
alter table public.vehicle_maintenance_log
  add column if not exists service_schedule_id uuid
    references public.service_schedules (id) on delete set null,
  add column if not exists vendor text;

create index if not exists vehicle_maintenance_log_schedule_idx
  on public.vehicle_maintenance_log (service_schedule_id);

-- -----------------------------------------------------------------------------
-- complete_service — log the work and reset the schedule in one transaction.
--
-- Doing this as two client-side writes leaves a window where the cost is
-- recorded but the truck still shows the service as overdue, or the reverse.
-- -----------------------------------------------------------------------------
create or replace function public.complete_service(
  p_schedule_id uuid,
  p_date date,
  p_odometer integer,
  p_cost numeric default 0,
  p_vendor text default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_schedule public.service_schedules;
  v_log_id uuid;
begin
  select * into v_schedule
  from public.service_schedules
  where id = p_schedule_id;

  if v_schedule.id is null then
    raise exception 'service schedule not found';
  end if;

  -- A definer function runs with the owner's rights, so tenancy and role are
  -- re-checked here rather than relied on from the caller's RLS.
  if v_schedule.business_id is distinct from public.current_business_id() then
    raise exception 'that schedule belongs to another business';
  end if;

  if public.current_user_role() not in ('owner', 'helper') then
    raise exception 'your role cannot complete a service';
  end if;

  insert into public.vehicle_maintenance_log (
    business_id, vehicle_id, service_schedule_id, type, date, cost,
    odometer_reading, vendor, note
  ) values (
    v_schedule.business_id,
    v_schedule.vehicle_id,
    v_schedule.id,
    case
      when v_schedule.service_type in ('tyre_rotation', 'tyre_change') then 'tyre'
      when v_schedule.service_type = 'battery' then 'battery'
      when v_schedule.service_type in ('brake', 'clutch') then 'repair'
      when v_schedule.service_type = 'other' then 'other'
      else 'service'
    end,
    p_date,
    coalesce(p_cost, 0),
    p_odometer,
    p_vendor,
    p_note
  )
  returning id into v_log_id;

  update public.service_schedules
  set last_done_odometer = p_odometer,
      last_done_date = p_date
  where id = p_schedule_id;

  -- A workshop reading ahead of the recorded odometer is the more recent
  -- truth, so the vehicle moves forward with it. It never moves backwards.
  update public.vehicles
  set current_odometer = p_odometer
  where id = v_schedule.vehicle_id
    and p_odometer is not null
    and p_odometer > current_odometer;

  return v_log_id;
end;
$$;

revoke all on function public.complete_service(uuid, date, integer, numeric, text, text) from public;
grant execute on function public.complete_service(uuid, date, integer, numeric, text, text)
  to authenticated;
