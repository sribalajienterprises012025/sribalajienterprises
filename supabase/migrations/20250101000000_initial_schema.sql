-- =============================================================================
-- Balaji Enterprises — initial schema
-- Transport, distribution & accounts management
--
-- Every business-owned table carries business_id. That column is what RLS
-- policies filter on, and what lets a second business entity be added later
-- without redesigning the schema.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Enumerated domains
-- Kept as CHECK constraints rather than Postgres ENUM types: adding a value to
-- an ENUM requires a migration with an exclusive lock, a CHECK does not.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- businesses
-- -----------------------------------------------------------------------------
create table if not exists public.businesses (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  gstin            text,
  pan              text,
  address          text,
  bank_details     jsonb not null default '{}'::jsonb,
  fy_start_month   smallint not null default 4
                     check (fy_start_month between 1 and 12),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on column public.businesses.fy_start_month is
  'Financial year start month. 4 = April, the Indian FY default.';

-- -----------------------------------------------------------------------------
-- users — maps a Supabase Auth user to a business and a role
-- -----------------------------------------------------------------------------
create table if not exists public.users (
  id            uuid primary key references auth.users (id) on delete cascade,
  business_id   uuid not null references public.businesses (id) on delete cascade,
  name          text not null,
  role          text not null default 'owner'
                  check (role in ('owner', 'helper', 'ca')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists users_business_id_idx on public.users (business_id);

-- -----------------------------------------------------------------------------
-- vehicles
-- -----------------------------------------------------------------------------
create table if not exists public.vehicles (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  reg_no              text not null,
  type                text,
  capacity            numeric(10, 2),
  purchase_date       date,
  insurance_expiry    date,
  permit_expiry       date,
  fitness_expiry      date,
  current_odometer    integer not null default 0 check (current_odometer >= 0),
  status              text not null default 'active'
                        check (status in ('active', 'in_maintenance', 'idle', 'sold')),
  assigned_driver_id  uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (business_id, reg_no)
);

create index if not exists vehicles_business_id_idx on public.vehicles (business_id);
create index if not exists vehicles_status_idx on public.vehicles (business_id, status);

-- -----------------------------------------------------------------------------
-- drivers
-- -----------------------------------------------------------------------------
create table if not exists public.drivers (
  id                    uuid primary key default gen_random_uuid(),
  business_id           uuid not null references public.businesses (id) on delete cascade,
  name                  text not null,
  phone                 text,
  license_no            text,
  license_expiry        date,
  assigned_vehicle_id   uuid references public.vehicles (id) on delete set null,
  salary_type           text not null default 'fixed'
                          check (salary_type in ('fixed', 'per_trip', 'percentage')),
  fixed_salary_amount   numeric(12, 2) check (fixed_salary_amount >= 0),
  joining_date          date,
  status                text not null default 'active'
                          check (status in ('active', 'inactive')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists drivers_business_id_idx on public.drivers (business_id);

-- vehicles.assigned_driver_id is declared above but constrained here, because
-- drivers references vehicles and vehicles references drivers.
alter table public.vehicles
  drop constraint if exists vehicles_assigned_driver_id_fkey;
alter table public.vehicles
  add constraint vehicles_assigned_driver_id_fkey
  foreign key (assigned_driver_id) references public.drivers (id) on delete set null;

-- -----------------------------------------------------------------------------
-- driver_advances
-- -----------------------------------------------------------------------------
create table if not exists public.driver_advances (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  driver_id    uuid not null references public.drivers (id) on delete cascade,
  date         date not null default current_date,
  amount       numeric(12, 2) not null check (amount > 0),
  reason       text,
  adjusted     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists driver_advances_driver_id_idx on public.driver_advances (driver_id);
create index if not exists driver_advances_business_id_idx on public.driver_advances (business_id);

-- -----------------------------------------------------------------------------
-- driver_salary_payments
-- -----------------------------------------------------------------------------
create table if not exists public.driver_salary_payments (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  driver_id           uuid not null references public.drivers (id) on delete cascade,
  period_month        date not null,
  salary_earned       numeric(12, 2) not null default 0,
  advances_deducted   numeric(12, 2) not null default 0,
  other_deductions    numeric(12, 2) not null default 0,
  net_payable         numeric(12, 2) not null default 0,
  amount_paid         numeric(12, 2) not null default 0,
  paid_date           date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (driver_id, period_month)
);

comment on column public.driver_salary_payments.period_month is
  'First day of the salary month, e.g. 2025-04-01 for April 2025.';

create index if not exists driver_salary_payments_business_id_idx
  on public.driver_salary_payments (business_id);

-- -----------------------------------------------------------------------------
-- clients
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id                   uuid primary key default gen_random_uuid(),
  business_id          uuid not null references public.businesses (id) on delete cascade,
  name                 text not null,
  gstin                text,
  contact              text,
  address              text,
  credit_limit         numeric(12, 2) check (credit_limit >= 0),
  credit_period_days   integer check (credit_period_days >= 0),
  status               text not null default 'active'
                         check (status in ('active', 'inactive')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists clients_business_id_idx on public.clients (business_id);

-- -----------------------------------------------------------------------------
-- brokers
-- -----------------------------------------------------------------------------
create table if not exists public.brokers (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  name              text not null,
  contact           text,
  gstin             text,
  commission_type   text not null default 'percentage'
                      check (commission_type in ('percentage', 'fixed')),
  commission_rate   numeric(10, 2) check (commission_rate >= 0),
  status            text not null default 'active'
                      check (status in ('active', 'inactive')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists brokers_business_id_idx on public.brokers (business_id);

-- -----------------------------------------------------------------------------
-- quotations
-- -----------------------------------------------------------------------------
create table if not exists public.quotations (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses (id) on delete cascade,
  party_type       text not null check (party_type in ('client', 'broker')),
  party_id         uuid not null,
  route            text,
  expected_goods   text,
  quoted_rate      numeric(12, 2) check (quoted_rate >= 0),
  validity_date    date,
  status           text not null default 'open'
                     check (status in ('open', 'accepted', 'rejected', 'expired')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists quotations_business_id_idx on public.quotations (business_id);

-- -----------------------------------------------------------------------------
-- trips — the operational core
-- -----------------------------------------------------------------------------
create table if not exists public.trips (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  vehicle_id          uuid references public.vehicles (id) on delete set null,
  driver_id           uuid references public.drivers (id) on delete set null,
  party_type          text not null check (party_type in ('client', 'broker')),
  party_id            uuid not null,
  pickup              text not null,
  drop_location       text not null,
  goods_description   text,
  odometer_start      integer check (odometer_start >= 0),
  odometer_end        integer check (odometer_end >= 0),
  trip_date           date not null default current_date,
  freight_amount      numeric(12, 2) not null default 0 check (freight_amount >= 0),
  broker_commission   numeric(12, 2) not null default 0 check (broker_commission >= 0),
  advance_received    numeric(12, 2) not null default 0 check (advance_received >= 0),
  bill_type           text not null default 'gst' check (bill_type in ('gst', 'non_gst')),
  lr_number           text,
  eway_bill_no        text,
  tds_deducted        numeric(12, 2) not null default 0 check (tds_deducted >= 0),
  pod_file_url        text,
  status              text not null default 'booked'
                        check (status in ('booked', 'in_transit', 'delivered',
                                          'payment_pending', 'closed', 'cancelled')),
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint trips_odometer_order check (
    odometer_end is null or odometer_start is null or odometer_end >= odometer_start
  )
);

comment on column public.trips.drop_location is
  'Named drop_location rather than "drop" — DROP is a reserved word in SQL.';
comment on column public.trips.status is
  'Operational flow: booked -> in_transit -> delivered -> payment_pending -> closed.';

create index if not exists trips_business_id_idx on public.trips (business_id);
create index if not exists trips_trip_date_idx on public.trips (business_id, trip_date desc);
create index if not exists trips_status_idx on public.trips (business_id, status);
create index if not exists trips_vehicle_idx on public.trips (vehicle_id);
create index if not exists trips_driver_idx on public.trips (driver_id);
create index if not exists trips_party_idx on public.trips (party_type, party_id);

-- -----------------------------------------------------------------------------
-- invoices
-- -----------------------------------------------------------------------------
create table if not exists public.invoices (
  id                uuid primary key default gen_random_uuid(),
  business_id       uuid not null references public.businesses (id) on delete cascade,
  trip_id           uuid references public.trips (id) on delete set null,
  invoice_type      text not null check (invoice_type in ('gst', 'non_gst')),
  invoice_number    text not null,
  invoice_date      date not null default current_date,
  amount            numeric(12, 2) not null default 0,
  tax_breakup       jsonb not null default '{}'::jsonb,
  status            text not null default 'unpaid'
                      check (status in ('draft', 'unpaid', 'part_paid', 'paid', 'cancelled')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (business_id, invoice_number)
);

create index if not exists invoices_business_id_idx on public.invoices (business_id);
create index if not exists invoices_trip_id_idx on public.invoices (trip_id);

-- -----------------------------------------------------------------------------
-- credit_debit_notes
-- -----------------------------------------------------------------------------
create table if not exists public.credit_debit_notes (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  type         text not null check (type in ('credit', 'debit')),
  amount       numeric(12, 2) not null check (amount > 0),
  reason       text,
  date         date not null default current_date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists credit_debit_notes_invoice_idx on public.credit_debit_notes (invoice_id);
create index if not exists credit_debit_notes_business_id_idx on public.credit_debit_notes (business_id);

-- -----------------------------------------------------------------------------
-- expenses
-- -----------------------------------------------------------------------------
create table if not exists public.expenses (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses (id) on delete cascade,
  category       text not null
                   check (category in ('fuel', 'toll', 'driver_batta', 'maintenance',
                                       'tyre', 'insurance', 'permit', 'office',
                                       'salary', 'loan_emi', 'other')),
  vehicle_id     uuid references public.vehicles (id) on delete set null,
  trip_id        uuid references public.trips (id) on delete set null,
  date           date not null default current_date,
  amount         numeric(12, 2) not null check (amount > 0),
  payment_mode   text not null default 'cash'
                   check (payment_mode in ('cash', 'upi', 'bank', 'card', 'credit')),
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists expenses_business_id_idx on public.expenses (business_id);
create index if not exists expenses_date_idx on public.expenses (business_id, date desc);
create index if not exists expenses_vehicle_idx on public.expenses (vehicle_id);
create index if not exists expenses_trip_idx on public.expenses (trip_id);

-- -----------------------------------------------------------------------------
-- opening_balances
-- -----------------------------------------------------------------------------
create table if not exists public.opening_balances (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses (id) on delete cascade,
  party_type   text not null check (party_type in ('client', 'broker', 'driver')),
  party_id     uuid not null,
  amount       numeric(12, 2) not null default 0,
  as_of_date   date not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, party_type, party_id)
);

comment on column public.opening_balances.amount is
  'Positive = the party owes the business. Negative = the business owes the party.';

-- -----------------------------------------------------------------------------
-- vehicle_maintenance_log
-- -----------------------------------------------------------------------------
create table if not exists public.vehicle_maintenance_log (
  id                 uuid primary key default gen_random_uuid(),
  business_id        uuid not null references public.businesses (id) on delete cascade,
  vehicle_id         uuid not null references public.vehicles (id) on delete cascade,
  type               text not null
                       check (type in ('tyre', 'battery', 'service', 'repair', 'other')),
  date               date not null default current_date,
  cost               numeric(12, 2) not null default 0 check (cost >= 0),
  odometer_reading   integer check (odometer_reading >= 0),
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists vehicle_maintenance_log_vehicle_idx
  on public.vehicle_maintenance_log (vehicle_id, date desc);
create index if not exists vehicle_maintenance_log_business_id_idx
  on public.vehicle_maintenance_log (business_id);

-- -----------------------------------------------------------------------------
-- insurance_claims
-- -----------------------------------------------------------------------------
create table if not exists public.insurance_claims (
  id                  uuid primary key default gen_random_uuid(),
  business_id         uuid not null references public.businesses (id) on delete cascade,
  vehicle_id          uuid not null references public.vehicles (id) on delete cascade,
  claim_date          date not null default current_date,
  incident_note       text,
  claim_amount        numeric(12, 2) not null default 0 check (claim_amount >= 0),
  settlement_amount   numeric(12, 2) check (settlement_amount >= 0),
  status              text not null default 'filed'
                        check (status in ('filed', 'under_review', 'settled', 'rejected')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists insurance_claims_vehicle_idx on public.insurance_claims (vehicle_id);
create index if not exists insurance_claims_business_id_idx on public.insurance_claims (business_id);

-- -----------------------------------------------------------------------------
-- documents — file metadata; bytes live in Supabase Storage
-- -----------------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  owner_type    text not null check (owner_type in ('vehicle', 'driver', 'trip', 'business')),
  owner_id      uuid not null,
  file_url      text not null,
  doc_type      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_owner_idx on public.documents (owner_type, owner_id);
create index if not exists documents_business_id_idx on public.documents (business_id);

-- -----------------------------------------------------------------------------
-- audit_log — written by triggers in a later phase, table created now so the
-- schema does not need reshaping when Phase 5 lands.
-- -----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id           bigserial primary key,
  business_id  uuid references public.businesses (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  table_name   text not null,
  record_id    uuid,
  action       text not null check (action in ('insert', 'update', 'delete')),
  changed_at   timestamptz not null default now(),
  diff         jsonb
);

create index if not exists audit_log_business_idx on public.audit_log (business_id, changed_at desc);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'businesses', 'users', 'vehicles', 'drivers', 'driver_advances',
    'driver_salary_payments', 'clients', 'brokers', 'quotations', 'trips',
    'invoices', 'credit_debit_notes', 'expenses', 'opening_balances',
    'vehicle_maintenance_log', 'insurance_claims', 'documents'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;
