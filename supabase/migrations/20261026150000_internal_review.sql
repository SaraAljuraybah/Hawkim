-- Phase 8: the internal review of SOP versions (the same rules as frontend/src/lib/internalReview.ts).
--
-- How it works:
-- - The main author sends the current version to one or more reviewers of the SOP's department
--   (a round). Each reviewer gets a request: pending until they accept or decline; an accepted
--   request is completed or returned with comments. The author can add or remove reviewers,
--   and send a new version (a new round) once everyone taking part has finished.
-- - Optional deadlines per request: a response due date (to accept or decline), and a review
--   duration in days counted from acceptance. A request still pending at the end of its response
--   due date is withdrawn automatically, by System.
-- - All dates and times follow Saudi time (Asia/Riyadh): a day ends at 23:59:59.999 there, and a
--   request sent at or after 16:00 counts from the next day, so its response date must be tomorrow
--   or later.
-- - The round is open while anyone taking part hasn't finished (or nobody is taking part); then
--   completed, or changes-requested if anyone returned it. The SOP stays In Review.
--
-- The automatic withdrawal runs at the start of every review action and when the browser asks
-- (withdraw_due_requests). TODO: Run it from a scheduled job (pg_cron) instead.
--
-- Compliance checks apply only where the GVP guideline does (Pharmacovigilance): only SOPs of a
-- department flagged requires_compliance_check can be checked, and only they need a completed
-- check of the current version before review. Every other SOP is submitted without a check.
--
-- This migration also closes what earlier phases left to the browser: a version sent for review
-- can't be deleted, during review a new version waits for every reviewer, only an unsent version
-- can be checked during review, and a co-author can't be a reviewer on the SOP. Reviewers can
-- now see the SOP, but only the versions sent to them (and their files).

-- ---------- Types ----------

create type public.review_round_status as enum ('open', 'completed', 'changes-requested');

create type public.review_request_status as enum ('pending', 'accepted', 'declined', 'withdrawn', 'removed', 'completed', 'returned');

create type public.comment_role as enum ('reviewer', 'approver');

-- ---------- Which departments need a compliance check ----------

-- The GVP guideline applies to pharmacovigilance only. The seed sets the flag (no department id
-- is written into the rules); more than one department may have it.
alter table public.departments add column requires_compliance_check boolean not null default false;

-- ---------- Tables ----------

create table public.review_rounds (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops (id),
  -- The SOP version sent for review.
  version integer not null,
  status public.review_round_status not null default 'open',
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  closed_at timestamptz,
  foreign key (sop_id, version) references public.sop_versions (sop_id, version),
  -- One round per version.
  unique (sop_id, version)
);

