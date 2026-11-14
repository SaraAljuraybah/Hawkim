-- Undoes 20261114120100_review_back_to_draft.sql. Both functions get their previous definitions back,
-- unchanged:
--   - settle_review_round from 20261102120100_review_request_expired.sql: a round with nobody taking
--     part stays open, and the SOP In Review;
--   - submit_for_review from 20261102130000_other_department_reviewers.sql: a Draft always gets a new
--     round.
-- Data goes back to the state those definitions give:
--   - a Draft whose latest round is 'closed' is In Review again (a deleted SOP is left as it is: its row
--     can't change);
--   - every 'closed' round is 'open' again, with closed_at cleared.
-- A round reopened by Submit for Review is already an ordinary open round. Requests and timeline events
-- were never changed, so nothing else is restored. The 'closed' value added by
-- 20261114120000_review_round_closed_value.sql stays (Postgres can't drop an enum value); nothing uses
-- it afterwards, and that migration stays recorded so it isn't run again.
begin;

create or replace function public.settle_review_round(p_round_id uuid) returns void
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
  where q.status not in ('declined', 'withdrawn', 'expired', 'removed');

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

-- The first send of each version: only reviewers from the SOP's department.
create or replace function public.submit_for_review(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
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
  if not public.all_home_reviewers(p_sop_id, p_reviewer_ids) then
    raise exception 'The first reviewers of a version must be from the SOP''s department' using errcode = 'check_violation', hint = 'home-reviewers-first';
  end if;

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

revoke execute on function public.settle_review_round(uuid) from public, anon, authenticated;
revoke execute on function public.submit_for_review(uuid, uuid[], date, integer, text) from public, anon;
grant execute on function public.submit_for_review(uuid, uuid[], date, integer, text) to authenticated;

update public.sops s set status = 'in-review', updated_at = now()
where s.status = 'draft' and s.deleted_at is null and (public.latest_round(s.id)).status = 'closed';

update public.review_rounds set status = 'open', closed_at = null where status = 'closed';

delete from supabase_migrations.schema_migrations where version = '20261114120100';

commit;
