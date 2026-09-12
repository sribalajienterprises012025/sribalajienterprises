-- =============================================================================
-- Seed data for the assertion suite.
--
-- Two businesses on purpose: almost every RLS bug is a tenancy leak, and one
-- business cannot prove isolation. Business B exists to be invisible.
-- =============================================================================

-- Fixed ids so assertions can refer to them directly.
\set biz_a aaaaaaaa-0000-0000-0000-00000000000a
\set biz_b bbbbbbbb-0000-0000-0000-00000000000b
\set owner_a 11111111-0000-0000-0000-000000000001
\set help_a 11111111-0000-0000-0000-000000000002
\set ca_a 11111111-0000-0000-0000-000000000003
\set owner_b 22222222-0000-0000-0000-000000000001

insert into auth.users (id, email) values
  (:'owner_a', 'owner.a@example.com'),
  (:'help_a',  'helper.a@example.com'),
  (:'ca_a',    'ca.a@example.com'),
  (:'owner_b', 'owner.b@example.com');

insert into public.businesses (id, name, gstin, pan, fy_start_month) values
  (:'biz_a', 'Balaji Enterprises', '36AAAPA1234A1Z5', 'AAAPA1234A', 4),
  (:'biz_b', 'Rival Transport',    '27AABCR9999R1Z5', 'AABCR9999R', 4);

insert into public.users (id, business_id, name, role) values
  (:'owner_a', :'biz_a', 'Owner A',  'owner'),
  (:'help_a',  :'biz_a', 'Helper A', 'helper'),
  (:'ca_a',    :'biz_a', 'CA A',     'ca'),
  (:'owner_b', :'biz_b', 'Owner B',  'owner');

-- --- business A's operating data ---------------------------------------------

\set veh_a 33333333-0000-0000-0000-000000000001
\set drv_a 44444444-0000-0000-0000-000000000001
\set cli_a 55555555-0000-0000-0000-000000000001
\set brk_a 66666666-0000-0000-0000-000000000001

insert into public.vehicles (id, business_id, reg_no, type, capacity, current_odometer, status)
values (:'veh_a', :'biz_a', 'TS 07 UB 4512', 'Container', 16, 180000, 'active');

insert into public.drivers (id, business_id, name, phone, salary_type, fixed_salary_amount)
values (:'drv_a', :'biz_a', 'Ramesh Yadav', '9876543210', 'fixed', 22000);

insert into public.clients (id, business_id, name, gstin, credit_limit, credit_period_days)
values (:'cli_a', :'biz_a', 'Sagar Cements Ltd', '36AABCS1429B1Z5', 500000, 30);

insert into public.brokers (id, business_id, name, commission_type, commission_rate)
values (:'brk_a', :'biz_a', 'Krishna Brokers', 'percentage', 4);

-- Client trip: ₹50,000 freight, ₹10,000 advance, ₹1,000 TDS, not yet invoiced.
\set trip1 77777777-0000-0000-0000-000000000001
insert into public.trips (
  id, business_id, vehicle_id, driver_id, party_type, party_id,
  pickup, drop_location, trip_date, freight_amount, advance_received,
  tds_deducted, bill_type, status, odometer_start, odometer_end
) values (
  :'trip1', :'biz_a', :'veh_a', :'drv_a', 'client', :'cli_a',
  'Hyderabad', 'Nagpur', current_date - 5, 50000, 10000,
  1000, 'gst', 'payment_pending', 180000, 180750
);

-- Broker trip: ₹60,000 freight, 4% = ₹2,400 commission.
\set trip2 77777777-0000-0000-0000-000000000002
insert into public.trips (
  id, business_id, vehicle_id, driver_id, party_type, party_id,
  pickup, drop_location, trip_date, freight_amount, broker_commission,
  advance_received, bill_type, status
) values (
  :'trip2', :'biz_a', :'veh_a', :'drv_a', 'broker', :'brk_a',
  'Vijayawada', 'Chennai', current_date - 2, 60000, 2400,
  0, 'gst', 'in_transit'
);

-- Expenses: ₹8,000 booked against trip 1, ₹5,000 general.
insert into public.expenses (business_id, category, vehicle_id, trip_id, date, amount, payment_mode)
values
  (:'biz_a', 'fuel', :'veh_a', :'trip1', current_date - 5, 8000, 'upi'),
  (:'biz_a', 'office', null, null, current_date - 4, 5000, 'cash');

insert into public.driver_advances (business_id, driver_id, date, amount, reason, adjusted)
values (:'biz_a', :'drv_a', current_date - 10, 3000, 'Trip batta', false);

insert into public.opening_balances (business_id, party_type, party_id, amount, as_of_date)
values (:'biz_a', 'client', :'cli_a', 12000, date_trunc('year', current_date)::date);

-- --- business B, which business A must never see -----------------------------

insert into public.vehicles (business_id, reg_no, type, current_odometer)
values (:'biz_b', 'MH 12 XX 0001', 'Tipper', 90000);

insert into public.clients (business_id, name)
values (:'biz_b', 'Rival Client Pvt Ltd');
