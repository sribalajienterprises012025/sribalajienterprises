-- =============================================================================
-- Storage — proof-of-delivery photos, RC/insurance scans, licence copies.
--
-- Path convention:  <business_id>/<owner_type>/<owner_id>/<filename>
-- The leading folder is the tenant key, and the policies below check it, so a
-- signed-in user can never read or write another business's files.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Become whoever owns storage.objects, if that is not already us.
--
-- CREATE POLICY requires ownership of the table, and on a hosted Supabase
-- project storage.objects belongs to supabase_storage_admin rather than to the
-- role running the migration. The postgres role is granted membership in it, so
-- becoming it is enough; without this, `supabase db push` stops here with
-- "must be owner of table objects".
--
-- Keyed on actual ownership rather than on a role name, so a local stack, a
-- self-hosted one, or the test harness -- where the migrating role already owns
-- the table -- skips the switch instead of assuming a Supabase-specific role.
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner name;
begin
  select pg_get_userbyid(c.relowner) into v_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects';

  if v_owner is null then
    raise exception
      'storage.objects was not found. Storage has to be enabled on the project '
      'before this migration can set its access policies.';
  end if;

  if v_owner = current_user then
    return;
  end if;

  if pg_has_role(current_user, v_owner, 'MEMBER') then
    execute format('set role %I', v_owner);
  else
    raise exception
      'cannot manage storage policies: % owns storage.objects and % is not a '
      'member of it. Apply this migration from the Supabase SQL Editor instead, '
      'which runs with the necessary rights.', v_owner, current_user;
  end if;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  10485760, -- 10 MB; POD photos from a phone camera sit well under this
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists documents_read on storage.objects;
create policy documents_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
  );

drop policy if exists documents_upload on storage.objects;
create policy documents_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() in ('owner', 'helper')
  );

drop policy if exists documents_update on storage.objects;
create policy documents_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() in ('owner', 'helper')
  );

drop policy if exists documents_delete on storage.objects;
create policy documents_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = public.current_business_id()::text
    and public.current_user_role() = 'owner'
  );

-- Back to the migrating role, so anything applied after this file is unaffected.
reset role;
