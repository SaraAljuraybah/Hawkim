-- Phase 8: the Hawkim compliance service (compliance-service/ in this repository).
--
-- The service retrieves GVP requirements with BGE-M3 and assesses each SOP procedure step with
-- Qwen2.5-7B-Instruct (the model selected in the project report; earlier comments that mention
-- Llama 3.1 8B predate that decision). It runs as a separate program with the secret key and
-- never in the browser:
--
-- 1. While it runs, it calls service_heartbeat every 30 seconds. start_compliance_check then
--    starts checks with its engine name ('hawkim'); when no heartbeat arrived in the last
--    2 minutes, checks still use the SAMPLE engine, as before.
-- 2. It claims the oldest running check of its engine (claim_compliance_check), downloads the
--    SOP version from the sop-files bucket and runs the pipeline.
-- 3. It writes one finding per GVP requirement and completes the check
--    (complete_compliance_check), or marks it failed with the reason (fail_compliance_check).
--    The requirement each finding refers to is added to guideline_requirements of the check's
--    guideline version if it isn't there yet (code: the requirement unit, e.g. 'I.B.7#4').
--
-- Unchanged: who can run a check and when, one running check per SOP, one completed check per
-- version and guideline version, the current guideline version, and the sample engine
-- (finish_sample_check) for checks started while the service is offline. Changed in
-- start_compliance_check: a check of the service still running after 30 minutes is marked failed
-- when the next check of that SOP starts, and while the service is online a version whose
-- completed check is a sample result can be checked again to get a real result.

-- ---------- Service status ----------

create table public.compliance_service_status (
  -- A single row.
  id boolean primary key default true check (id),
  engine text not null check (length(btrim(engine)) between 1 and 100 and engine <> 'sample'),
  engine_version text check (engine_version is null or length(engine_version) <= 100),
  last_seen timestamptz not null default now()
);

alter table public.compliance_service_status enable row level security;
-- No policies and no grants: only the functions below read or change it.
revoke all on public.compliance_service_status from anon, authenticated;

-- The engine new checks use: the service's while it is online, otherwise 'sample'.
create function public.compliance_engine() returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.engine from public.compliance_service_status s where s.last_seen > now() - interval '2 minutes'),
    'sample'
  );
$$;

-- ---------- Starting a check (as before, with the engine chosen above) ----------

