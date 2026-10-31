-- PROPOSAL — NOT APPROVED, NOT APPLIED.
-- Lives in supabase/proposals/ so that `supabase db push` never picks it up. Requires
-- 20261029000000_review_deadline_helpers.sql first. See supabase/proposals/REVIEW_NOTES.md.
--
-- Switches NEW internal review requests to the Riyadh working-day policy:
-- - Response deadline: fixed, the end (23:59:59.999 Riyadh) of the second working date after the
--   date the request is sent. Calculated only by the server, from one server timestamp, so a
--   browser preview made before midnight can never cause a rejection after midnight.
-- - Review duration: optional, 1 to 30 working days, counted from the Riyadh date of acceptance
--   (that date not counted).
--
-- Existing records are preserved:
-- - Existing requests are labelled calendar-v1 and keep their saved deadlines; nothing is recalculated.
-- - A calendar-v1 request that is still pending and is accepted later keeps its calendar-day duration.
-- - withdraw_due() is not changed: it compares against the saved response_due_at.
--
-- Deliberately NOT changed here: SOP title limits (the table keeps 1–150; the 50-character limit is
-- frontend only), the 500-character submission-note limit, RLS, grants of the public RPCs, triggers,
-- and every other function.

-- Which policy a request's deadlines follow, fixed when it is sent. Adding the column with the
-- default calendar-v1 labels every existing request; new requests then default to the new policy.
alter table public.review_requests
  add column deadline_policy text not null default 'calendar-v1'
    check (deadline_policy in ('calendar-v1', 'riyadh-working-days-v1'));
alter table public.review_requests
  alter column deadline_policy set default 'riyadh-working-days-v1';

comment on column public.review_requests.deadline_policy is
  'Deadline policy fixed when the request was sent. calendar-v1: requests sent before the working-day policy (calendar-day review duration). riyadh-working-days-v1: Sunday to Thursday in Asia/Riyadh, the starting date not counted.';

-- Same checks as 20261026150000_internal_review.sql, except the response due date: the server now
-- sets it, so the value sent by the browser is ignored (the parameter stays, so the signature and
-- every existing call keep working). Earlier, a browser date that differed from the server's
-- calculation was rejected, which failed around midnight; it is no longer compared at all.
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
  if p_review_duration_days is not null and p_review_duration_days not between 1 and 30 then
    raise exception 'Choose an optional review duration of 1 to 30 working days' using errcode = 'check_violation';
  end if;
end;
$$;

-- Sends a request to each reviewer in the round. One server timestamp sets the send time and the
-- fixed response deadline for the whole batch. p_response_due_date is ignored (see above).
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
  insert into public.review_requests (round_id, sop_id, reviewer_id, assigned_at, response_due_date, response_due_at, review_duration_days, deadline_policy)
  select p_round_id, p_sop.id, person, sent_at, public.hawkim_riyadh_date(response_at),
         response_at, p_review_duration_days, 'riyadh-working-days-v1'
  from unnest(p_reviewer_ids) with ordinality as list (person, n)
  order by list.n;
  insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, note, review_round_id, created_at)
  values (p_sop.id, p_type, (select auth.uid()), round_version, p_reviewer_ids, nullif(btrim(coalesce(p_note, '')), ''), p_round_id, sent_at);
end;
$$;

-- The reviewer takes the task. With a review duration, the review's last day is fixed now, by the
-- request's own policy: working days for new requests, calendar days (as before) for calendar-v1.
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

-- CREATE OR REPLACE keeps the existing privileges; restated for the internal helpers so they stay
-- unavailable from the browser. accept_review keeps its existing grant to authenticated.
revoke execute on function public.check_review_options(uuid, uuid[], date, integer, text) from public, anon, authenticated;
revoke execute on function public.send_review_requests(public.sops, uuid, public.timeline_event_type, uuid[], date, integer, text) from public, anon, authenticated;
