-- Signed-in, active users can read (and so get a signed link to) the PDF of a published GVP version:
-- one whose file is recorded in guideline_versions. Files of versions an admin added
-- (guideline_version_drafts) and unused files stay admin-only. Uploading and removing are unchanged
-- (admins only).
--
-- Additive: adds one helper function and one read policy on storage.objects. Policies are permissive,
-- so the admins' existing read policy still applies. No existing table, row, function or policy changes.
-- Undo: supabase/scripts/rollback_guideline_files_read_published.sql

begin;

-- Whether a published version uses this file. A function, because guideline_versions has its own
-- "name" column, which would hide storage.objects.name inside a subquery in the policy.
create function public.is_published_guideline_path(p_path text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.guideline_versions g where g.storage_path = p_path);
$$;

alter function public.is_published_guideline_path(text) owner to postgres;
revoke all on function public.is_published_guideline_path(text) from public, anon, authenticated, service_role;
-- The policy runs it as the signed-in user.
grant execute on function public.is_published_guideline_path(text) to authenticated;

create policy "Active users can read published guideline files"
on storage.objects for select to authenticated
using (
  bucket_id = 'guideline-files'
  and (select public.is_active_user())
  and public.is_published_guideline_path(name)
);

commit;
