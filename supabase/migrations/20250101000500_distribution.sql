-- =============================================================================
-- Phase 3 — distribution planning
--
-- The architecture document lists no backend change for this phase, but
-- multi-stop and multi-vehicle cannot be represented by the Phase 1 trips table
-- alone: it carries a single pickup and a single drop, and nothing that groups
-- several trucks onto one consignment.
--
-- Both additions are optional. A trip with no stop rows and no consignment
-- behaves exactly as it did before, so nothing already entered has to change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- consignments — one customer order, possibly carried by several trucks.
--
-- This is the multi-vehicle case: 60 tonnes to move, three 20-tonne trucks,
-- three trips against one consignment. Progress is derived from the trips, so
-- the planner can show what is still to be dispatched.
-- -----------------------------------------------------------------------------
create table if not exists public.consignments (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  reference          text,
  party_type         text not null check (party_type in ('client', 'broker')),
  party_id           uuid not null,
  goods_description  text,
  total_quantity     numeric(12, 3),
  unit               text not null default 'tonnes'
                       check (unit in ('tonnes', 'kg', 'bags', 'nos', 'litres', 'cbm')),
  pickup             text not null,
  drop_location      text not null,
  planned_date       date not null default current_date,
  status             text not null default 'planned'
                       check (status in ('planned', 'part_dispatched', 'dispatched',
                                         'completed', 'cancelled')),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists consignments_business_idx
  on public.consignments (business_id, planned_date desc);
create index if not exists consignments_party_idx
  on public.consignments (party_type, party_id);

-- A trip may belong to a consignment. Null means a standalone trip, which is
-- how every trip entered before this migration stays valid.
alter table public.trips
  add column if not exists consignment_id uuid
    references public.consignments (id) on delete set null,
  add column if not exists planned_quantity numeric(12, 3);

comment on column public.trips.planned_quantity is
  'This truck''s share of the consignment, in the consignment''s unit.';

create index if not exists trips_consignment_idx on public.trips (consignment_id);

-- -----------------------------------------------------------------------------
-- trip_stops — the multi-stop case.
--
-- A trip that loads at two godowns and drops at four shops has six stops. The
-- trip's own pickup/drop stay as the headline route so every existing screen
-- and report keeps working; the stops carry the detail.
-- -----------------------------------------------------------------------------
create table if not exists public.trip_stops (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  trip_id            uuid not null references public.trips (id) on delete cascade,
  sequence           integer not null check (sequence > 0),
  stop_type          text not null check (stop_type in ('pickup', 'drop')),
  location           text not null,
  contact            text,
  goods_description  text,
  quantity           numeric(12, 3),
  unit               text,
  expected_at        date,
  reached_at         timestamptz,
  status             text not null default 'pending'
                       check (status in ('pending', 'reached', 'completed', 'skipped')),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Two stops cannot share a position in the running order.
  unique (trip_id, sequence)
);

create index if not exists trip_stops_trip_idx on public.trip_stops (trip_id, sequence);
create index if not exists trip_stops_business_idx on public.trip_stops (business_id);

drop trigger if exists set_updated_at on public.consignments;
create trigger set_updated_at before update on public.consignments
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.trip_stops;
create trigger set_updated_at before update on public.trip_stops
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS. Consignments are planning, which the owner does; stops are operational
-- detail a helper updates as a driver calls them in.
-- -----------------------------------------------------------------------------
alter table public.consignments enable row level security;
alter table public.trip_stops enable row level security;

drop policy if exists consignments_select on public.consignments;
create policy consignments_select on public.consignments
  for select to authenticated
  using (business_id = public.current_business_id());

drop policy if exists consignments_write on public.consignments;
create policy consignments_write on public.consignments
  for all to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  )
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() = 'owner'
  );

drop policy if exists trip_stops_select on public.trip_stops;
create policy trip_stops_select on public.trip_stops
  for select to authenticated
  using (business_id = public.current_business_id());

drop policy if exists trip_stops_write on public.trip_stops;
create policy trip_stops_write on public.trip_stops
  for all to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  )
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  );

-- -----------------------------------------------------------------------------
-- consignment_progress — dispatched vs ordered, derived from the trips.
-- -----------------------------------------------------------------------------
create or replace view public.consignment_progress
with (security_invoker = on) as
select
  c.*,
  coalesce(t.trip_count, 0)                            as trip_count,
  coalesce(t.dispatched_quantity, 0)                   as dispatched_quantity,
  case
    when c.total_quantity is null or c.total_quantity = 0 then null
    else greatest(c.total_quantity - coalesce(t.dispatched_quantity, 0), 0)
  end                                                  as pending_quantity,
  coalesce(t.freight_total, 0)                         as freight_total,
  coalesce(t.delivered_count, 0)                       as delivered_count
from public.consignments c
left join (
  select
    consignment_id,
    count(*)                                                       as trip_count,
    sum(coalesce(planned_quantity, 0))                             as dispatched_quantity,
    sum(freight_amount)                                            as freight_total,
    count(*) filter (
      where status in ('delivered', 'payment_pending', 'closed')
    )                                                              as delivered_count
  from public.trips
  where consignment_id is not null
    and status <> 'cancelled'
  group by consignment_id
) t on t.consignment_id = c.id;

-- -----------------------------------------------------------------------------
-- vehicle_utilisation — one row per vehicle per day that has a trip.
--
-- The planning grid reads this instead of pulling every trip and grouping in
-- the browser, and it is what surfaces a truck double-booked for a day.
-- -----------------------------------------------------------------------------
create or replace view public.vehicle_utilisation
with (security_invoker = on) as
select
  t.business_id,
  t.vehicle_id,
  t.trip_date,
  count(*)                                     as trip_count,
  sum(t.freight_amount)                        as freight_total,
  bool_or(t.status in ('booked', 'in_transit')) as has_open_trip,
  string_agg(t.pickup || ' > ' || t.drop_location, ' | ' order by t.created_at)
                                               as routes
from public.trips t
where t.vehicle_id is not null
  and t.status <> 'cancelled'
group by t.business_id, t.vehicle_id, t.trip_date;

grant select on public.consignment_progress to authenticated;
grant select on public.vehicle_utilisation to authenticated;
