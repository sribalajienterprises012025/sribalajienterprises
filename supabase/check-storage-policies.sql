-- Did the storage policies actually land?
--
-- supabase/storage-policies.sql has to be run by hand, in the SQL Editor,
-- because on a hosted project the role running migrations does not own
-- storage.objects. A step done by hand is a step that can silently not happen,
-- and nothing in the app fails loudly when it hasn't: a driver's photo upload
-- is refused, and — the part that matters — the old read policy stays in
-- place, which lets any member of the business read any file in its folder,
-- invoice PDFs and insurance papers included.
--
-- Paste this into the Supabase SQL Editor. Four lines, all reading "ok".

select 'documents_read scoped by role' as check,
       case when exists (
         select 1 from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname = 'documents_read'
           and qual like '%driver_may_touch_object%'
       ) then 'ok' else 'NOT APPLIED — run supabase/storage-policies.sql' end as result

union all
select 'documents_upload allows a driver',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname = 'documents_upload'
           and with_check like '%driver_may_touch_object%'
       ) then 'ok' else 'NOT APPLIED — run supabase/storage-policies.sql' end

union all
select 'only the owner deletes a file',
       case when exists (
         select 1 from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname = 'documents_delete'
       ) then 'ok' else 'NOT APPLIED — run supabase/storage-policies.sql' end

union all
select 'the documents bucket exists and is private',
       coalesce((
         select case when public then 'PUBLIC — it must not be' else 'ok' end
         from storage.buckets where id = 'documents'
       ), 'MISSING — create it or re-run the storage migration');
