-- Undoes 20261106140000_add_reviewers_changes_requested.sql: add_reviewers and
-- resend_review_request again refuse a Changes Requested round (their definitions from
-- 20261102130000_other_department_reviewers.sql). Rounds already reopened stay as they are.
begin;

create or replace function public.add_reviewers(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
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
  if not public.all_home_reviewers(p_sop_id, p_reviewer_ids) and not public.has_home_finished(cur_round.id) then
    raise exception 'A reviewer from the SOP''s department must finish this version first' using errcode = 'check_violation', hint = 'home-reviewer-must-finish';
  end if;

  perform public.send_review_requests(sop, cur_round.id, 'submitted', p_reviewer_ids, p_response_due_date, p_review_duration_days, p_note);
  update public.sops set updated_at = now() where id = p_sop_id;
  perform public.settle_review_round(cur_round.id);
end;
$$;

create or replace function public.resend_review_request(p_request_id uuid) returns void
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
  perform public.assert_main_author(sop);
  perform public.expire_due(sop.id);
  select * into request from public.review_requests q where q.id = p_request_id;
  select * into cur_round from public.review_rounds r where r.id = request.round_id;
  if sop.status <> 'in-review' or cur_round.id <> (public.latest_round(sop.id)).id
     or cur_round.version <> sop.current_version or cur_round.status not in ('open', 'completed') then
    raise exception 'This review round is no longer open' using errcode = 'check_violation', hint = 'request-not-resendable';
  end if;
  if request.status <> 'expired'
     or request.id <> (select q.id from public.latest_requests(cur_round.id) q where q.reviewer_id = request.reviewer_id) then
    raise exception 'This review request can''t be sent again' using errcode = 'check_violation', hint = 'request-not-resendable';
  end if;
  perform public.check_review_options(sop.id, array[request.reviewer_id], null, request.review_duration_days, null);
  if not public.all_home_reviewers(sop.id, array[request.reviewer_id]) and not public.has_home_finished(cur_round.id) then
    raise exception 'A reviewer from the SOP''s department must finish this version first' using errcode = 'check_violation', hint = 'home-reviewer-must-finish';
  end if;

  perform public.send_review_requests(sop, cur_round.id, 'review-request-resent', array[request.reviewer_id], null, request.review_duration_days, null);
  update public.sops set updated_at = now() where id = sop.id;
  perform public.settle_review_round(cur_round.id);
end;
$$;

revoke execute on function public.add_reviewers(uuid, uuid[], date, integer, text) from public, anon;
revoke execute on function public.resend_review_request(uuid) from public, anon;
grant execute on function public.add_reviewers(uuid, uuid[], date, integer, text) to authenticated;
grant execute on function public.resend_review_request(uuid) to authenticated;

delete from supabase_migrations.schema_migrations where version = '20261106140000';

commit;
