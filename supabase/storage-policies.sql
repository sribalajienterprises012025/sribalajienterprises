-- Storage access policies for the documents bucket.
--
-- Generated from supabase/migrations/20250101000200_storage.sql by
-- scripts/storage-policies.mjs. Edit the migration, not this file.
--
-- Needed only when `supabase db push` warned that it could not apply them,
-- which happens when the role running migrations does not own storage.objects.
-- Paste this into the Supabase SQL Editor and run it once. Everything else in
-- the app works without it; attaching documents does not.

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
