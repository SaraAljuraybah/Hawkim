-- Phase 7: compliance checks of SOP versions against the GVP guideline.
--
-- The real compliance service (BGE-M3 + Llama 3.1 8B) isn't connected yet. Until then every
-- check uses the SAMPLE engine: start_compliance_check creates a running check, and the browser
-- finishes it a few seconds later with finish_sample_check, which copies the sample findings.
--
-- Later, without changing these tables: start_compliance_check sets another `engine`, and the
-- service (a server function with the secret key, never the browser) writes the findings,
-- `evidence`, `engine_version`, `metadata` and the final status of those checks itself.
-- finish_sample_check never applies to them.
--
-- Rules enforced here (never only in the browser):
-- - Only the main author, or a co-author who uploaded the current version, runs a check
--   (Draft, Returned or In Review), and only one check runs at a time per SOP.
-- - A check always uses the current guideline version (the one added last).
-- - A sample check still running after 5 minutes (its tab was closed) is marked failed
--   when the next check starts.
--
-- Still checked only in the browser until review requests are in the database: In Review,
-- only a version that hasn't been sent to reviewers yet can be checked.

-- ---------- Types ----------

create type public.check_status as enum ('running', 'completed', 'failed');

create type public.compliance_result as enum ('compliant', 'partial', 'conflict', 'not-addressed');

-- ---------- Guideline ----------

create table public.guideline_versions (
  id uuid primary key default gen_random_uuid(),
  -- e.g. 'SFDA Guideline on Good Pharmacovigilance Practices (GVP)'
  name text not null check (length(btrim(name)) between 1 and 200),
  -- e.g. '4.0'
  version text not null check (length(btrim(version)) between 1 and 20),
  issued_date date,
  effective_date date not null,
  -- The guideline document, e.g. 'Drug-GVP4_0.pdf'.
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  -- What changed from the previous version.
  summary text not null default '' check (length(summary) <= 500),
  -- Who added it; unknown for the first version.
  added_by uuid references public.profiles (id),
  added_at timestamptz not null default now(),
  unique (name, version)
);

-- The requirements SOPs are checked against, per guideline version.
create table public.guideline_requirements (
  id uuid primary key default gen_random_uuid(),
  guideline_version_id uuid not null references public.guideline_versions (id),
  -- e.g. 'R1'
  code text not null check (length(btrim(code)) between 1 and 20),
  module text not null,
  section text not null,
  section_title text not null,
  short_title text not null,
  page integer not null check (page >= 1),
  -- Paraphrased summary of the requirement.
  summary text not null,
  unique (guideline_version_id, code)
);

-- ---------- Checks and their findings ----------

create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops (id),
  -- The SOP version that was checked.
  sop_version integer not null,
  guideline_version_id uuid not null references public.guideline_versions (id),
  status public.check_status not null default 'running',
  -- What produced the result: 'sample' for now; the real service sets its own name and version.
  engine text not null default 'sample' check (length(btrim(engine)) between 1 and 100),
  engine_version text,
  -- Who ran the check (its timeline event is theirs).
  triggered_by uuid not null references public.profiles (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  -- Why a check failed, when known.
  error_message text check (error_message is null or length(error_message) <= 1000),
  -- Anything else the service wants to keep (e.g. timings, model settings).
  metadata jsonb not null default '{}',
  foreign key (sop_id, sop_version) references public.sop_versions (sop_id, version),
  check ((status = 'running') = (completed_at is null))
);

-- Only one check runs at a time for an SOP.
create unique index compliance_checks_one_running on public.compliance_checks (sop_id) where status = 'running';
create index compliance_checks_sop on public.compliance_checks (sop_id, started_at);

