-- Multi-tenant, step 6: SOPs belong to one organization, and each organization numbers its own SOPs.
--
-- 1. SOP codes per organization: assign_sop_code takes the next number of the SOP's organization
--    (organizations.last_sop_number) and codes are unique within an organization, (organization_id, code),
--    so a new organization starts at SOP-001. MedCare's counter continues from the highest number it has
--    used (the old counter or its highest code, whichever is higher); public.sop_code_counter is dropped.
-- 2. Who may see an SOP or its files, and the delete-sop Edge Function's functions, only consider SOPs of
--    the caller's organization. Each function is its LATEST definition (pg_get_functiondef, with every
--    earlier migration applied) with only the change named above it. Signatures, SECURITY DEFINER,
--    search_path, owners and grants are unchanged.
--
-- Not changed, already within one organization (another organization's SOP gets the answer for an unknown
-- one): create_sop (only in the caller's home department), upload_sop_version, update_sop_description,
-- update_sop_details, add_co_authors, remove_co_author and assert_main_author (only the SOP's author or a
-- co-author, who are people of its organization: the composite foreign keys of
-- 20261116120000_organizations.sql), check_co_author (a co-author from the SOP's department), is_co_author,
-- can_read_sop_file, admin_can_read_published_version and admin_can_read_published_sop_file (they build on
-- the scoped functions), guard_retained_sop, guard_deleted_sop_update, guard_retained_sop_delete (one row).
-- check_sop_file and is_unused_sop_upload_path change with the storage paths.
--
-- Undo: supabase/scripts/rollback_scope_sops.sql

begin;

-- ---------- 1. SOP codes per organization ----------

do $$
begin
  if (select count(*) from public.organizations) <> 1 then
    raise exception 'Expected exactly one organization (MedCare) before moving the SOP counter';
  end if;
end;
$$;

update public.organizations o set last_sop_number = greatest(
  o.last_sop_number,
  coalesce((select c.last_number from public.sop_code_counter c where c.id), 0),
  coalesce((select max(substring(s.code from 5)::integer) from public.sops s), 0));

alter table public.sops drop constraint sops_code_key;
alter table public.sops add constraint sops_organization_id_code_key unique (organization_id, code);

-- ---------- 2. The functions ----------

-- can_view_sop: only an SOP of the caller's organization.
CREATE OR REPLACE FUNCTION public.can_view_sop(p_sop_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null and p.organization_id = s.organization_id
    where s.id = p_sop_id and s.deleted_at is null
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or (exists (select 1 from public.review_requests q where q.sop_id = s.id and q.reviewer_id = p.id)
            and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$function$;

-- can_view_version: only an SOP of the caller's organization.
CREATE OR REPLACE FUNCTION public.can_view_version(p_sop_id uuid, p_version integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null and p.organization_id = s.organization_id
    where s.id = p_sop_id and s.deleted_at is null
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or (exists (
          select 1 from public.review_requests q
          join public.review_rounds r on r.id = q.round_id
          where q.sop_id = s.id and q.reviewer_id = p.id and r.version = p_version
        ) and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$function$;

-- can_read_review_note: only an SOP of the caller's organization.
CREATE OR REPLACE FUNCTION public.can_read_review_note(p_sop_id uuid, p_people uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null and p.organization_id = s.organization_id
    where s.id = p_sop_id
      and (s.author_id = p.id or public.is_co_author(s.id, p.id) or p.id = any (p_people))
  );
$function$;

-- admin_can_read_published_sop: an Admin reads the published SOPs of their own organization only (was: every published SOP); admin_can_read_published_version and admin_can_read_published_sop_file build on it.
CREATE OR REPLACE FUNCTION public.admin_can_read_published_sop(p_sop_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select public.has_role('admin'::public.app_role)
    and exists (
      select 1 from public.sops s
      where s.id = p_sop_id
        and s.organization_id = public.current_organization_id()
        and s.deleted_at is null
        and s.status = 'published'::public.sop_status
        and s.directory_group = 'department'
    );
$function$;

-- delete_sop: the delete-sop Edge Function's actor only finds an SOP of their own organization (another organization's is "not found", as an unknown one); an actor without a profile is refused as before.
CREATE OR REPLACE FUNCTION public.delete_sop(p_actor_id uuid, p_sop_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sop public.sops;
  paths text[];
begin
  select * into sop from public.sops s where s.id = p_sop_id
    and s.organization_id = coalesce((select p.organization_id from public.profiles p where p.id = p_actor_id), s.organization_id) for update;
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
$function$;

-- delete_sop_version: as delete_sop.
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
$function$;

-- assign_sop_code: the next number of the SOP's own organization (organizations.last_sop_number), so each organization has SOP-001, SOP-002, ....
CREATE OR REPLACE FUNCTION public.assign_sop_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  next_number integer;
begin
  -- new.organization_id is already set: the a0_organization trigger runs first.
  update public.organizations o set last_sop_number = o.last_sop_number + 1
  where o.id = new.organization_id returning o.last_sop_number into next_number;
  -- At least three digits: SOP-001 … SOP-999, then SOP-1000.
  new.code := 'SOP-' || case when next_number < 1000 then lpad(next_number::text, 3, '0') else next_number::text end;
  return new;
end;
$function$;

-- assign_sop_code runs as the trigger's caller; it now updates organizations, which only its owner writes.
alter function public.assign_sop_code() security definer;
alter function public.assign_sop_code() owner to postgres;

drop table public.sop_code_counter;

notify pgrst, 'reload schema';
commit;