create table public.review_requests (
  id uuid primary key default gen_random_uuid(),
  -- The order requests were sent in (a reviewer's latest request is the one that counts).
  seq bigint generated always as identity,
  round_id uuid not null references public.review_rounds (id),
  sop_id uuid not null references public.sops (id),
  reviewer_id uuid not null references public.profiles (id),
  status public.review_request_status not null default 'pending',
  assigned_at timestamptz not null default now(),
  -- Optional deadline to accept or decline: the date, and the end of that day in Riyadh.
  response_due_date date,
  response_due_at timestamptz,
  -- Optional review duration in whole days, counted from acceptance.
  review_duration_days integer check (review_duration_days between 1 and 30),
  accepted_at timestamptz,
  -- The review's last day, fixed on acceptance when a duration was set, and the end of it in Riyadh.
  review_due_date date,
  review_due_at timestamptz,
  decided_at timestamptz,
  decline_reason text check (decline_reason is null or length(decline_reason) between 1 and 1000),
  -- The comments of a return (required) or a completed review (optional); see sop_comments.
  comment_id uuid,
  withdrawn_at timestamptz,
  removed_at timestamptz,
  removed_by uuid references public.profiles (id),
  removal_reason text check (removal_reason is null or length(removal_reason) between 1 and 1000),
  -- The status the request had when its reviewer was removed (their decision stays in the history).
  status_before_removal public.review_request_status,
  check ((response_due_date is null) = (response_due_at is null)),
  check ((review_due_date is null) = (review_due_at is null))
);

create index review_requests_round on public.review_requests (round_id, seq);
create index review_requests_sop_reviewer on public.review_requests (sop_id, reviewer_id);

create table public.sop_comments (
  id uuid primary key default gen_random_uuid(),
  sop_id uuid not null references public.sops (id),
  -- The version the comment is about.
  version integer not null,
  author_id uuid not null references public.profiles (id),
  role public.comment_role not null,
  text text not null check (length(btrim(text)) between 1 and 1000),
  review_round_id uuid references public.review_rounds (id),
  review_request_id uuid references public.review_requests (id),
  created_at timestamptz not null default now()
);

create index sop_comments_sop on public.sop_comments (sop_id, created_at);

alter table public.review_requests
  add constraint review_requests_comment_id_fkey foreign key (comment_id) references public.sop_comments (id);

alter table public.timeline_events
  add column review_round_id uuid references public.review_rounds (id),
  add column review_request_id uuid references public.review_requests (id),
  add column comment_id uuid references public.sop_comments (id);

-- ---------- Saudi time ----------

-- Today's date in Riyadh.
create function public.riyadh_today() returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;

-- The end of a day in Riyadh (23:59:59.999), as a moment in time.
create function public.riyadh_end_of_day(p_date date) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select ((p_date + 1)::timestamp at time zone 'Asia/Riyadh') - interval '1 millisecond';
$$;

-- The earliest response due date for a request sent now: today, or tomorrow from 16:00 Riyadh time.
create function public.earliest_response_date() returns date
language sql
stable
set search_path = ''
as $$
  select public.riyadh_today() + (extract(hour from now() at time zone 'Asia/Riyadh') >= 16)::integer;
$$;

-- ---------- Helpers ----------

-- The SOP's latest review round, if any.
create function public.latest_round(p_sop_id uuid) returns public.review_rounds
language sql
stable
security definer
set search_path = ''
as $$
  select r.* from public.review_rounds r where r.sop_id = p_sop_id order by r.requested_at desc, r.id desc limit 1;
$$;

-- Each reviewer's latest request in a round (a later request replaces an earlier one).
create function public.latest_requests(p_round_id uuid) returns setof public.review_requests
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (q.reviewer_id) q.*
  from public.review_requests q
  where q.round_id = p_round_id
  order by q.reviewer_id, q.seq desc;
$$;

-- The person can review this SOP: an active Reviewer of its department who isn't its author or a co-author.
create function public.is_eligible_reviewer(p_sop_id uuid, p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = p_user_id and p.deleted_at is null and p.department_id = s.department_id
    where s.id = p_sop_id
      and s.author_id <> p_user_id
      and not public.is_co_author(s.id, p_user_id)
      and exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'reviewer')
      and not exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'admin')
  );
$$;

-- Refuses anyone but the active main Author, and an SOP whose department was removed.
create function public.assert_main_author(p_sop public.sops) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_sop.id is null or p_sop.author_id <> (select auth.uid()) or not public.has_role('author') then
    raise exception 'Only the active main Author can manage internal review requests' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.departments d where d.id = p_sop.department_id and d.removed_at is null) then
    raise exception 'The SOP department is unavailable' using errcode = 'check_violation';
  end if;
end;
$$;

