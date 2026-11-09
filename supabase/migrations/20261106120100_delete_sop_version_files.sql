-- Deleting a version now also deletes its file. The delete-sop Edge Function calls this
-- function with the user it verified, then removes the returned file from sop-files with the
-- service role key. The browser can no longer call it directly (otherwise the version would
-- be marked deleted while its file stayed).
--
-- The rules are unchanged (20261026150000_internal_review.sql). auth.uid() is empty for
-- service_role, so is_active_user() is checked for p_actor_id instead, and, as in delete_sop,
-- the Auth account must not be deleted or banned. The row is still only marked deleted, so the
-- version number is never reused.

begin;

drop function public.delete_sop_version(uuid, integer);

create function public.delete_sop_version(p_actor_id uuid, p_sop_id uuid, p_version integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := p_actor_id;
  sop public.sops;
  target public.sop_versions;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  select * into target from public.sop_versions v where v.sop_id = p_sop_id and v.version = p_version and v.deleted_at is null;
  if sop.id is null or target.id is null then
    raise exception 'This version doesn''t exist' using errcode = 'no_data_found';
  end if;
  -- is_active_user() for the user the Edge Function verified, whose Auth account isn't deleted or banned.
  if actor is null
     or not exists (
       select 1 from public.profiles p
       join auth.users u on u.id = p.id
       where p.id = actor and p.deleted_at is null
         and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
     )
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

  -- The file for the Edge Function to remove (none if the path is empty).
  return nullif(target.storage_path, '');
end;
$$;

-- Only the Edge Function (service_role).
revoke execute on function public.delete_sop_version(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.delete_sop_version(uuid, uuid, integer) to service_role;

commit;
