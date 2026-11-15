-- Deleting a version whose review never really started.
--
-- Until now any review round on a version protected it for good. But when every reviewer of a
-- round is removed, declines, lets the request expire or has it withdrawn before accepting,
-- settle_review_round closes the round and sends the SOP back to Draft: nobody reviewed that
-- version, yet the author could no longer delete it ("Versions previously submitted or
-- resubmitted for review cannot be deleted").
--
-- A version is now protected only when its review is active or really took place:
-- - a round on it that isn't closed (open: someone is still pending or reviewing; completed or
--   changes-requested: someone finished), or
-- - a request on it that a reviewer accepted, completed or returned, even if that reviewer was
--   removed afterwards (accepted_at, the status, or the status before removal), or
-- - a comment on it (sop_comments.version).
-- A closed round whose requests were all pending until they were removed, declined, expired or
-- withdrawn no longer protects the version.
--
-- Nothing else changes: the same actor, status and last-version rules (20261116180000_scope_sops.sql),
-- the row is still only marked deleted (so its number is never reused), and the round, its
-- requests and the timeline events stay as they are (the review history is kept). The grants are
-- unchanged (service_role only, through the delete-sop Edge Function).

begin;

create or replace function public.version_review_protected(p_sop_id uuid, p_version integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.review_rounds r
      where r.sop_id = p_sop_id and r.version = p_version and r.status <> 'closed'
    )
    or exists (
      select 1 from public.review_requests q
      join public.review_rounds r on r.id = q.round_id
      where r.sop_id = p_sop_id and r.version = p_version
        and (q.accepted_at is not null
             or q.status in ('accepted', 'completed', 'returned')
             or q.status_before_removal in ('accepted', 'completed', 'returned'))
    )
    or exists (
      select 1 from public.sop_comments c where c.sop_id = p_sop_id and c.version = p_version
    );
$$;
revoke execute on function public.version_review_protected(uuid, integer) from public, anon, authenticated;
grant execute on function public.version_review_protected(uuid, integer) to service_role;

CREATE OR REPLACE FUNCTION public.delete_sop_version(p_actor_id uuid, p_sop_id uuid, p_version integer)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := p_actor_id;
  sop public.sops;
  target public.sop_versions;
begin
  select * into sop from public.sops s where s.id = p_sop_id
    and s.organization_id = coalesce((select p.organization_id from public.profiles p where p.id = p_actor_id), s.organization_id) for update;
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
  -- Only an active review, or one a reviewer really took part in (see version_review_protected).
  if public.version_review_protected(p_sop_id, p_version) then
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
$function$;

commit;