-- Checks what the author chose for new requests (the same for each request sent).
create function public.check_review_options(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  person uuid;
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
  if p_note is not null and length(btrim(p_note)) > 500 then
    raise exception 'Submission notes must be at most 500 characters' using errcode = 'check_violation';
  end if;
  if p_response_due_date is not null and p_response_due_date < public.earliest_response_date() then
    raise exception 'Choose an optional response due date today or later (tomorrow or later from 4:00 PM)' using errcode = 'check_violation';
  end if;
  if p_review_duration_days is not null and p_review_duration_days not between 1 and 30 then
    raise exception 'Choose an optional review duration of 1 to 30 whole days' using errcode = 'check_violation';
  end if;
end;
$$;

-- Sends a request to each reviewer in the round, with the same deadlines, and records it.
create function public.send_review_requests(p_sop public.sops, p_round_id uuid, p_type public.timeline_event_type, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent_at timestamptz := now();
  round_version integer;
begin
  select r.version into round_version from public.review_rounds r where r.id = p_round_id;
  insert into public.review_requests (round_id, sop_id, reviewer_id, assigned_at, response_due_date, response_due_at, review_duration_days)
  select p_round_id, p_sop.id, person, sent_at, p_response_due_date,
         public.riyadh_end_of_day(p_response_due_date), p_review_duration_days
  from unnest(p_reviewer_ids) with ordinality as list (person, n)
  order by list.n;
  insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, note, review_round_id, created_at)
  values (p_sop.id, p_type, (select auth.uid()), round_version, p_reviewer_ids, nullif(btrim(coalesce(p_note, '')), ''), p_round_id, sent_at);
end;
$$;

-- Recalculates the round after any change: open while someone taking part hasn't finished (or
-- nobody is taking part); once they all have, completed, or changes-requested if anyone returned it.
create function public.settle_review_round(p_round_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur_round public.review_rounds;
  author uuid;
  taking integer;
  unfinished integer;
  returned integer;
  next_status public.review_round_status;
begin
  select * into cur_round from public.review_rounds r where r.id = p_round_id;
  select s.author_id into author from public.sops s where s.id = cur_round.sop_id;
  select count(*),
         count(*) filter (where q.status in ('pending', 'accepted')),
         count(*) filter (where q.status = 'returned')
  into taking, unfinished, returned
  from public.latest_requests(p_round_id) q
  where q.status not in ('declined', 'withdrawn', 'removed');

  if taking = 0 or unfinished > 0 then
    update public.review_rounds set status = 'open', closed_at = null where id = p_round_id;
    return;
  end if;
  if returned > 0 then
    next_status := 'changes-requested';
  else
    next_status := 'completed';
  end if;
  if cur_round.status = next_status then
    return;
  end if;
  update public.review_rounds set status = next_status, closed_at = now() where id = p_round_id;
  if next_status = 'completed' then
    insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, review_round_id)
    values (cur_round.sop_id, 'internal-review-completed', null, cur_round.version, array[author], p_round_id);
  end if;
end;
$$;

-- THE ONLY AUTOMATIC STEP: in the SOP's open round, each latest request still pending at the end
-- of its response due date is withdrawn, dated at that deadline, by System. The author and the
-- reviewer are told. Does nothing when nothing is due.
create function public.withdraw_due(p_sop_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sop public.sops;
  cur_round public.review_rounds;
  due public.review_requests;
  changed boolean := false;
begin
  select * into sop from public.sops s where s.id = p_sop_id;
  cur_round := public.latest_round(p_sop_id);
  if sop.id is null or cur_round.id is null or cur_round.status <> 'open' or sop.status <> 'in-review' then
    return;
  end if;
  for due in
    select q.* from public.latest_requests(cur_round.id) q
    where q.status = 'pending' and q.response_due_at is not null and q.response_due_at <= now()
  loop
    update public.review_requests set status = 'withdrawn', withdrawn_at = due.response_due_at where id = due.id;
    insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, review_round_id, review_request_id, created_at)
    values (p_sop_id, 'review-withdrawn', null, cur_round.version, array[sop.author_id, due.reviewer_id], cur_round.id, due.id, due.response_due_at);
    changed := true;
  end loop;
  if changed then
    perform public.settle_review_round(cur_round.id);
  end if;
end;
$$;

-- The request with its round, if it is the reviewer's latest, still open request in the SOP's current round.
create function public.open_request(p_request_id uuid) returns public.review_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.review_requests;
  sop public.sops;
  cur_round public.review_rounds;
