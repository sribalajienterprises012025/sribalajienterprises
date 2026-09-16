-- =============================================================================
-- The driver write functions were handing the trip row back.
--
-- All four returned `public.trips`, which carries freight_amount,
-- broker_commission, advance_received and tds_deducted. The app ignores the
-- return value, so nothing looked wrong — but a driver holds the same
-- publishable key as everyone else, and
--
--   POST /rest/v1/rpc/driver_log_odometer
--
-- hands them the whole row. Every other door was shut: the trips table refuses
-- them, and my_trips does not carry a money column. This one was standing open,
-- and it was open through a function they are meant to call.
--
-- `driver_own_trip` was worse. It returns the trip row and does nothing else,
-- and `revoke all ... from public` was not enough to keep it out of reach:
-- Supabase's default privileges grant EXECUTE on every new function in `public`
-- to anon and authenticated explicitly, and revoking from PUBLIC does not touch
-- a grant made to a named role. So it stayed callable, by anyone.
--
-- Found by asking the live project rather than by reading the code:
--
--   $ curl -s .../rpc/driver_own_trip -d '{"p_trip_id":"..."}'
--   {"code":"42501","message":"Only a driver can do that"}
--
-- A function that is not callable answers PGRST202. This one answered from
-- inside its own body, which means it ran.
--
-- The functions now return nothing, and every grant is named rather than
-- assumed. Two assertions in the suite check the grants directly, because the
-- next function added here will get the same default privileges.
-- =============================================================================

drop function if exists public.driver_log_odometer(uuid, integer, integer);
drop function if exists public.driver_set_trip_status(uuid, text);
drop function if exists public.driver_log_expense(uuid, text, numeric, text, text, date);
drop function if exists public.driver_attach_pod(uuid, text);

create function public.driver_log_odometer(
  p_trip_id uuid,
  p_start   integer,
  p_end     integer
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips := public.driver_own_trip(p_trip_id);
begin
  if v_trip.status in ('closed', 'cancelled') then
    raise exception 'That trip is closed' using errcode = '42501';
  end if;

  if p_start is not null and p_start < 0 then
    raise exception 'A meter reading cannot be negative' using errcode = '22023';
  end if;

  -- Checked against what the trip will hold afterwards, not only against what
  -- was passed: sending just the closing reading must still be compared with
  -- the opening one already on the row.
  if coalesce(p_end, v_trip.odometer_end) is not null
     and coalesce(p_start, v_trip.odometer_start) is not null
     and coalesce(p_end, v_trip.odometer_end) < coalesce(p_start, v_trip.odometer_start)
  then
    raise exception 'The closing reading is below the opening one'
      using errcode = '22023';
  end if;

  update public.trips
     set odometer_start = coalesce(p_start, odometer_start),
         odometer_end   = coalesce(p_end, odometer_end),
         updated_at     = now()
   where id = p_trip_id;
end;
$$;

create function public.driver_set_trip_status(
  p_trip_id uuid,
  p_status  text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips := public.driver_own_trip(p_trip_id);
begin
  -- A driver says "I have started" and "I have delivered". Everything after
  -- that — payment pending, closed — is the office's word, not theirs.
  if p_status not in ('in_transit', 'delivered') then
    raise exception 'A driver cannot set a trip to %', p_status
      using errcode = '42501';
  end if;

  if v_trip.status in ('closed', 'cancelled') then
    raise exception 'That trip is closed' using errcode = '42501';
  end if;

  update public.trips
     set status = p_status, updated_at = now()
   where id = p_trip_id;
end;
$$;

create function public.driver_log_expense(
  p_trip_id      uuid,
  p_category     text,
  p_amount       numeric,
  p_payment_mode text default 'cash',
  p_note         text default null,
  p_date         date default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips := public.driver_own_trip(p_trip_id);
begin
  -- What a driver spends on the road. Salary, EMI, insurance and the rest are
  -- the office's to record, and are not in this list for that reason.
  if p_category not in ('fuel', 'toll', 'other') then
    raise exception 'A driver cannot log a % expense', p_category
      using errcode = '42501';
  end if;

  if p_category = 'other' and coalesce(btrim(p_note), '') = '' then
    raise exception 'Say what the expense was for' using errcode = '23514';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'An amount is needed' using errcode = '23514';
  end if;

  if p_payment_mode not in ('cash', 'upi', 'bank', 'card', 'credit') then
    raise exception 'Unknown payment mode %', p_payment_mode using errcode = '23514';
  end if;

  insert into public.expenses
    (business_id, category, vehicle_id, trip_id, date, amount, payment_mode, note)
  values
    (v_trip.business_id, p_category, v_trip.vehicle_id, v_trip.id,
     coalesce(p_date, current_date), p_amount, p_payment_mode, nullif(btrim(p_note), ''));
end;
$$;

create function public.driver_attach_pod(
  p_trip_id  uuid,
  p_file_url text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trip public.trips := public.driver_own_trip(p_trip_id);
begin
  if coalesce(btrim(p_file_url), '') = '' then
    raise exception 'No file was given' using errcode = '23514';
  end if;

  -- The path is checked, not trusted: an upload that landed outside this
  -- business's folder must not be recordable against one of its trips.
  if split_part(p_file_url, '/', 1) <> v_trip.business_id::text then
    raise exception 'That file does not belong to this business'
      using errcode = '42501';
  end if;

  update public.trips
     set pod_file_url = p_file_url, updated_at = now()
   where id = p_trip_id;

  insert into public.documents (business_id, owner_type, owner_id, file_url, doc_type)
  values (v_trip.business_id, 'trip', v_trip.id, p_file_url, 'pod');
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants, named rather than assumed.
--
-- Every one of these revokes from anon and authenticated by name, because that
-- is who the default privileges granted to. Revoking from PUBLIC, which is what
-- the rest of this schema does, leaves those grants in place.
-- -----------------------------------------------------------------------------

-- Internal. It returns the whole trip row, money included, and exists only so
-- the four functions above can start by proving the trip is the caller's. They
-- run as the owner, so they can still call it; nobody else can.
revoke all on function public.driver_own_trip(uuid) from public, anon, authenticated;

-- A driver is signed in. An anonymous visitor has no trips and no driver
-- record, so these already failed for them — but failing at the door is
-- better than failing four lines into the body.
revoke all on function public.driver_log_odometer(uuid, integer, integer) from public, anon;
revoke all on function public.driver_set_trip_status(uuid, text) from public, anon;
revoke all on function public.driver_log_expense(uuid, text, numeric, text, text, date) from public, anon;
revoke all on function public.driver_attach_pod(uuid, text) from public, anon;
revoke all on function public.driver_may_touch_object(text) from public, anon;

grant execute on function public.driver_log_odometer(uuid, integer, integer) to authenticated;
grant execute on function public.driver_set_trip_status(uuid, text) to authenticated;
grant execute on function public.driver_log_expense(uuid, text, numeric, text, text, date) to authenticated;
grant execute on function public.driver_attach_pod(uuid, text) to authenticated;
grant execute on function public.driver_may_touch_object(text) to authenticated;
