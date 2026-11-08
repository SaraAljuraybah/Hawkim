-- Undoes 20261108140000_guideline_files_read_published.sql: guideline PDFs become admin-only again
-- (authors then see "The file couldn't be opened." on the GVP page). No data is lost.
begin;
drop policy if exists "Active users can read published guideline files" on storage.objects;
drop function if exists public.is_published_guideline_path(text);
commit;
