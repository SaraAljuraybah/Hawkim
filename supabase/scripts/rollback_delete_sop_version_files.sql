-- Undoes 20261106120100_delete_sop_version_files.sql: the browser calls delete_sop_version
-- directly again and files are kept. Files already deleted stay deleted.
-- Deploy a frontend that calls the RPC (before this change) first.
-- The definition below is the one from 20261026150000_internal_review.sql, with its grants.
begin;

drop function if exists public.delete_sop_version(uuid, uuid, integer);

create function public.delete_sop_version(p_sop_id uuid, p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  target public.sop_versions;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  select * into target from public.sop_versions v where v.sop_id = p_sop_id and v.version = p_version and v.deleted_at is null;
  if sop.id is null or target.id is null then
    raise exception 'This version doesn''t exist' using errcode = 'no_data_found';
  end if;
  if not public.is_active_user()
     or not (sop.author_id = actor or (target.uploaded_by = actor and public.is_co_author(p_sop_id, actor))) then
    raise exception 'Only the main author or the person who uploaded this version can delete it' using errcode = 'insufficient_privilege';
  end if;
  if sop.status not in ('draft', 'returned', 'in-review') then
    raise exception 'A version can''t be deleted while the SOP is %', sop.status using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.review_rounds r where r.sop_id = p_sop_id and r.version = p_version) then
    raise exception 'Versions previously submitted or resubmitted for review cannot be deleted' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.sop_versions v where v.sop_id = p_sop_id and v.deleted_at is null) <= 1 then
    raise exception 'At least one version must remain' using errcode = 'check_violation';
  end if;

  update public.sop_versions set deleted_at = now(), deleted_by = actor where id = target.id;

  update public.sops
  set current_version = case
        when current_version = p_version then
          (select max(v.version) from public.sop_versions v where v.sop_id = p_sop_id and v.deleted_at is null)
        else current_version end,
      updated_at = now()
  where id = p_sop_id;

  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (p_sop_id, 'version-deleted', actor, p_version);
end;
$$;

revoke execute on function public.delete_sop_version(uuid, integer) from public, anon;
grant execute on function public.delete_sop_version(uuid, integer) to authenticated;

commit;