create table public.compliance_findings (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.compliance_checks (id),
  requirement_id uuid not null references public.guideline_requirements (id),
  result public.compliance_result not null,
  justification text not null,
  -- Where the SOP addresses it, e.g. 'Section 4.2' (none when it isn't addressed).
  sop_reference text,
  -- What to change; only for results that aren't compliant.
  recommended_action text,
  -- What the result is based on: quotes from the guideline and the SOP, scores (the service's format).
  evidence jsonb,
  -- The order the findings are shown in.
  position integer not null check (position >= 1),
  unique (check_id, position)
);

-- The results every sample check gets, per guideline version. Never read by the browser.
create table public.sample_findings (
  id uuid primary key default gen_random_uuid(),
  guideline_version_id uuid not null references public.guideline_versions (id),
  requirement_id uuid not null references public.guideline_requirements (id),
  position integer not null check (position >= 1),
  result public.compliance_result not null,
  justification text not null,
  sop_reference text,
  recommended_action text,
  unique (guideline_version_id, position)
);

-- ---------- Helpers ----------

-- The current guideline version: the one added last.
create function public.current_guideline_version() returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select g.id from public.guideline_versions g order by g.added_at desc, g.id desc limit 1;
$$;

-- ---------- Actions ----------

-- Starts a check of the SOP's current version against the current guideline; returns its id.
create function public.start_compliance_check(p_sop_id uuid)
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
  if sop.status not in ('draft', 'returned', 'in-review') then
    raise exception 'A compliance check can''t be run while the SOP is %', sop.status using errcode = 'check_violation';
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

-- SAMPLE ENGINE ONLY: the person who ran a sample check finishes it, as completed (with the
-- sample findings) or failed (the development-only "next check fails" control). A check that
-- already finished is left as it is.
create function public.finish_sample_check(p_check_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  chk public.compliance_checks;
begin
  select * into chk from public.compliance_checks c where c.id = p_check_id for update;
  if not found or chk.triggered_by <> actor or not public.is_active_user() then
    raise exception 'Only the person who ran this check can finish it' using errcode = 'insufficient_privilege';
  end if;
  if chk.engine <> 'sample' then
    raise exception 'Only sample checks can be finished this way' using errcode = 'check_violation';
  end if;
  if p_outcome is null or p_outcome not in ('completed', 'failed') then
    raise exception 'The outcome must be completed or failed' using errcode = 'check_violation';
  end if;
  if chk.status <> 'running' then
    return;
  end if;

  if p_outcome = 'completed' then
    insert into public.compliance_findings (check_id, requirement_id, result, justification, sop_reference, recommended_action, position)
    select chk.id, f.requirement_id, f.result, f.justification, f.sop_reference, f.recommended_action, f.position
    from public.sample_findings f
    where f.guideline_version_id = chk.guideline_version_id;

    update public.compliance_checks set status = 'completed', completed_at = now() where id = chk.id;
    insert into public.timeline_events (sop_id, type, actor_id, version)
    values (chk.sop_id, 'compliance-check-completed', actor, chk.sop_version);
  else
    update public.compliance_checks
    set status = 'failed', completed_at = now(), error_message = 'The sample check was set to fail'
    where id = chk.id;
    insert into public.timeline_events (sop_id, type, actor_id, version)
    values (chk.sop_id, 'compliance-check-failed', actor, chk.sop_version);
  end if;
end;
$$;

-- ---------- Who can run the functions ----------

revoke execute on function public.current_guideline_version() from public, anon, authenticated;
revoke execute on function public.start_compliance_check(uuid) from public, anon;
revoke execute on function public.finish_sample_check(uuid, text) from public, anon;
grant execute on function public.start_compliance_check(uuid) to authenticated;
grant execute on function public.finish_sample_check(uuid, text) to authenticated;

-- ---------- Row level security ----------

alter table public.guideline_versions enable row level security;
alter table public.guideline_requirements enable row level security;
alter table public.compliance_checks enable row level security;
alter table public.compliance_findings enable row level security;
alter table public.sample_findings enable row level security;

create policy "Active users can read the guideline versions"
on public.guideline_versions for select to authenticated
using ((select public.is_active_user()));

create policy "Active users can read the guideline requirements"
on public.guideline_requirements for select to authenticated
using ((select public.is_active_user()));

create policy "People can read the checks of the versions they may see"
on public.compliance_checks for select to authenticated
using (public.can_view_version(sop_id, sop_version));

create policy "People can read the findings of the checks they may see"
on public.compliance_findings for select to authenticated
using (exists (
  select 1 from public.compliance_checks c
  where c.id = check_id and public.can_view_version(c.sop_id, c.sop_version)
));

-- No insert, update or delete policies, and read-only grants: changes only through the functions.
-- sample_findings has no policy at all, so the browser can't read it.
revoke all on public.guideline_versions, public.guideline_requirements, public.compliance_checks,
  public.compliance_findings, public.sample_findings from anon, authenticated;
grant select on public.guideline_versions, public.guideline_requirements, public.compliance_checks,
  public.compliance_findings to authenticated;
