-- Back to Draft when nobody is left in the review. When the current round has nobody still taking
-- part (no pending or accepted request) and nobody who finished (no completed or returned request),
-- because every reviewer's latest request was removed, declined, withdrawn or expired, the round is
-- closed ('closed', closed_at set) and the SOP goes back to Draft, for any version. Nothing is
-- deleted: the round and every review request stay as history. No timeline event is added; the
-- removal, decline or expiry already has its own.
--
-- settle_review_round does this. Every path that can leave nobody taking part already ends with it:
-- remove_reviewer, decline_review and expire_due (through withdraw_due and expire_due_requests). If
-- anyone finished, the round settles as before.
--
-- submit_for_review sends the Draft again as before (same-department reviewers only, a 'submitted'
-- event). A round is one per version (unique (sop_id, version)), so when the current version's round
-- is the closed one, it reopens that round ('open', closed_at cleared) and adds the new requests
-- after the old ones, instead of inserting a round. A version uploaded while Draft gets a new round,
-- as before. add_reviewers and resend_review_request need In Review, so they refuse a Draft.
--
-- SOPs already In Review with nobody taking part are not changed here.
-- supabase/scripts/rollback_review_back_to_draft.sql undoes it.

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
  -- Taking part: pending or accepted (still reviewing), completed or returned (finished).
  select count(*),
         count(*) filter (where q.status in ('pending', 'accepted')),
         count(*) filter (where q.status = 'returned')
  into taking, unfinished, returned
  from public.latest_requests(p_round_id) q
  where q.status not in ('declined', 'withdrawn', 'expired', 'removed');

  -- Nobody reviewing and nobody finished: close the round and send the SOP back to Draft.
  if taking = 0 then
    update public.review_rounds set status = 'closed', closed_at = now() where id = p_round_id;
    update public.sops s set status = 'draft', updated_at = now()
    where s.id = cur_round.sop_id and s.status = 'in-review' and (public.latest_round(s.id)).id = p_round_id;
    return;
  end if;
  if unfinished > 0 then
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

-- A Draft whose current version has a closed round reopens it; otherwise as before.
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

  -- Back to Draft with nobody left: this version's round is closed. Reopen it; its requests stay.
  if is_first and latest.id is not null and latest.version = sop.current_version and latest.status = 'closed' then
    update public.review_rounds set status = 'open', closed_at = null where id = latest.id;
    new_round := latest.id;
  else
    insert into public.review_rounds (sop_id, version, requested_by) values (p_sop_id, sop.current_version, sop.author_id)
    returning id into new_round;
  end if;
  if is_first then
    perform public.send_review_requests(sop, new_round, 'submitted', p_reviewer_ids, p_response_due_date, p_review_duration_days, p_note);
  else
    perform public.send_review_requests(sop, new_round, 'resubmitted', p_reviewer_ids, p_response_due_date, p_review_duration_days, p_note);
  end if;
  update public.sops set status = 'in-review', updated_at = now() where id = p_sop_id;
  return new_round;
end;
$$;

-- CREATE OR REPLACE keeps the privileges; restated. settle_review_round is internal: only the review
-- functions call it.
revoke execute on function public.settle_review_round(uuid) from public, anon, authenticated;
revoke execute on function public.submit_for_review(uuid, uuid[], date, integer, text) from public, anon;
grant execute on function public.submit_for_review(uuid, uuid[], date, integer, text) to authenticated;

commit;
