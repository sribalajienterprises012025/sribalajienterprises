-- Who is in which business, and where the data actually is.
--
-- Two people not seeing each other's work has one common cause: they are not
-- in the same business. Every account that signs up and is not invited gets
-- offered "create your business", and taking that offer starts a separate,
-- empty set of books. The database then keeps the two apart correctly and
-- for ever — which is right, and is also exactly what it looks like when
-- something is wrong.
--
-- The other cause is a driver login, which is meant to see only its own trips.
--
-- Paste this into the Supabase SQL Editor. It reads, and changes nothing.

select case
  when (select count(*) from public.businesses) = 1
    then 'ONE business — everyone below shares the same books.'
  else format(
    '%s SEPARATE businesses. Anyone whose "business" column differs from '
    'the others cannot see their work, and never will.',
    (select count(*) from public.businesses))
end as verdict;

select
  u.name                                                              as "user",
  u.role                                                              as "role",
  b.name                                                              as "business",
  b.id                                                                as "business id",
  (select count(*) from public.trips    t where t.business_id = b.id) as "trips here",
  (select count(*) from public.expenses e where e.business_id = b.id) as "expenses here",
  (select count(*) from public.invoices i where i.business_id = b.id) as "invoices here",
  u.created_at                                                        as "account made"
from public.users u
join public.businesses b on b.id = u.business_id
order by b.created_at, u.created_at;

-- A business nobody is signed in to. Usually the leftover of an account that
-- was created twice.
select b.name as "business with no users", b.id, b.created_at
from public.businesses b
where not exists (select 1 from public.users u where u.business_id = b.id);