begin
  select * into request from public.review_requests q where q.id = p_request_id;
  if request.id is null then
    raise exception 'This review request doesn''t exist' using errcode = 'no_data_found';
  end if;
  -- Lock the SOP so actions on it happen one after the other.
  select * into sop from public.sops s where s.id = request.sop_id for update;
  perform public.withdraw_due(sop.id);
  select * into request from public.review_requests q where q.id = p_request_id;
  select * into cur_round from public.review_rounds r where r.id = request.round_id;
  if sop.status <> 'in-review' or cur_round.id <> (public.latest_round(sop.id)).id or cur_round.version <> sop.current_version or cur_round.status <> 'open' then
    raise exception 'This internal review round is no longer open' using errcode = 'check_violation';
  end if;
  if request.status = 'withdrawn' then
    raise exception 'This review request was withdrawn because it was not accepted or declined by its response due date' using errcode = 'check_violation';
  end if;
  if request.status not in ('pending', 'accepted')
     or request.id <> (select q.id from public.latest_requests(cur_round.id) q where q.reviewer_id = request.reviewer_id) then
    raise exception 'This assignment is cancelled, decided, or no longer open' using errcode = 'check_violation';
  end if;
  if request.reviewer_id <> (select auth.uid()) or not public.is_eligible_reviewer(sop.id, request.reviewer_id) then
    raise exception 'Only the active assigned internal Reviewer can decide' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.departments d where d.id = sop.department_id and d.removed_at is null) then
    raise exception 'The SOP department is unavailable' using errcode = 'check_violation';
  end if;
  return request;
end;
$$;

-- The newest check of the current version is completed, against the current guideline (it needn't pass).
create function public.has_current_check(p_sop public.sops) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select c.status = 'completed' and c.guideline_version_id = public.current_guideline_version()
    from public.compliance_checks c
    where c.sop_id = p_sop.id and c.sop_version = p_sop.current_version
    order by c.started_at desc
    limit 1
  ), false);
$$;

-- The SOP's department is one the GVP guideline applies to, so its SOPs are checked.
create function public.sop_requires_check(p_sop public.sops) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select d.requires_compliance_check from public.departments d where d.id = p_sop.department_id), false);
$$;

-- ---------- Who can see an SOP: now reviewers too ----------

create or replace function public.can_view_sop(p_sop_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
    where s.id = p_sop_id
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or exists (select 1 from public.review_requests q where q.sop_id = s.id and q.reviewer_id = p.id)
      )
  );
$$;

-- Authors, co-authors and directory readers see every version; a reviewer only the versions sent to them.
create or replace function public.can_view_version(p_sop_id uuid, p_version integer) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = (select auth.uid()) and p.deleted_at is null
    where s.id = p_sop_id
      and (
        s.author_id = p.id
        or public.is_co_author(s.id, p.id)
        or (s.status = 'published' and s.department_id = p.department_id)
        or exists (
          select 1 from public.review_requests q
          join public.review_rounds r on r.id = q.round_id
          where q.sop_id = s.id and q.reviewer_id = p.id and r.version = p_version
        )
      )
  );
$$;

-- ---------- Actions ----------

