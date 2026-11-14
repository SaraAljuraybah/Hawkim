-- Multi-tenant, step 12: the list of stored files still to move into their organization's folder.
--
-- storage_paths_to_relocate() (service role only) lists, for supabase/scripts/move_storage_to_organizations.mjs,
-- every path a row uses that isn't in the row's organization's folder yet, with the path it moves to:
--   sop-files          sop_versions.storage_path, department_file_deletion_items.storage_path
--   guideline-files    guideline_versions.storage_path, guideline_version_drafts.storage_path
--   guideline-indexes  guideline_versions.index_path, guideline_version_drafts.index_path (a folder)
-- The new path is always the old one in the row's organization's folder, as relocate_storage_path requires.
-- After the move it returns no rows. Read only: nothing is changed here.
--
-- Undo: drop function public.storage_paths_to_relocate();

begin;

create function public.storage_paths_to_relocate()
returns table (bucket text, old_path text, new_path text, organization_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct x.bucket, x.old_path, x.organization_id::text || '/' || x.old_path, x.organization_id
  from (
    select 'sop-files'::text as bucket, v.storage_path as old_path, v.organization_id from public.sop_versions v
    union all
    select 'sop-files', i.storage_path, i.organization_id from public.department_file_deletion_items i where i.bucket_id = 'sop-files'
    union all
    select 'guideline-files', g.storage_path, g.organization_id from public.guideline_versions g
    union all
    select 'guideline-files', d.storage_path, d.organization_id from public.guideline_version_drafts d
    union all
    select 'guideline-indexes', g.index_path, g.organization_id from public.guideline_versions g
    union all
    select 'guideline-indexes', d.index_path, d.organization_id from public.guideline_version_drafts d
  ) x
  where x.old_path is not null and btrim(x.old_path) <> ''
    and x.old_path not like x.organization_id::text || '/%'
  order by 1, 2;
$$;

alter function public.storage_paths_to_relocate() owner to postgres;
revoke all on function public.storage_paths_to_relocate() from public, anon, authenticated, service_role;
grant execute on function public.storage_paths_to_relocate() to service_role;

notify pgrst, 'reload schema';
commit;
