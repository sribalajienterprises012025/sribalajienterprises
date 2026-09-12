-- =============================================================================
-- Storage — proof-of-delivery photos, RC/insurance scans, licence copies.
--
-- Path convention:  <business_id>/<owner_type>/<owner_id>/<filename>
-- The leading folder is the tenant key, and the policies below check it, so a
-- signed-in user can never read or write another business's files.
-- =============================================================================

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
