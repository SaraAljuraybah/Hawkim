-- The main author can change the review duration of a request that is still pending, not only the
-- review deadline of an accepted one. A pending request has no review deadline yet: its review time
-- starts when the reviewer accepts, so only review_duration_days changes (in working days), and
-- accept_review then counts the deadline from it, as it already does. The response deadline (two
-- working days to accept) is fixed by the server and doesn't change.
--
-- change_review_deadline keeps every other rule: the main author only, the reviewer's latest request
-- in the open round of the current version of an SOP In Review, 1 to 3650 working days, and a change
-- that differs from what is saved. For a pending request it adds a 'review-duration-changed' event for
-- the reviewer, with the previous and new durations in two new columns; an accepted request works as
-- before ('review-deadline-changed'). Removed, declined, withdrawn, expired, completed and returned
-- requests, older versions and Drafts are refused as before.
--
-- The new event is private like 'review-deadline-changed': the author, co-authors and the reviewer.
-- supabase/scripts/rollback_pending_review_duration.sql undoes it.

begin;

alter table public.timeline_events
  add column previous_review_duration_days integer check (previous_review_duration_days between 1 and 3650),
  add column new_review_duration_days integer check (new_review_duration_days between 1 and 3650);

create or replace function public.change_review_deadline(p_request_id uuid, p_review_duration_days integer) returns void
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
  -- Read both again: an expiry just now can have changed the request, and the SOP with it.
  select * into sop from public.sops s where s.id = request.sop_id;
  select * into request from public.review_requests q where q.id = p_request_id;
  select * into cur_round from public.review_rounds r where r.id = request.round_id;
  if sop.status <> 'in-review' or cur_round.id <> (public.latest_round(sop.id)).id
     or cur_round.version <> sop.current_version or cur_round.status <> 'open' then
    raise exception 'This review round is no longer open' using errcode = 'check_violation', hint = 'review-deadline-unavailable';
  end if;
  if request.status not in ('pending', 'accepted')
     or request.id <> (select q.id from public.latest_requests(cur_round.id) q where q.reviewer_id = request.reviewer_id) then
    raise exception 'This reviewer isn''t reviewing this version any more' using errcode = 'check_violation', hint = 'review-deadline-unavailable';
  end if;
  if p_review_duration_days is null or p_review_duration_days not between 1 and 3650 then
    raise exception 'Choose a review duration of 1 to 3650 working days' using errcode = 'check_violation';
  end if;

  -- Pending: no review deadline yet. Only the duration it will start with changes.
  if request.status = 'pending' then
    if p_review_duration_days = request.review_duration_days and request.deadline_policy = 'riyadh-working-days-v1' then
      raise exception 'That is already the review duration' using errcode = 'check_violation';
    end if;
    update public.review_requests
    set review_duration_days = p_review_duration_days, deadline_policy = 'riyadh-working-days-v1'
    where id = p_request_id;
    insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, review_round_id, review_request_id, previous_review_duration_days, new_review_duration_days)
    values (sop.id, 'review-duration-changed', sop.author_id, cur_round.version, array[request.reviewer_id], cur_round.id, request.id, request.review_duration_days, p_review_duration_days);
    update public.sops set updated_at = now() where id = sop.id;
    return;
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

-- CREATE OR REPLACE keeps the privileges; restated.
revoke execute on function public.change_review_deadline(uuid, integer) from public, anon;
grant execute on function public.change_review_deadline(uuid, integer) to authenticated;

-- ---------- Who can read the new event ----------

drop policy "People can read the timeline events they may see" on public.timeline_events;

create policy "People can read the timeline events they may see"
on public.timeline_events for select to authenticated
using (
  case when type in ('response', 'review-deadline-changed', 'review-expired', 'review-request-resent', 'review-duration-changed')
    then public.can_read_review_note(sop_id, recipient_ids)
    else public.can_view_version(sop_id, version)
  end
);

commit;
