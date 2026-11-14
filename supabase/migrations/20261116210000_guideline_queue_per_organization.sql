-- Multi-tenant, step 9: one GVP version in the queue per organization, and its place in the queue.
--
-- The compliance service (one worker for every organization) processes added GVP versions one at a time,
-- oldest first, across all organizations. Compliance checks go before GVP versions, so a version being
-- processed delays every organization's checks, and checks delay the versions.
--
-- 1. "One version at a time" is now per organization: an organization can't add (or retry) a version while
--    one of its own is waiting or being processed; other organizations' versions don't block it. The
--    database enforces it too (a partial unique index on organization_id).
-- 2. guideline_queue_position(version): for the caller's organization's Admins, the place of a waiting
--    version in the queue (1 = processed next), counting every organization's waiting versions in the order
--    the service takes them; null when it isn't waiting. It returns only that number: nothing about the
--    other organizations' versions.
-- create_guideline_draft and retry_guideline_processing are their LATEST definitions (pg_get_functiondef)
-- with only the changes named above them; signatures, SECURITY DEFINER, search_path, owners and grants
-- are unchanged.
--
-- Undo: supabase/scripts/rollback_guideline_queue_per_organization.sql

begin;

-- ---------- 1. One version in the queue per organization ----------

do $$
declare crowded text;
begin
  select string_agg(o.name || ': ' || versions, '; ') into crowded
  from (
    select d.organization_id, string_agg(d.version || ' (' || d.processing_status || ')', ', ' order by d.created_at) as versions
    from public.guideline_version_drafts d
    where d.processing_status in ('waiting', 'processing')
    group by d.organization_id having count(*) > 1
  ) c join public.organizations o on o.id = c.organization_id;
  if crowded is not null then
    raise exception 'More than one GVP version is waiting or being processed in one organization (%). Let the compliance service finish them, or delete one, then apply this migration.', crowded;
  end if;
end;
$$;

create unique index guideline_version_drafts_one_in_queue on public.guideline_version_drafts (organization_id)
  where processing_status in ('waiting', 'processing');

-- ---------- 2. The functions ----------

-- create_guideline_draft: one waiting or processing version per organization (was: in the whole database); the new version is in the caller's organization (set by the database).
CREATE OR REPLACE FUNCTION public.create_guideline_draft(p_name text, p_version text, p_issued_date date, p_source text, p_storage_path text, p_file_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file_size bigint;
  v_new_id uuid;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform public.lock_organization_changes(public.current_organization_id());
  -- Again, under the lock: another admin may have just removed this caller's Admin.
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;

  -- One version at a time per organization: the compliance service processes added versions one after
  -- another, for every organization, in the order they were added.
  if exists (select 1 from public.guideline_version_drafts d
             where d.organization_id = public.current_organization_id() and d.processing_status in ('waiting', 'processing')) then
    raise exception 'Another GVP version is still being processed' using errcode = '55006', hint = 'version-processing';
  end if;
  perform public.check_guideline_details(p_name, p_issued_date, p_source, (now() at time zone 'Asia/Riyadh')::date);
  perform public.check_new_guideline_number(p_version, null);
  if p_file_name is null or length(btrim(p_file_name)) not between 1 and 255 or lower(btrim(p_file_name)) not like '%.pdf' then
    raise exception 'Only PDF files can be added' using errcode = '23514', hint = 'file-not-pdf';
  end if;
  v_file_size := public.check_guideline_file(p_storage_path);

  insert into public.guideline_version_drafts (name, version, issued_date, source, file_name, storage_path, file_size, created_by)
  values (btrim(p_name), btrim(p_version), p_issued_date, btrim(p_source), btrim(p_file_name), p_storage_path, v_file_size, (select auth.uid()))
  returning id into v_new_id;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'add-guideline-version', v_new_id::text,
    jsonb_build_object('version', btrim(p_version), 'name', btrim(p_name), 'storage_path', p_storage_path));
  return v_new_id;
end;
$function$;

-- retry_guideline_processing: only a version of the caller's organization, and only while no other version of it is waiting or being processed (the same rule as adding one).
CREATE OR REPLACE FUNCTION public.retry_guideline_processing(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  perform public.lock_organization_changes(public.current_organization_id());
  if exists (select 1 from public.guideline_version_drafts d
             where d.organization_id = public.current_organization_id() and d.id <> p_id and d.processing_status in ('waiting', 'processing')) then
    raise exception 'Another GVP version is still being processed' using errcode = '55006', hint = 'version-processing';
  end if;
  update public.guideline_version_drafts
  set processing_status = 'waiting', processing_started_at = null, processed_at = null, processing_error = null
  where id = p_id and organization_id = public.current_organization_id() and processing_status = 'failed';
  if not found then
    raise exception 'Only a version whose processing failed can be processed again' using errcode = 'P0001';
  end if;
end;
$function$;

-- The place of a waiting version of the caller's organization in the queue of every organization's waiting
-- versions, in the order claim_guideline_processing takes them (oldest first): 1 = processed next. Null when
-- the version isn't waiting, or isn't the caller's organization's. Active Admins only.
create function public.guideline_queue_position(p_id uuid) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare draft public.guideline_version_drafts;
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  select * into draft from public.guideline_version_drafts d
  where d.id = p_id and d.organization_id = public.current_organization_id();
  if not found or draft.processing_status <> 'waiting' then
    return null;
  end if;
  return 1 + (
    select count(*) from public.guideline_version_drafts d
    where d.processing_status = 'waiting' and not d.cancel_requested
      and (d.created_at, d.id) < (draft.created_at, draft.id)
  )::integer;
end;
$$;

alter function public.guideline_queue_position(uuid) owner to postgres;
revoke all on function public.guideline_queue_position(uuid) from public, anon, authenticated, service_role;
grant execute on function public.guideline_queue_position(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
