-- Undoes 20261108120000_guideline_versions_admin.sql. Deploy a frontend without these pages first.
--
-- THIS LOSES DATA: every version added since (guideline_version_drafts), and the source and PDF
-- recorded on published versions. Titles and SFDA issue dates edited since stay as they are.
-- The guideline-files bucket and its files are kept: remove them in the Supabase dashboard
-- (Storage) if they are no longer needed. SQL can't delete Storage files.
begin;
drop policy if exists "Admins can upload guideline files" on storage.objects;
drop policy if exists "Admins can read guideline files" on storage.objects;
drop policy if exists "Admins can remove unused guideline files" on storage.objects;
drop function if exists public.create_guideline_draft(text, text, date, text, text, text);
drop function if exists public.update_guideline_draft(uuid, text, text, date, text);
drop function if exists public.update_guideline_version(uuid, text, date, text);
drop function if exists public.attach_guideline_file(uuid, text);
drop function if exists public.delete_guideline_draft(uuid);
drop function if exists public.check_new_guideline_number(text, uuid);
drop function if exists public.check_guideline_details(text, date, text, date);
drop function if exists public.check_guideline_file(text);
drop function if exists public.guideline_number_parts(text);
drop function if exists public.is_unused_guideline_path(text);
drop table if exists public.guideline_version_drafts;
alter table public.guideline_versions
  drop column if exists source,
  drop column if exists storage_path,
  drop column if exists file_size;
notify pgrst, 'reload schema';
commit;
