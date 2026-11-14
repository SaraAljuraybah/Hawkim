-- Multi-tenant, step 18: moving the stored files back out of the organization's folder (the way back of
-- supabase/scripts/move_storage_to_organizations.mjs, run with --reverse), for undoing the release after
-- the files were moved. Only while MedCare is the only organization: without the folder, two organizations'
-- paths could be the same, so both functions refuse once there are more.
--
-- storage_paths_to_restore() (service role only): every path a row uses in its organization's folder, with
--   the path it moves back to (the same path without '<organization id>/').
-- restore_storage_path(bucket, old, new) (service role only): points the rows that use the file p_old_path
--   to p_new_path, only when p_old_path is p_new_path in the row's organization's folder.
-- They are the reverse of storage_paths_to_relocate (20261117120000) and relocate_storage_path
-- (20261116230000), which they leave unchanged.
--
-- Undo: drop function public.restore_storage_path(text, text, text); drop function public.storage_paths_to_restore();

begin;

create function public.storage_paths_to_restore()
returns table (bucket text, old_path text, new_path text, organization_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception 'More than one organization exists; their files can''t leave their folders' using errcode = '55000';
  end if;
  return query
  select distinct x.bucket, x.path, substr(x.path, length(x.organization_id::text) + 2), x.organization_id
  from (
    select 'sop-files'::text as bucket, v.storage_path as path, v.organization_id from public.sop_versions v
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
  where x.path like x.organization_id::text || '/%'
  order by 1, 2;
end;
$$;

-- The rows that use p_old_path (in their organization's folder) use p_new_path again. Returns how many.
create function public.restore_storage_path(p_bucket text, p_old_path text, p_new_path text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  changed integer := 0;
  n integer;
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception 'More than one organization exists; their files can''t leave their folders' using errcode = '55000';
  end if;
  if p_old_path is null or p_new_path is null or btrim(p_new_path) = '' then
    raise exception 'Both paths are required' using errcode = '22023';
  end if;
  -- Lets guard_retained_sop accept the storage_path of a deleted SOP's version (this transaction only).
  perform pg_catalog.set_config('hawkim.relocating_storage', 'on', true);
  if p_bucket = 'sop-files' then
    update public.sop_versions v set storage_path = p_new_path
    where v.storage_path = p_old_path and p_old_path = v.organization_id::text || '/' || p_new_path;
    get diagnostics n = row_count; changed := changed + n;
    update public.department_file_deletion_items i set storage_path = p_new_path
    where i.bucket_id = 'sop-files' and i.storage_path = p_old_path and p_old_path = i.organization_id::text || '/' || p_new_path;
    get diagnostics n = row_count; changed := changed + n;
  elsif p_bucket = 'guideline-files' then
    update public.guideline_versions g set storage_path = p_new_path
    where g.storage_path = p_old_path and p_old_path = g.organization_id::text || '/' || p_new_path;
    get diagnostics n = row_count; changed := changed + n;
    update public.guideline_version_drafts d set storage_path = p_new_path
    where d.storage_path = p_old_path and p_old_path = d.organization_id::text || '/' || p_new_path;
    get diagnostics n = row_count; changed := changed + n;
  elsif p_bucket = 'guideline-indexes' then
    update public.guideline_versions g set index_path = p_new_path
    where g.index_path = p_old_path and p_old_path = g.organization_id::text || '/' || p_new_path;
    get diagnostics n = row_count; changed := changed + n;
    update public.guideline_version_drafts d set index_path = p_new_path
    where d.index_path = p_old_path and p_old_path = d.organization_id::text || '/' || p_new_path;
    get diagnostics n = row_count; changed := changed + n;
  else
    raise exception 'Unknown bucket %', p_bucket using errcode = '22023';
  end if;
  perform pg_catalog.set_config('hawkim.relocating_storage', '', true);
  return changed;
end;
$$;

alter function public.storage_paths_to_restore() owner to postgres;
alter function public.restore_storage_path(text, text, text) owner to postgres;
revoke all on function public.storage_paths_to_restore(), public.restore_storage_path(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.storage_paths_to_restore(), public.restore_storage_path(text, text, text) to service_role;

notify pgrst, 'reload schema';
commit;
