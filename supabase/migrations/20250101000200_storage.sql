-- =============================================================================
-- Storage — proof-of-delivery photos, RC/insurance scans, licence copies.
--
-- Path convention:  <business_id>/<owner_type>/<owner_id>/<filename>
-- The leading folder is the tenant key, and the policies below check it, so a
-- signed-in user can never read or write another business's files.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The bucket and its access policies, applied as far as this connection's
-- rights allow.
--
-- CREATE POLICY requires ownership of the table, and on a hosted Supabase
-- project storage.objects belongs to supabase_storage_admin rather than to the
-- role running the migration. Where that role is a member of the owner,
-- becoming it is enough. Where it is not -- which is the case on newer
-- projects, connecting as `postgres` -- there is no way to create the policies
-- from here at all.
--
-- That case used to abort the migration, which took the six migrations after
-- this one down with it: no invoices, no ledgers, no reports, over a feature
-- that only covers file attachments. So it now warns and carries on. Every
-- other part of the app works; attaching documents does not, until the
-- policies in supabase/storage-policies.sql are applied by a role that can.
--
-- Keyed on actual ownership rather than on a role name, so a local stack, a
-- self-hosted one, or the test harness -- where the migrating role already owns
-- the table -- takes the direct path instead of assuming a Supabase-specific
-- role.
-- -----------------------------------------------------------------------------
do $$
declare
  v_owner name;
  v_can_manage boolean := false;
begin
  select pg_get_userbyid(c.relowner) into v_owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects';

  if v_owner is null then
    raise warning
      'Storage is not enabled on this project, so document attachments will '
      'not work. Enable Storage in the dashboard, then apply '
      'supabase/storage-policies.sql.';
    return;
  end if;

  -- The bucket is separate from the policies: creating it needs only insert
  -- rights on storage.buckets, which the migrating role normally has, so it
  -- can succeed even where the policies cannot.
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'documents',
      'documents',
      false,
      10485760, -- 10 MB; POD photos from a phone camera sit well under this
      array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
    )
    on conflict (id) do nothing;
  exception
    when insufficient_privilege then
      raise warning 'Could not create the documents bucket: %', sqlerrm;
  end;

  if v_owner = current_user then
    v_can_manage := true;
  elsif pg_has_role(current_user, v_owner, 'MEMBER') then
    execute format('set role %I', v_owner);
    v_can_manage := true;
  end if;

  if not v_can_manage then
    raise warning
      'Storage policies were NOT applied: % owns storage.objects and % is not '
      'a member of it. Everything except document attachments works. To finish '
      'storage, run supabase/storage-policies.sql as a role that owns '
      'storage.objects.', v_owner, current_user;
    return;
  end if;

  execute $p$
    drop policy if exists documents_read on storage.objects;
    create policy documents_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_business_id()::text
      );
  $p$;

  execute $p$
    drop policy if exists documents_upload on storage.objects;
    create policy documents_upload on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_business_id()::text
        and public.current_user_role() in ('owner', 'helper')
      );
  $p$;

  execute $p$
    drop policy if exists documents_update on storage.objects;
    create policy documents_update on storage.objects
      for update to authenticated
      using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_business_id()::text
        and public.current_user_role() in ('owner', 'helper')
      );
  $p$;

  execute $p$
    drop policy if exists documents_delete on storage.objects;
    create policy documents_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'documents'
        and (storage.foldername(name))[1] = public.current_business_id()::text
        and public.current_user_role() = 'owner'
      );
  $p$;

  -- Back to the migrating role, so anything applied after this is unaffected.
  reset role;
end;
$$;
