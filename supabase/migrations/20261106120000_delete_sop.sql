-- The main author permanently deletes an SOP that isn't approved or published: every row
-- that belongs to it, in one transaction. Returns its code, title and the paths of all its
-- files (deleted versions included) in the sop-files bucket, so the delete-sop Edge Function
-- can log the deletion and remove the files (the database can't delete Storage files).
--
-- Only the Edge Function calls it (service_role), with the id of the user it verified from
-- the request's token. auth.uid() is empty for service_role, so the rules of
-- assert_main_author are checked here for p_actor_id. The browser can't call it: otherwise
-- rows could be deleted while the files stayed.
--
-- The justification is checked here (1-1000 characters after trimming); the Edge Function
-- logs it. No foreign keys change: the rows are deleted children first.

begin;

create function public.delete_sop(p_actor_id uuid, p_sop_id uuid, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  sop public.sops;
  paths text[];
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if sop.id is null then
    raise exception 'SOP not found' using errcode = 'no_data_found';
  end if;
  -- The same rules as assert_main_author, for the user the Edge Function verified (and not banned).
  if p_actor_id is null or sop.author_id <> p_actor_id or not exists (
    select 1 from public.profiles p
    join public.user_roles r on r.user_id = p.id and r.role = 'author'
    join auth.users u on u.id = p.id
    where p.id = p_actor_id and p.deleted_at is null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  ) then
    raise exception 'Only the active main Author can delete this SOP' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.departments d where d.id = sop.department_id and d.removed_at is null) then
    raise exception 'The SOP department is unavailable' using errcode = 'check_violation';
  end if;
  if sop.status not in ('draft', 'in-review', 'returned', 'in-approval') then
    raise exception 'An SOP can''t be deleted once it is %', sop.status using errcode = 'check_violation';
  end if;
  -- A running check would write its results to rows that no longer exist. Checks start under
  -- this same row lock, so none can start before this transaction ends. A check left behind
  -- (a sample check after 5 minutes, a service check after 30, as in start_compliance_check)
  -- isn't running any more and is deleted with the SOP.
  if exists (
    select 1 from public.compliance_checks c
    where c.sop_id = sop.id and c.status = 'running'
      and ((c.engine = 'sample' and c.started_at >= now() - interval '5 minutes')
        or (c.engine <> 'sample' and c.started_at >= now() - interval '30 minutes'))
  ) then
    raise exception 'This SOP can''t be deleted while a compliance check is running. Try again when it finishes.'
      using errcode = 'object_in_use';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A justification of up to 1000 characters is required to delete an SOP'
      using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(v.storage_path order by v.version), '{}') into paths
  from public.sop_versions v
  where v.sop_id = sop.id and v.storage_path is not null and v.storage_path <> '';

  -- Children first, in the order of supabase/scripts/reset_test_sops.sql, for this SOP only.
  delete from public.timeline_events where sop_id = sop.id;
  -- Requests and comments point at each other: unlink the requests from their comments first.
  update public.review_requests set comment_id = null where sop_id = sop.id and comment_id is not null;
  delete from public.sop_comments where sop_id = sop.id;
  delete from public.review_requests where sop_id = sop.id;
  delete from public.review_rounds where sop_id = sop.id;
  delete from public.compliance_findings f using public.compliance_checks c
    where f.check_id = c.id and c.sop_id = sop.id;
  delete from public.compliance_checks where sop_id = sop.id;
  delete from public.sop_co_authors where sop_id = sop.id;
  -- sops.current_version -> sop_versions is checked at commit, so the versions can go first.
  delete from public.sop_versions where sop_id = sop.id;
  delete from public.sops where id = sop.id;

  return jsonb_build_object('code', sop.code, 'title', sop.title, 'paths', to_jsonb(paths));
end;
$$;

-- Only the Edge Function (service_role). Supabase grants new functions to anon and
-- authenticated by default, so they are revoked explicitly.
revoke execute on function public.delete_sop(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.delete_sop(uuid, uuid, text) to service_role;

commit;