-- The main author sends the current version for review: the first time from Draft, or a new
-- version (uploaded during review, or after an approver returned the SOP) as a new round.
-- Returns the new round's id.
create function public.submit_for_review(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  sop public.sops;
  latest public.review_rounds;
  is_first boolean;
  new_round uuid;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  perform public.assert_main_author(sop);
  perform public.withdraw_due(p_sop_id);
  latest := public.latest_round(p_sop_id);
  is_first := sop.status = 'draft';
  if is_first and exists (select 1 from public.review_rounds r where r.sop_id = p_sop_id and r.status = 'open') then
    raise exception 'Only a Draft without an open request can be submitted' using errcode = 'check_violation';
  end if;
  if not is_first and not (sop.status in ('in-review', 'returned') and latest.id is not null and latest.version <> sop.current_version) then
    raise exception 'Upload a new version once every reviewer has finished before sending it for review' using errcode = 'check_violation';
  end if;
  -- Only where the guideline applies: a completed check of the current version is needed.
  if public.sop_requires_check(sop) and not public.has_current_check(sop) then
    raise exception 'Run a completed compliance check against the current guideline first' using errcode = 'check_violation';
  end if;
  perform public.check_review_options(p_sop_id, p_reviewer_ids, p_response_due_date, p_review_duration_days, p_note);

  insert into public.review_rounds (sop_id, version, requested_by) values (p_sop_id, sop.current_version, sop.author_id)
  returning id into new_round;
  if is_first then
    perform public.send_review_requests(sop, new_round, 'submitted', p_reviewer_ids, p_response_due_date, p_review_duration_days, p_note);
  else
    perform public.send_review_requests(sop, new_round, 'resubmitted', p_reviewer_ids, p_response_due_date, p_review_duration_days, p_note);
  end if;
  update public.sops set status = 'in-review', updated_at = now() where id = p_sop_id;
  return new_round;
end;
$$;

-- The main author sends the current version to more reviewers (e.g. to replace one who declined,
-- was withdrawn or was removed). It reopens a completed round; earlier requests stay in the history.
create function public.add_reviewers(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sop public.sops;
  cur_round public.review_rounds;
  person uuid;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  perform public.assert_main_author(sop);
  perform public.withdraw_due(p_sop_id);
  cur_round := public.latest_round(p_sop_id);
  if sop.status <> 'in-review' or cur_round.id is null or cur_round.version <> sop.current_version or cur_round.status not in ('open', 'completed') then
    raise exception 'Reviewers can only be added to the review of the current version' using errcode = 'check_violation';
  end if;
  perform public.check_review_options(p_sop_id, p_reviewer_ids, p_response_due_date, p_review_duration_days, p_note);
  foreach person in array p_reviewer_ids loop
    if exists (
      select 1 from public.latest_requests(cur_round.id) q
      where q.reviewer_id = person and q.status not in ('declined', 'withdrawn', 'removed')
    ) then
      raise exception 'These reviewers already have a request for this version' using errcode = 'check_violation';
    end if;
  end loop;

  perform public.send_review_requests(sop, cur_round.id, 'submitted', p_reviewer_ids, p_response_due_date, p_review_duration_days, p_note);
  update public.sops set updated_at = now() where id = p_sop_id;
  perform public.settle_review_round(cur_round.id);
end;
$$;

-- The reviewer takes the task; a decision is only possible after accepting. With a review duration,
-- the review's last day is fixed now: the Riyadh date of acceptance plus the duration.
create function public.accept_review(p_request_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.review_requests;
  due date;
  round_version integer;
begin
  request := public.open_request(p_request_id);
  if request.status <> 'pending' then
    raise exception 'This review has already been accepted' using errcode = 'check_violation';
  end if;
  if request.review_duration_days is not null then
    due := public.riyadh_today() + request.review_duration_days;
  end if;
  update public.review_requests
  set status = 'accepted', accepted_at = now(), review_due_date = due, review_due_at = public.riyadh_end_of_day(due)
  where id = p_request_id;
  select r.version into round_version from public.review_rounds r where r.id = request.round_id;
  insert into public.timeline_events (sop_id, type, actor_id, version, review_round_id, review_request_id)
  values (request.sop_id, 'review-accepted', request.reviewer_id, round_version, request.round_id, p_request_id);
end;
$$;

-- The reviewer turns the task down with a required reason; the author and co-authors are told.
create function public.decline_review(p_request_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.review_requests;
  sop public.sops;
  round_version integer;
begin
  request := public.open_request(p_request_id);
  if request.status <> 'pending' then
    raise exception 'Only a review that has not been accepted can be declined' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason of up to 1000 characters is required to decline' using errcode = 'check_violation';
  end if;
  select * into sop from public.sops s where s.id = request.sop_id;
  update public.review_requests set status = 'declined', decline_reason = btrim(p_reason), decided_at = now() where id = p_request_id;
  select r.version into round_version from public.review_rounds r where r.id = request.round_id;
  insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, note, review_round_id, review_request_id)
  values (sop.id, 'review-declined', request.reviewer_id, round_version,
          array[sop.author_id] || array(select c.user_id from public.sop_co_authors c where c.sop_id = sop.id order by c.added_at),
          btrim(p_reason), request.round_id, p_request_id);
  perform public.settle_review_round(request.round_id);
end;
$$;

-- An accepted reviewer completes the review (optional comments), or returns it to the author with
-- required comments. A return affects only this reviewer; the SOP stays In Review.
create function public.decide_review(p_request_id uuid, p_decision text, p_text text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.review_requests;
  sop public.sops;
  round_version integer;
  trimmed text := btrim(coalesce(p_text, ''));
  new_comment uuid;
  decided timestamptz := now();
begin
  request := public.open_request(p_request_id);
  if request.status <> 'accepted' then
    raise exception 'Accept the review before deciding' using errcode = 'check_violation';
  end if;
  if p_decision is null or p_decision not in ('completed', 'returned') then
    raise exception 'Choose a final review decision' using errcode = 'check_violation';
  end if;
  if length(trimmed) > 1000 or (p_decision = 'returned' and trimmed = '') then
    raise exception 'Returning to the author requires comments; comments must be at most 1000 characters' using errcode = 'check_violation';
  end if;
  select * into sop from public.sops s where s.id = request.sop_id;
  select r.version into round_version from public.review_rounds r where r.id = request.round_id;

  if trimmed <> '' then
    insert into public.sop_comments (sop_id, version, author_id, role, text, review_round_id, review_request_id, created_at)
    values (sop.id, round_version, request.reviewer_id, 'reviewer', trimmed, request.round_id, p_request_id, decided)
    returning id into new_comment;
  end if;

  if p_decision = 'returned' then
    update public.review_requests set status = 'returned', decided_at = decided, comment_id = new_comment where id = p_request_id;
    insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, comment_id, review_round_id, review_request_id, created_at)
    values (sop.id, 'review-changes-requested', request.reviewer_id, round_version,
            array[sop.author_id] || array(select c.user_id from public.sop_co_authors c where c.sop_id = sop.id order by c.added_at),
            new_comment, request.round_id, p_request_id, decided);
  else
    update public.review_requests set status = 'completed', decided_at = decided, comment_id = new_comment where id = p_request_id;
    insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, comment_id, review_round_id, review_request_id, created_at)
    values (sop.id, 'review-completed', request.reviewer_id, round_version, array[sop.author_id],
            new_comment, request.round_id, p_request_id, decided);
  end if;
  perform public.settle_review_round(request.round_id);
end;
$$;

-- The main author removes a reviewer from the current round at any time, whatever their status,
-- with a required reason. The reviewer is told; their decision (status_before_removal) and comments
-- stay in the history.
create function public.remove_reviewer(p_request_id uuid, p_reason text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.review_requests;
  sop public.sops;
  cur_round public.review_rounds;
begin
  select * into request from public.review_requests q where q.id = p_request_id;
  select * into sop from public.sops s where s.id = request.sop_id for update;
  perform public.assert_main_author(sop);
  perform public.withdraw_due(sop.id);
  select * into request from public.review_requests q where q.id = p_request_id;
  select * into cur_round from public.review_rounds r where r.id = request.round_id;
  if sop.status <> 'in-review' or cur_round.id <> (public.latest_round(sop.id)).id or cur_round.version <> sop.current_version then
    raise exception 'This review round is no longer current' using errcode = 'check_violation';
  end if;
  if request.status = 'removed'
     or request.id <> (select q.id from public.latest_requests(cur_round.id) q where q.reviewer_id = request.reviewer_id) then
    raise exception 'This reviewer is no longer part of the review' using errcode = 'check_violation';
  end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'A reason of up to 1000 characters is required to remove a reviewer' using errcode = 'check_violation';
  end if;

  update public.review_requests
  set status = 'removed', status_before_removal = request.status, removed_at = now(),
      removed_by = sop.author_id, removal_reason = btrim(p_reason)
  where id = p_request_id;
  insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, note, review_round_id, review_request_id)
  values (sop.id, 'reviewer-removed', sop.author_id, cur_round.version, array[request.reviewer_id], btrim(p_reason), cur_round.id, p_request_id);
  update public.sops set updated_at = now() where id = sop.id;
  perform public.settle_review_round(cur_round.id);
end;
$$;

-- The author or a co-author replies to the comments. Sent to everyone who commented since the
-- submission before the latest comment. Not once the SOP is published.
create function public.respond_to_comments(p_sop_id uuid, p_text text) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  latest_comment timestamptz;
  round_start timestamptz;
  recipients uuid[];
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if sop.id is null or not public.is_active_user() or not (sop.author_id = actor or public.is_co_author(p_sop_id, actor)) then
    raise exception 'Only the author or a co-author can respond' using errcode = 'insufficient_privilege';
  end if;
  if sop.status = 'published' then
    raise exception 'Can''t respond once the SOP is published' using errcode = 'check_violation';
  end if;
  if p_text is null or length(btrim(p_text)) not between 1 and 1000 then
    raise exception 'A response of up to 1000 characters is required' using errcode = 'check_violation';
  end if;
  select max(c.created_at) into latest_comment from public.sop_comments c where c.sop_id = p_sop_id;
  select max(e.created_at) into round_start
  from public.timeline_events e
  where e.sop_id = p_sop_id and e.type in ('submitted', 'resubmitted') and e.created_at <= latest_comment;
  recipients := array(
    select distinct c.author_id from public.sop_comments c
    where c.sop_id = p_sop_id and (round_start is null or c.created_at >= round_start)
  );
  if latest_comment is null or cardinality(recipients) = 0 then
    raise exception 'There are no comments to respond to' using errcode = 'check_violation';
  end if;
  insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, note)
  values (p_sop_id, 'response', actor, sop.current_version, recipients, btrim(p_text));
  update public.sops set updated_at = now() where id = p_sop_id;
end;
$$;

-- Applies the automatic withdrawal now, for anyone who may see the SOP (the browser calls it when
-- an SOP loads and when a response due date passes).
create function public.withdraw_due_requests(p_sop_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_view_sop(p_sop_id) then
    raise exception 'This SOP isn''t available' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.sops s where s.id = p_sop_id for update;
  perform public.withdraw_due(p_sop_id);
end;
$$;

-- ---------- Closing the earlier gaps ----------

-- A co-author can't be a reviewer on the SOP (the other rules are unchanged).
create or replace function public.check_co_author() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sop public.sops;
  person public.profiles;
begin
  select * into sop from public.sops s where s.id = new.sop_id;
  select * into person from public.profiles p where p.id = new.user_id;
  if person.id is null or person.deleted_at is not null
     or not exists (select 1 from public.user_roles r where r.user_id = new.user_id and r.role = 'author') then
    raise exception 'A co-author must be an active Author' using errcode = 'check_violation';
  end if;
  if person.department_id is distinct from sop.department_id then
    raise exception 'A co-author must be from the SOP''s department' using errcode = 'check_violation';
  end if;
  if new.user_id = sop.author_id then
    raise exception 'The main author can''t also be a co-author' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.review_requests q where q.sop_id = new.sop_id and q.reviewer_id = new.user_id) then
    raise exception 'Reviewers and approvers cannot be co-authors' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- During review, a new version only after everyone taking part finished the current one (or nobody is taking part).
create or replace function public.upload_sop_version(p_sop_id uuid, p_storage_path text, p_file_name text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  cur_round public.review_rounds;
  upload record;
  next_version integer;
begin
  -- Lock the SOP so two uploads at once can't get the same number.
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if not found or not public.has_role('author')
     or (sop.author_id <> actor and not public.is_co_author(p_sop_id, actor)) then
    raise exception 'Only the author or a co-author can upload a version' using errcode = 'insufficient_privilege';
  end if;
  if sop.status not in ('draft', 'returned', 'in-review') then
    raise exception 'A version can''t be uploaded while the SOP is %', sop.status using errcode = 'check_violation';
  end if;
  if sop.status = 'in-review' then
    perform public.withdraw_due(p_sop_id);
    cur_round := public.latest_round(p_sop_id);
    if cur_round.id is null or (cur_round.status = 'open' and exists (
      select 1 from public.latest_requests(cur_round.id) q where q.status not in ('declined', 'withdrawn', 'removed')
    )) then
      raise exception 'A new version can be uploaded once every reviewer has finished the current one' using errcode = 'check_violation';
    end if;
  end if;

  select * into upload from public.check_sop_file(p_storage_path, p_file_name);
  select max(v.version) + 1 into next_version from public.sop_versions v where v.sop_id = p_sop_id;

  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (p_sop_id, next_version, btrim(p_file_name), upload.file_type, p_storage_path, upload.file_size, actor);

  update public.sops set current_version = next_version, updated_at = now() where id = p_sop_id;

  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (p_sop_id, 'version-uploaded', actor, next_version);

  return next_version;
end;
$$;

-- A version sent for review can't be deleted (the other rules are unchanged).
create or replace function public.delete_sop_version(p_sop_id uuid, p_version integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  target public.sop_versions;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  select * into target from public.sop_versions v where v.sop_id = p_sop_id and v.version = p_version and v.deleted_at is null;
  if sop.id is null or target.id is null then
    raise exception 'This version doesn''t exist' using errcode = 'no_data_found';
  end if;
  if not public.is_active_user()
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
end;
$$;

-- Only SOPs of a department the guideline applies to can be checked, and during review only a
-- version that hasn't been sent to reviewers yet (the other rules are unchanged).
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

-- ---------- Who can run the functions ----------

-- Internal helpers: never called from the browser.
revoke execute on function public.latest_round(uuid) from public, anon, authenticated;
revoke execute on function public.latest_requests(uuid) from public, anon, authenticated;
revoke execute on function public.is_eligible_reviewer(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.assert_main_author(public.sops) from public, anon, authenticated;
revoke execute on function public.check_review_options(uuid, uuid[], date, integer, text) from public, anon, authenticated;
revoke execute on function public.send_review_requests(public.sops, uuid, public.timeline_event_type, uuid[], date, integer, text) from public, anon, authenticated;
revoke execute on function public.settle_review_round(uuid) from public, anon, authenticated;
revoke execute on function public.withdraw_due(uuid) from public, anon, authenticated;
revoke execute on function public.open_request(uuid) from public, anon, authenticated;
revoke execute on function public.has_current_check(public.sops) from public, anon, authenticated;
revoke execute on function public.sop_requires_check(public.sops) from public, anon, authenticated;
revoke execute on function public.riyadh_today() from public, anon, authenticated;
revoke execute on function public.riyadh_end_of_day(date) from public, anon, authenticated;
revoke execute on function public.earliest_response_date() from public, anon, authenticated;

-- Actions: signed-in users only (each checks who may act).
revoke execute on function public.submit_for_review(uuid, uuid[], date, integer, text) from public, anon;
revoke execute on function public.add_reviewers(uuid, uuid[], date, integer, text) from public, anon;
revoke execute on function public.accept_review(uuid) from public, anon;
revoke execute on function public.decline_review(uuid, text) from public, anon;
revoke execute on function public.decide_review(uuid, text, text) from public, anon;
revoke execute on function public.remove_reviewer(uuid, text) from public, anon;
revoke execute on function public.respond_to_comments(uuid, text) from public, anon;
revoke execute on function public.withdraw_due_requests(uuid) from public, anon;
grant execute on function public.submit_for_review(uuid, uuid[], date, integer, text) to authenticated;
grant execute on function public.add_reviewers(uuid, uuid[], date, integer, text) to authenticated;
grant execute on function public.accept_review(uuid) to authenticated;
grant execute on function public.decline_review(uuid, text) to authenticated;
grant execute on function public.decide_review(uuid, text, text) to authenticated;
grant execute on function public.remove_reviewer(uuid, text) to authenticated;
grant execute on function public.respond_to_comments(uuid, text) to authenticated;
grant execute on function public.withdraw_due_requests(uuid) to authenticated;

-- ---------- Row level security ----------

alter table public.review_rounds enable row level security;
alter table public.review_requests enable row level security;
alter table public.sop_comments enable row level security;

-- Like the SOP's other parts: by the version, so a reviewer only sees the rounds sent to them.
create policy "People can read the review rounds of the versions they may see"
on public.review_rounds for select to authenticated
using (public.can_view_version(sop_id, version));

create policy "People can read the review requests of the versions they may see"
on public.review_requests for select to authenticated
using (exists (
  select 1 from public.review_rounds r
  where r.id = round_id and public.can_view_version(r.sop_id, r.version)
));

create policy "People can read the comments on the versions they may see"
on public.sop_comments for select to authenticated
using (public.can_view_version(sop_id, version));

revoke all on public.review_rounds, public.review_requests, public.sop_comments from anon, authenticated;
grant select on public.review_rounds, public.review_requests, public.sop_comments to authenticated;
