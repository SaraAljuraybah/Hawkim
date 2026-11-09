-- Undoes the working-day review deadlines (20261101120000 and 20261101120100).
-- Only if something goes wrong after applying them. Run it yourself in the Supabase SQL Editor
-- (it is not a migration), and only AFTER the app is back on WORKING_DAY_DEADLINES_ACTIVE = false:
-- the app reads deadline_policy while that switch is on.
--
-- PART 1 runs as it stands. It restores the three functions exactly as they are in
-- 20261026150000_internal_review.sql, so new requests follow the calendar-day rules again.
-- No row changes: every saved deadline, decision and comment stays. Requests still pending keep
-- their saved response deadline; when accepted, their review duration then counts calendar days.
--
-- PART 2 is commented out on purpose. It removes the column and the helpers, which loses the
-- record of which requests followed which policy. Part 1 alone stops the new behaviour, so run
-- Part 2 only if you decide to remove the change for good; see the end of this file.

-- ---------- Part 1: the three functions as they were ----------

begin;

-- Checks what the author chose for new requests (the same for each request sent).
create or replace function public.check_review_options(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
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
create or replace function public.send_review_requests(p_sop public.sops, p_round_id uuid, p_type public.timeline_event_type, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
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

-- The reviewer takes the task; a decision is only possible after accepting. With a review duration,
-- the review's last day is fixed now: the Riyadh date of acceptance plus the duration.
create or replace function public.accept_review(p_request_id uuid) returns void
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

-- CREATE OR REPLACE keeps the existing privileges; restated so the internal functions stay
-- unavailable from the browser. accept_review keeps its grant to authenticated.
revoke execute on function public.check_review_options(uuid, uuid[], date, integer, text) from public, anon, authenticated;
revoke execute on function public.send_review_requests(public.sops, uuid, public.timeline_event_type, uuid[], date, integer, text) from public, anon, authenticated;

commit;

-- ---------- Part 2: remove the column and the helpers (optional, loses the policy labels) ----------

-- begin;
-- alter table public.review_requests drop column deadline_policy;
-- drop function public.hawkim_review_response_due_at(timestamptz);
-- drop function public.hawkim_review_due_at(timestamptz, integer);
-- drop function public.hawkim_riyadh_end_of_day(date);
-- drop function public.hawkim_add_working_days(date, integer);
-- drop function public.hawkim_riyadh_date(timestamptz);
-- commit;
--
-- After Part 2, tell the migration history that both are undone (the CLI, not the SQL Editor):
--   npx supabase migration repair --status reverted 20261101120100
--   npx supabase migration repair --status reverted 20261101120000
