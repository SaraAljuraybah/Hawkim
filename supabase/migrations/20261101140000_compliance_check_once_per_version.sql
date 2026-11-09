-- One completed compliance check per SOP version and GVP version, enforced in the database as well
-- as in the browser (frontend/src/pages/SopWorkflowPage.tsx).
--
-- start_compliance_check now refuses when has_current_check says so: the newest check of the
-- current version is completed, against the current guideline. It doesn't need to have passed.
-- A new check can still run after a failed check, against a newer guideline version, or on a new
-- SOP version. The refusal comes after the 5-minute clean-up of abandoned checks and the "already
-- running" rule, so those work as before. The hint is what the app recognises, so keep it stable.
--
-- Only this one function changes, with the same signature and privileges; no row changes.
-- supabase/scripts/rollback_compliance_check_once_per_version.sql undoes it.

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

  -- A sample check still running after 5 minutes was left behind (its tab was closed): it failed.
  for stale in
    update public.compliance_checks c
    set status = 'failed', completed_at = now(), error_message = 'The check stopped without a result'
    where c.sop_id = p_sop_id and c.status = 'running' and c.engine = 'sample' and c.started_at < now() - interval '5 minutes'
    returning *
  loop
    insert into public.timeline_events (sop_id, type, actor_id, version)
    values (p_sop_id, 'compliance-check-failed', stale.triggered_by, stale.sop_version);
  end loop;

  if exists (select 1 from public.compliance_checks c where c.sop_id = p_sop_id and c.status = 'running') then
    raise exception 'A compliance check is already running' using errcode = 'check_violation';
  end if;
  -- One completed check per version and guideline version (a failed one can be run again).
  if public.has_current_check(sop) then
    raise exception 'This version already has a completed compliance check against the current guideline; upload a new version to run another check'
      using errcode = 'check_violation', hint = 'check-already-completed';
  end if;
  guideline := public.current_guideline_version();
  if guideline is null then
    raise exception 'No guideline is available to check against' using errcode = 'no_data_found';
  end if;

  insert into public.compliance_checks (sop_id, sop_version, guideline_version_id, status, engine, triggered_by)
  values (p_sop_id, sop.current_version, guideline, 'running', 'sample', actor)
  returning id into new_id;
  return new_id;
end;
$$;
