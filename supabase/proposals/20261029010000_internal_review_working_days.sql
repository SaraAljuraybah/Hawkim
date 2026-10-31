-- Extend the existing internal-review RPCs; do not replace the application schema.
-- Existing requests keep their original calendar-day allocation and saved deadlines.
-- Only requests sent after this migration use the Riyadh working-day policy.

alter table public.review_requests
  add column deadline_policy text not null default 'calendar-v1'
    check (deadline_policy in ('calendar-v1', 'riyadh-working-days-v1'));
alter table public.review_requests
  alter column deadline_policy set default 'riyadh-working-days-v1';
alter table public.review_requests
  add column response_counts_from timestamptz;

comment on column public.review_requests.deadline_policy is
  'Allocation policy fixed when sent. calendar-v1 preserves existing records; riyadh-working-days-v1 excludes Friday/Saturday and the origin date.';

-- Keep the existing reviewer and separation-of-duties validation. A caller's date
-- is a preview to validate, never authority to shorten/extend the response window.
-- NULL remains accepted for older clients, but the server always assigns a date.
create or replace function public.check_review_options(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  person uuid;
  expected_date date := public.hawkim_riyadh_date(public.hawkim_review_response_due_at(now()));
begin
  if coalesce(cardinality(p_reviewer_ids), 0) = 0
     or cardinality(p_reviewer_ids) <> (select count(distinct u) from unnest(p_reviewer_ids) as u) then
    raise exception 'Select one or more different eligible internal reviewers' using errcode = 'check_violation';
  end if;
  foreach person in array p_reviewer_ids loop
    if not public.is_eligible_reviewer(p_sop_id, person) then
      raise exception 'Select eligible reviewers from the SOP home department; Authors and co-authors cannot review' using errcode = 'check_violation';
    end if;
  end loop;
  perform public.hawkim_validate_review_note(p_note);
  if p_response_due_date is not null and p_response_due_date is distinct from expected_date then
    raise exception 'The response deadline is fixed at two working days from the request date in Riyadh; refresh the request preview'
      using errcode = 'check_violation';
  end if;
  if p_review_duration_days is not null and p_review_duration_days not between 1 and 30 then
    raise exception 'Choose an optional review duration of 1 to 30 whole working days' using errcode = 'check_violation';
  end if;
end;
$$;

-- submit_for_review and add_reviewers still perform their existing main-Author,
-- current-version, compliance, duplicate-request, and round-state checks. Their
-- shared sender fixes one precise server timestamp and deadline for the batch.
create or replace function public.send_review_requests(p_sop public.sops, p_round_id uuid, p_type public.timeline_event_type, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent_at timestamptz := now();
  response_at timestamptz := public.hawkim_review_response_due_at(sent_at);
  round_version integer;
begin
  select r.version into round_version from public.review_rounds r where r.id = p_round_id;
  insert into public.review_requests (round_id, sop_id, reviewer_id, assigned_at, response_due_date, response_due_at, review_duration_days, deadline_policy, response_counts_from)
  select p_round_id, p_sop.id, person, sent_at, public.hawkim_riyadh_date(response_at),
         response_at, p_review_duration_days, 'riyadh-working-days-v1', public.hawkim_review_response_counts_from(sent_at)
  from unnest(p_reviewer_ids) with ordinality as list (person, n)
  order by list.n;
  insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, note, review_round_id, created_at)
  values (p_sop.id, p_type, (select auth.uid()), round_version, p_reviewer_ids,
          public.hawkim_validate_review_note(p_note), p_round_id, sent_at);
end;
$$;

-- open_request retains the existing authenticated, eligible assigned-reviewer,
-- withdrawal, current-version, latest-request, cancellation, and locking checks.
-- Acceptance fixes the review allocation separately from the response deadline.
create or replace function public.accept_review(p_request_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.review_requests;
  accepted timestamptz := now();
  due_at timestamptz;
  round_version integer;
begin
  request := public.open_request(p_request_id);
  if request.status <> 'pending' then
    raise exception 'This review has already been accepted' using errcode = 'check_violation';
  end if;
  if request.review_duration_days is not null then
    if request.deadline_policy = 'riyadh-working-days-v1' then
      due_at := public.hawkim_review_due_at(accepted, request.review_duration_days);
    else
      due_at := public.riyadh_end_of_day(public.hawkim_riyadh_date(accepted) + request.review_duration_days);
    end if;
  end if;
  update public.review_requests
  set status = 'accepted', accepted_at = accepted,
      review_due_date = case when due_at is null then null else public.hawkim_riyadh_date(due_at) end,
      review_due_at = due_at
  where id = p_request_id;
  select r.version into round_version from public.review_rounds r where r.id = request.round_id;
  insert into public.timeline_events (sop_id, type, actor_id, version, review_round_id, review_request_id, created_at)
  values (request.sop_id, 'review-accepted', request.reviewer_id, round_version, request.round_id, p_request_id, accepted);
end;
$$;

-- Apply the title rule to real creation and any privileged future title update.
-- Do not truncate existing titles or block unrelated updates to older long titles.
create function public.check_sop_title_limit() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.title := public.hawkim_validate_sop_title(new.title);
  return new;
end;
$$;

create trigger sops_title_limit
before insert or update of title on public.sops
for each row execute function public.check_sop_title_limit();

create or replace function public.create_sop(p_title text, p_description text, p_department_id text, p_storage_path text, p_file_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  upload record;
  new_id uuid;
  validated_title text;
begin
  if not public.has_role('author') then
    raise exception 'An active Author account is required to create an SOP' using errcode = 'insufficient_privilege';
  end if;
  if p_department_id is distinct from (select p.department_id from public.profiles p where p.id = actor) then
    raise exception 'SOPs can only be created in your home department' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.removed_at is null) then
    raise exception 'The home department is unavailable' using errcode = 'check_violation';
  end if;
  validated_title := public.hawkim_validate_sop_title(p_title);
  if length(btrim(coalesce(p_description, ''))) > 1000 then
    raise exception 'The description must be at most 1000 characters' using errcode = 'check_violation';
  end if;

  select * into upload from public.check_sop_file(p_storage_path, p_file_name);
  insert into public.sops (title, description, department_id, author_id, current_version)
  values (validated_title, btrim(coalesce(p_description, '')), p_department_id, actor, 1)
  returning id into new_id;
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (new_id, 1, btrim(p_file_name), upload.file_type, p_storage_path, upload.file_size, actor);
  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (new_id, 'version-uploaded', actor, 1);
  return new_id;
end;
$$;

-- CREATE OR REPLACE retains existing RPC ACLs. Explicitly keep the replaced
-- helpers and the new trigger unavailable as browser-callable mutation shortcuts.
revoke execute on function public.check_review_options(uuid, uuid[], date, integer, text) from public, anon, authenticated;
revoke execute on function public.send_review_requests(public.sops, uuid, public.timeline_event_type, uuid[], date, integer, text) from public, anon, authenticated;
revoke execute on function public.check_sop_title_limit() from public, anon, authenticated;
