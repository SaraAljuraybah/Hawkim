-- Undoes supabase/migrations/20261116180000_scope_sops.sql: one SOP numbering for the whole database again
-- (public.sop_code_counter, continuing from MedCare's counter), codes unique across it, and the functions as
-- they were before (pg_get_functiondef). Run as the owner (postgres), only while MedCare is the only organization.
begin;

do $$
begin
  if (select count(*) from public.organizations) > 1 then
    raise exception 'More than one organization exists; their SOP codes would clash';
  end if;
end;
$$;

create table public.sop_code_counter (
  id boolean primary key default true check (id),
  last_number integer not null default 0 check (last_number >= 0)
);
alter table public.sop_code_counter enable row level security;
revoke all on public.sop_code_counter from anon, authenticated;
insert into public.sop_code_counter (id, last_number) select true, o.last_sop_number from public.organizations o;

alter table public.sops drop constraint sops_organization_id_code_key;
alter table public.sops add constraint sops_code_key unique (code);

CREATE OR REPLACE FUNCTION public.can_view_sop(p_sop_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
    where s.id = p_sop_id and s.deleted_at is null
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or (exists (select 1 from public.review_requests q where q.sop_id = s.id and q.reviewer_id = p.id)
            and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$function$

;

CREATE OR REPLACE FUNCTION public.can_view_version(p_sop_id uuid, p_version integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
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
$function$

;

CREATE OR REPLACE FUNCTION public.can_read_review_note(p_sop_id uuid, p_people uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
    where s.id = p_sop_id
      and (s.author_id = p.id or public.is_co_author(s.id, p.id) or p.id = any (p_people))
  );
$function$

;

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
        and s.deleted_at is null
        and s.status = 'published'::public.sop_status
        and s.directory_group = 'department'
    );
$function$

;

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
$function$

;

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
$function$

;

CREATE OR REPLACE FUNCTION public.assign_sop_code()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  next_number integer;
begin
  update public.sop_code_counter set last_number = last_number + 1 where id returning last_number into next_number;
  -- At least three digits: SOP-001 … SOP-999, then SOP-1000.
  new.code := 'SOP-' || case when next_number < 1000 then lpad(next_number::text, 3, '0') else next_number::text end;
  return new;
end;
$function$

;

alter function public.assign_sop_code() security invoker;

notify pgrst, 'reload schema';
commit;
