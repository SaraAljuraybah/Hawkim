-- Undoes 20261114130100_pending_review_duration.sql. change_review_deadline gets its previous
-- definition back, unchanged (from 20261101170100_change_review_deadline.sql: accepted requests only),
-- and the timeline read policy its previous one (from 20261102120100_review_request_expired.sql).
-- The 'review-duration-changed' events are deleted (that policy wouldn't keep them private), then the
-- two columns they used are dropped. Durations already changed on pending requests stay: they are
-- ordinary review durations, used when the reviewer accepts. The 'review-duration-changed' value added
-- by 20261114130000_review_duration_event.sql stays (Postgres can't drop an enum value); nothing uses it
-- afterwards, and that migration stays recorded so it isn't run again.
begin;

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

drop policy "People can read the timeline events they may see" on public.timeline_events;

create policy "People can read the timeline events they may see"
on public.timeline_events for select to authenticated
using (
  case when type in ('response', 'review-deadline-changed', 'review-expired', 'review-request-resent')
    then public.can_read_review_note(sop_id, recipient_ids)
    else public.can_view_version(sop_id, version)
  end
);

delete from public.timeline_events where type = 'review-duration-changed';

alter table public.timeline_events
  drop column previous_review_duration_days,
  drop column new_review_duration_days;

delete from supabase_migrations.schema_migrations where version = '20261114130100';

commit;
