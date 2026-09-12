-- =============================================================================
-- Phase 2 — invoicing, payments and ledgers
--
-- Adds what invoicing needs beyond the Phase 1 tables:
--   * per-financial-year invoice numbering that is safe under concurrency
--   * a party on the invoice, so an invoice can stand on its own
--   * a payments table  (see the note on it below)
--   * ledger views, computed live rather than stored
-- =============================================================================

-- -----------------------------------------------------------------------------
-- invoices: party and tax breakdown as columns
--
-- party_type/party_id lets an invoice exist without a trip (a monthly
-- consolidated bill, a detention charge) and lets the client ledger read the
-- party straight off the invoice instead of joining back through trips.
--
-- taxable_value and tax_amount are pulled out of the tax_breakup jsonb because
-- the GST summary report aggregates them; jsonb would mean casting on every row.
-- `amount` stays the invoice total, taxable_value + tax_amount.
-- -----------------------------------------------------------------------------
alter table public.invoices
  add column if not exists party_type text
    check (party_type in ('client', 'broker')),
  add column if not exists party_id uuid,
  add column if not exists taxable_value numeric(12, 2) not null default 0,
  add column if not exists tax_amount numeric(12, 2) not null default 0,
  add column if not exists gst_rate numeric(5, 2) not null default 0
    check (gst_rate >= 0 and gst_rate <= 100),
  add column if not exists is_rcm boolean not null default false,
  add column if not exists place_of_supply text,
  add column if not exists due_date date,
  add column if not exists notes text;

comment on column public.invoices.is_rcm is
  'Reverse charge: GTA services where the recipient pays the GST. The invoice '
  'still shows the rate, but no tax is collected from the client.';
comment on column public.invoices.place_of_supply is
  'Two-digit GST state code. Equal to the business state means CGST + SGST, '
  'different means IGST.';

create index if not exists invoices_party_idx on public.invoices (party_type, party_id);
create index if not exists invoices_date_idx on public.invoices (business_id, invoice_date desc);

-- -----------------------------------------------------------------------------
-- invoice_counters — one sequence per business, per type, per financial year
--
-- A plain count(*) over invoices would hand the same number to two people
-- billing at once. The upsert below is atomic, so each caller gets its own.
-- -----------------------------------------------------------------------------
create table if not exists public.invoice_counters (
  business_id   uuid not null references public.businesses (id) on delete cascade,
  invoice_type  text not null check (invoice_type in ('gst', 'non_gst')),
  fy_label      text not null,
  last_number   integer not null default 0,
  primary key (business_id, invoice_type, fy_label)
);

-- -----------------------------------------------------------------------------
-- payments — receipts from clients, payouts to brokers
--
-- NOT in the original architecture document. Added because invoices.status
-- includes 'part_paid', which cannot be determined without a record of what has
-- actually been received, and because a transport business collects freight in
-- instalments as a matter of course.
--
-- trips.advance_received stays where it is (it is part of the trip record). The
-- ledgers subtract both that and the payments below, so an advance must not be
-- entered twice.
--
-- Drivers are deliberately not a party here: their money is already recorded by
-- driver_advances and driver_salary_payments, and a second place to record it
-- would double-count in the driver ledger.
-- -----------------------------------------------------------------------------
create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses (id) on delete cascade,
  party_type    text not null check (party_type in ('client', 'broker')),
  party_id      uuid not null,
  direction     text not null check (direction in ('in', 'out')),
  date          date not null default current_date,
  amount        numeric(12, 2) not null check (amount > 0),
  mode          text not null default 'bank'
                  check (mode in ('cash', 'upi', 'bank', 'cheque', 'card', 'adjustment')),
  reference     text,
  invoice_id    uuid references public.invoices (id) on delete set null,
  trip_id       uuid references public.trips (id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.payments.direction is
  'in = money received by the business. out = money paid out by the business.';

create index if not exists payments_business_idx on public.payments (business_id, date desc);
create index if not exists payments_party_idx on public.payments (party_type, party_id);
create index if not exists payments_invoice_idx on public.payments (invoice_id);

drop trigger if exists set_updated_at on public.payments;
create trigger set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- credit_debit_notes needs a party too, for the same reason invoices do.
alter table public.credit_debit_notes
  add column if not exists party_type text check (party_type in ('client', 'broker')),
  add column if not exists party_id uuid;

create index if not exists credit_debit_notes_party_idx
  on public.credit_debit_notes (party_type, party_id);

-- -----------------------------------------------------------------------------
-- Financial-year label for a date, honouring the business's FY start month.
-- April start (the Indian default) puts 2025-09-12 in '2025-26'.
-- -----------------------------------------------------------------------------
create or replace function public.fy_label(p_business_id uuid, p_date date)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when extract(month from p_date) >= b.fy_start_month
      then extract(year from p_date)::int || '-'
           || lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0')
    else (extract(year from p_date)::int - 1) || '-'
         || lpad((extract(year from p_date)::int % 100)::text, 2, '0')
  end
  from public.businesses b
  where b.id = p_business_id;
$$;

-- -----------------------------------------------------------------------------
-- next_invoice_number — GST/2025-26/0001
--
-- SECURITY DEFINER so it can touch invoice_counters, which the client has no
-- policies on. It re-checks tenancy and role itself, because a definer function
-- runs with the owner's rights and would otherwise be a way around RLS.
-- -----------------------------------------------------------------------------
create or replace function public.next_invoice_number(
  p_business_id uuid,
  p_invoice_type text,
  p_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_fy text;
  v_seq integer;
begin
  if p_business_id is distinct from public.current_business_id() then
    raise exception 'cannot allocate an invoice number for another business';
  end if;

  if public.current_user_role() not in ('owner', 'helper') then
    raise exception 'your role cannot create invoices';
  end if;

  if p_invoice_type not in ('gst', 'non_gst') then
    raise exception 'invoice_type must be gst or non_gst';
  end if;

  v_fy := public.fy_label(p_business_id, p_date);

  insert into public.invoice_counters (business_id, invoice_type, fy_label, last_number)
  values (p_business_id, p_invoice_type, v_fy, 1)
  on conflict (business_id, invoice_type, fy_label)
    do update set last_number = public.invoice_counters.last_number + 1
  returning last_number into v_seq;

  return case when p_invoice_type = 'gst' then 'GST' else 'NG' end
         || '/' || v_fy || '/' || lpad(v_seq::text, 4, '0');
end;
$$;

revoke all on function public.fy_label(uuid, date) from public;
revoke all on function public.next_invoice_number(uuid, text, date) from public;
grant execute on function public.fy_label(uuid, date) to authenticated;
grant execute on function public.next_invoice_number(uuid, text, date) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS for the new tables. Same shape as the Phase 1 operational tables:
-- owner and helper write, every role in the business reads.
-- invoice_counters gets no policy at all — only next_invoice_number touches it.
-- -----------------------------------------------------------------------------
alter table public.payments enable row level security;
alter table public.invoice_counters enable row level security;

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (business_id = public.current_business_id());

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  );

drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  )
  with check (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  );

drop policy if exists payments_delete on public.payments;
create policy payments_delete on public.payments
  for delete to authenticated
  using (
    business_id = public.current_business_id()
    and public.current_user_role() in ('owner', 'helper')
  );
