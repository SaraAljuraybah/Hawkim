-- Undoes supabase/migrations/20261116190000_scope_reviews.sql: the functions as they were before it
-- (pg_get_functiondef). Run as the owner (postgres). Only safe while MedCare is the only organization.
begin;

CREATE OR REPLACE FUNCTION public.is_eligible_reviewer(p_sop_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = p_user_id and p.deleted_at is null
    join public.departments d on d.id = p.department_id and d.removed_at is null
    where s.id = p_sop_id
      and s.author_id <> p_user_id
      and not public.is_co_author(s.id, p_user_id)
      and exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'reviewer')
      and not exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'admin')
  );
$function$

;

CREATE OR REPLACE FUNCTION public.open_request(p_request_id uuid)
 RETURNS review_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if request.status = 'expired' then
    raise exception 'This review request expired because it was not accepted or declined by its response due date' using errcode = 'check_violation', hint = 'request-expired';
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
$function$

;

CREATE OR REPLACE FUNCTION public.remove_reviewer(p_request_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.resend_review_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     or cur_round.version <> sop.current_version or cur_round.status not in ('open', 'completed', 'changes-requested') then
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
  -- A Completed or Changes Requested round reopens here: the resent reviewer is taking part.
  perform public.settle_review_round(cur_round.id);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.change_review_deadline(p_request_id uuid, p_review_duration_days integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.submit_for_review(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sop public.sops;
  latest public.review_rounds;
  is_first boolean;
  new_round uuid;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  perform public.assert_main_author(sop);
  perform public.withdraw_due(p_sop_id);
  -- Read it again: if the last pending requests just expired, the SOP is a Draft now.
  select * into sop from public.sops s where s.id = p_sop_id;
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
$function$

;

CREATE OR REPLACE FUNCTION public.add_reviewers(p_sop_id uuid, p_reviewer_ids uuid[], p_response_due_date date, p_review_duration_days integer, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  sop public.sops;
  cur_round public.review_rounds;
  person uuid;
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  perform public.assert_main_author(sop);
  perform public.withdraw_due(p_sop_id);
  cur_round := public.latest_round(p_sop_id);
  if sop.status <> 'in-review' or cur_round.id is null or cur_round.version <> sop.current_version or cur_round.status not in ('open', 'completed', 'changes-requested') then
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
  -- A Completed or Changes Requested round reopens here: the new reviewer is taking part.
  perform public.settle_review_round(cur_round.id);
end;
$function$

;

CREATE OR REPLACE FUNCTION public.respond_to_comments(p_sop_id uuid, p_text text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  latest_comment timestamptz;
  round_start timestamptz;
  recipients uuid[];
  request public.review_requests;
  round_version integer;
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
  if p_request_id is not null then
    select * into request from public.review_requests q where q.id = p_request_id;
    if request.id is null or request.sop_id <> p_sop_id then
      raise exception 'This review request isn''t part of this SOP' using errcode = 'check_violation', hint = 'response-not-available';
    end if;
    if request.status = 'removed' then
      raise exception 'This reviewer was removed from the review, so they can''t receive a response' using errcode = 'check_violation', hint = 'response-not-available';
    end if;
    if request.comment_id is null then
      raise exception 'This reviewer left no comments to respond to' using errcode = 'check_violation', hint = 'response-not-available';
    end if;
    select r.version into round_version from public.review_rounds r where r.id = request.round_id;
    insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, note, review_round_id, review_request_id)
    values (p_sop_id, 'response', actor, round_version, array[request.reviewer_id], btrim(p_text), request.round_id, request.id);
    update public.sops set updated_at = now() where id = p_sop_id;
    return;
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
$function$

;

notify pgrst, 'reload schema';
commit;
