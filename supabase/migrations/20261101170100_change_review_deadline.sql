-- The main author can change a reviewer's review deadline, and a review duration has no practical
-- maximum any more.
--
-- change_review_deadline: only the active main author, only for a reviewer's latest request, while
-- they are reviewing (accepted) the current version in an open round. The author gives a number of
-- working days, counted from the Riyadh date of acceptance (that date not counted), so a deadline
-- is never a Friday or a Saturday. It can be earlier or later, and can be set on a request accepted
-- without one, as often as needed. The result can't be in the past, and must differ from the current
-- deadline. The new duration and dates are saved, and each change adds one timeline event with the
-- old and new deadlines, addressed to the reviewer.
--
-- A calendar-v1 request is counted in working days like any other, and moves to the working-day
-- policy, so its saved duration and policy agree. Requests nobody edits are not touched.
--
-- Review durations: 1 to 3650 working days. That is a technical limit, far above real use, so a date
-- stays one the database and the browser can handle. The date is now calculated arithmetically.
--
-- The new event is private, like responses: only the author, co-authors and that reviewer can read
-- it. review_requests is unchanged, so anyone who can view a version still sees the current deadline.
-- supabase/scripts/rollback_change_review_deadline.sql undoes this file.

-- ---------- The old and new deadlines on the event ----------

alter table public.timeline_events
  add column previous_review_due_at timestamptz,
  add column new_review_due_at timestamptz;

-- ---------- Review durations up to 3650 working days ----------

alter table public.review_requests drop constraint review_requests_review_duration_days_check;
alter table public.review_requests
  add constraint review_requests_review_duration_days_check check (review_duration_days between 1 and 3650);

comment on column public.review_requests.deadline_policy is
  'Deadline policy fixed when the request was sent, until the main author changes its review deadline. calendar-v1: requests sent before the working-day policy (calendar-day review duration). riyadh-working-days-v1: Sunday to Thursday in Asia/Riyadh, the starting date not counted.';

create or replace function public.hawkim_add_working_days(p_from date, p_days integer)
returns date
language plpgsql
immutable
parallel safe
set search_path = pg_catalog
as $$
declare
  result date;
  remaining integer;
begin
  if p_from is null or not isfinite(p_from) or p_days is null or p_days < 1 or p_days > 3650 then
    raise exception using errcode = '22023', message = 'A finite date and a duration of 1 to 3650 working days are required';
  end if;
  -- Any 7 days in a row hold 5 working days, so whole weeks are arithmetic; at most 5 remain.
  result := p_from + ((p_days - 1) / 5) * 7;
  remaining := (p_days - 1) % 5 + 1;
  while remaining > 0 loop
    result := result + 1;
    if extract(isodow from result) not in (5, 6) then
      remaining := remaining - 1;
    end if;
  end loop;
  return result;
end;
$$;

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
  if p_review_duration_days is not null and p_review_duration_days not between 1 and 3650 then
    raise exception 'Choose an optional review duration of 1 to 3650 working days' using errcode = 'check_violation';
  end if;
end;
$$;

-- ---------- Changing a review deadline ----------

create function public.change_review_deadline(p_request_id uuid, p_review_duration_days integer) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.review_requests;
  sop public.sops;
  cur_round public.review_rounds;
  due_at timestamptz;
begin
  select * into request from public.review_requests q where q.id = p_request_id;
  if request.id is null then
    raise exception 'This review request doesn''t exist' using errcode = 'no_data_found';
  end if;
  -- Lock the SOP so actions on it happen one after the other.
  select * into sop from public.sops s where s.id = request.sop_id for update;
  perform public.assert_main_author(sop);
  perform public.withdraw_due(sop.id);
  select * into request from public.review_requests q where q.id = p_request_id;
  select * into cur_round from public.review_rounds r where r.id = request.round_id;
  if sop.status <> 'in-review' or cur_round.id <> (public.latest_round(sop.id)).id
     or cur_round.version <> sop.current_version or cur_round.status <> 'open' then
    raise exception 'This review round is no longer open' using errcode = 'check_violation', hint = 'review-deadline-unavailable';
  end if;
  if request.status <> 'accepted'
     or request.id <> (select q.id from public.latest_requests(cur_round.id) q where q.reviewer_id = request.reviewer_id) then
    raise exception 'This reviewer isn''t reviewing this version any more' using errcode = 'check_violation', hint = 'review-deadline-unavailable';
  end if;
  if p_review_duration_days is null or p_review_duration_days not between 1 and 3650 then
    raise exception 'Choose a review duration of 1 to 3650 working days' using errcode = 'check_violation';
  end if;

  due_at := public.hawkim_review_due_at(request.accepted_at, p_review_duration_days);
  if due_at < now() then
    raise exception 'That deadline has already passed' using errcode = 'check_violation';
  end if;
  if due_at = request.review_due_at then
    raise exception 'That is already the review deadline' using errcode = 'check_violation';
  end if;

  update public.review_requests
  set review_duration_days = p_review_duration_days, review_due_date = public.hawkim_riyadh_date(due_at),
      review_due_at = due_at, deadline_policy = 'riyadh-working-days-v1'
  where id = p_request_id;
  insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, review_round_id, review_request_id, previous_review_due_at, new_review_due_at)
  values (sop.id, 'review-deadline-changed', sop.author_id, cur_round.version, array[request.reviewer_id], cur_round.id, request.id, request.review_due_at, due_at);
  update public.sops set updated_at = now() where id = sop.id;
end;
$$;

revoke execute on function public.change_review_deadline(uuid, integer) from public, anon;
grant execute on function public.change_review_deadline(uuid, integer) to authenticated;

-- ---------- Who can read the new event ----------

drop policy "People can read the timeline events they may see" on public.timeline_events;

create policy "People can read the timeline events they may see"
on public.timeline_events for select to authenticated
using (
  case when type in ('response', 'review-deadline-changed')
    then public.can_read_review_note(sop_id, recipient_ids)
    else public.can_view_version(sop_id, version)
  end
);

-- So the API sees the new function and columns straight away.
notify pgrst, 'reload schema';