create or replace function public.start_compliance_check(p_sop_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  current_upload uuid;
  guideline uuid;
  new_id uuid;
  stale public.compliance_checks;
begin
  -- Lock the SOP so two checks can't start at once.
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if not found then
    raise exception 'This SOP doesn''t exist' using errcode = 'no_data_found';
  end if;
  select v.uploaded_by into current_upload
  from public.sop_versions v where v.sop_id = p_sop_id and v.version = sop.current_version;
  if not public.is_active_user()
     or not (sop.author_id = actor or (current_upload = actor and public.is_co_author(p_sop_id, actor))) then
    raise exception 'Only the main author or the uploader of the current version can run a check' using errcode = 'insufficient_privilege';
  end if;
  if sop.status not in ('draft', 'returned', 'in-review')
     or (sop.status = 'in-review' and exists (
       select 1 from public.review_rounds r where r.sop_id = p_sop_id and r.version = sop.current_version
     )) then
    raise exception 'A compliance check can''t be run while the SOP is %', sop.status using errcode = 'check_violation';
  end if;
  if not public.sop_requires_check(sop) then
    raise exception 'Compliance checks are only for SOPs of departments the GVP guideline applies to' using errcode = 'check_violation';
  end if;

  -- A check left behind is marked failed: a sample check after 5 minutes (its tab was closed),
  -- a check of the compliance service after 30 minutes (the service stopped).
  for stale in
    update public.compliance_checks c
    set status = 'failed', completed_at = now(),
        error_message = case when c.engine = 'sample' then 'The check stopped without a result'
                             else 'The compliance service did not finish the check' end
    where c.sop_id = p_sop_id and c.status = 'running'
      and ((c.engine = 'sample' and c.started_at < now() - interval '5 minutes')
        or (c.engine <> 'sample' and c.started_at < now() - interval '30 minutes'))
    returning *
  loop
    insert into public.timeline_events (sop_id, type, actor_id, version)
    values (p_sop_id, 'compliance-check-failed', stale.triggered_by, stale.sop_version);
  end loop;

  if exists (select 1 from public.compliance_checks c where c.sop_id = p_sop_id and c.status = 'running') then
    raise exception 'A compliance check is already running' using errcode = 'check_violation';
  end if;
  -- One completed check per version and guideline version (a failed one can be run again).
  -- While the compliance service is online, a version whose completed check is a SAMPLE result
  -- can be checked again, so that it gets a real result.
  if public.has_current_check(sop) and not (
    public.compliance_engine() <> 'sample' and (
      select c.engine = 'sample' from public.compliance_checks c
      where c.sop_id = p_sop_id and c.sop_version = sop.current_version
      order by c.started_at desc limit 1)
  ) then
    raise exception 'This version already has a completed compliance check against the current guideline; upload a new version to run another check'
      using errcode = 'check_violation', hint = 'check-already-completed';
  end if;
  guideline := public.current_guideline_version();
  if guideline is null then
    raise exception 'No guideline is available to check against' using errcode = 'no_data_found';
  end if;

  insert into public.compliance_checks (sop_id, sop_version, guideline_version_id, status, engine, triggered_by)
  values (p_sop_id, sop.current_version, guideline, 'running', public.compliance_engine(), actor)
  returning id into new_id;
  return new_id;
end;
$$;

-- ---------- Functions for the compliance service only ----------

-- The service is online (called every 30 seconds).
create function public.service_heartbeat(p_engine text, p_engine_version text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.compliance_service_status (id, engine, engine_version, last_seen)
  values (true, btrim(p_engine), p_engine_version, now())
  on conflict (id) do update
  set engine = excluded.engine, engine_version = excluded.engine_version, last_seen = excluded.last_seen;
$$;

-- Takes the oldest running check of the engine that nobody has taken yet, with what is needed
-- to run it. Returns no row when there is none.
create function public.claim_compliance_check(p_engine text)
returns table (check_id uuid, sop_id uuid, sop_version integer, storage_path text, file_name text,
               guideline_name text, guideline_version text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  chk public.compliance_checks;
begin
  select * into chk
  from public.compliance_checks c
  where c.status = 'running' and c.engine = p_engine and not (c.metadata ? 'claimed_at')
  order by c.started_at
  limit 1
  for update skip locked;
  if not found then
    return;
  end if;
  update public.compliance_checks
  set metadata = metadata || jsonb_build_object('claimed_at', now())
  where id = chk.id;

  return query
  select chk.id, chk.sop_id, chk.sop_version, v.storage_path, v.file_name, g.name, g.version
  from public.sop_versions v
  join public.guideline_versions g on g.id = chk.guideline_version_id
  where v.sop_id = chk.sop_id and v.version = chk.sop_version;
end;
$$;

-- Completes a running check of the service with its findings, in report order. Each element of
-- p_findings: requirement_code, module, section, section_title, short_title, page,
-- requirement_text, result, justification, sop_reference, recommended_action, evidence.
create function public.complete_compliance_check(p_check_id uuid, p_findings jsonb, p_engine_version text, p_metadata jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  chk public.compliance_checks;
  item jsonb;
  pos bigint;
  req_id uuid;
  res public.compliance_result;
begin
  select * into chk from public.compliance_checks c where c.id = p_check_id for update;
  if not found then
    raise exception 'This check doesn''t exist' using errcode = 'no_data_found';
  end if;
  if chk.engine = 'sample' then
    raise exception 'Sample checks are finished by finish_sample_check' using errcode = 'check_violation';
  end if;
  if chk.status <> 'running' then
    -- It was marked failed meanwhile (e.g. after 30 minutes): keep that outcome.
    return;
  end if;
  if p_findings is null or jsonb_typeof(p_findings) <> 'array' or jsonb_array_length(p_findings) = 0 then
    raise exception 'A completed check needs at least one finding' using errcode = 'check_violation';
  end if;

  for item, pos in select e.value, e.ordinality from jsonb_array_elements(p_findings) with ordinality as e loop
    res := (item->>'result')::public.compliance_result;
    insert into public.guideline_requirements
      (guideline_version_id, code, module, section, section_title, short_title, page, summary)
    values (chk.guideline_version_id, item->>'requirement_code', item->>'module', item->>'section',
            item->>'section_title', item->>'short_title', greatest(1, (item->>'page')::integer), item->>'requirement_text')
    on conflict (guideline_version_id, code) do update
    set module = excluded.module, section = excluded.section, section_title = excluded.section_title,
        short_title = excluded.short_title, page = excluded.page, summary = excluded.summary
    returning id into req_id;

    insert into public.compliance_findings
      (check_id, requirement_id, result, justification, sop_reference, recommended_action, evidence, position)
    values (chk.id, req_id, res, item->>'justification', nullif(btrim(item->>'sop_reference'), ''),
            case when res = 'compliant' then null else nullif(btrim(item->>'recommended_action'), '') end,
            item->'evidence', pos);
  end loop;

  update public.compliance_checks
  set status = 'completed', completed_at = now(), engine_version = p_engine_version,
      metadata = metadata || coalesce(p_metadata, '{}'::jsonb)
  where id = chk.id;
  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (chk.sop_id, 'compliance-check-completed', chk.triggered_by, chk.sop_version);
end;
$$;

-- Marks a running check of the service failed, with the reason.
create function public.fail_compliance_check(p_check_id uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  chk public.compliance_checks;
begin
  select * into chk from public.compliance_checks c where c.id = p_check_id for update;
  if not found or chk.engine = 'sample' or chk.status <> 'running' then
    return;
  end if;
  update public.compliance_checks
  set status = 'failed', completed_at = now(),
      error_message = left(coalesce(nullif(btrim(p_message), ''), 'The compliance service could not finish the check'), 1000)
  where id = chk.id;
  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (chk.sop_id, 'compliance-check-failed', chk.triggered_by, chk.sop_version);
end;
$$;

-- ---------- Who can run the functions ----------

revoke execute on function public.compliance_engine() from public, anon, authenticated;
revoke execute on function public.service_heartbeat(text, text) from public, anon, authenticated;
revoke execute on function public.claim_compliance_check(text) from public, anon, authenticated;
revoke execute on function public.complete_compliance_check(uuid, jsonb, text, jsonb) from public, anon, authenticated;
revoke execute on function public.fail_compliance_check(uuid, text) from public, anon, authenticated;
grant execute on function public.service_heartbeat(text, text) to service_role;
grant execute on function public.claim_compliance_check(text) to service_role;
grant execute on function public.complete_compliance_check(uuid, jsonb, text, jsonb) to service_role;
grant execute on function public.fail_compliance_check(uuid, text) to service_role;
