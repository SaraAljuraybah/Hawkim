-- Reviewers from other departments. The main author sends each version first to reviewers from
-- the SOP's department only. Once one of them has finished that version (completed or returned), the
-- main author can add reviewers from any department, and send an expired request of an
-- other-department reviewer again.
--
-- An other-department reviewer reads only the versions sent to them, and only while their latest
-- request on the SOP isn't declined, removed or expired. Then they lose every version, including
-- after publishing; a new request gives it back. my_closed_review_requests still lets them see
-- their own closed requests (title, version, status, reason), for their notifications.
--
-- "Same department" is the reviewer's current department: nothing records it at request time.
-- Their own comments and the responses addressed to them keep following the private rules
-- (can_read_review_note), and same-department reviewers keep the access they had.
-- supabase/scripts/rollback_other_department_reviewers.sql undoes it.

-- ---------- Who counts ----------

-- Every one of these people is from the SOP's department.
create function public.all_home_reviewers(p_sop_id uuid, p_reviewer_ids uuid[]) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = any (p_reviewer_ids)
    where s.id = p_sop_id and p.department_id is distinct from s.department_id
  );
$$;

-- A reviewer from the SOP's department has finished this round's version (completed or returned).
create function public.has_home_finished(p_round_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.latest_requests(p_round_id) q
    join public.sops s on s.id = q.sop_id
    join public.profiles p on p.id = q.reviewer_id
    where p.department_id = s.department_id and q.status in ('completed', 'returned')
  );
$$;

-- An other-department reviewer whose latest request on the SOP was declined, removed or expired.
create function public.reviewer_lost_access(p_sop_id uuid, p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = p_user_id
    where s.id = p_sop_id
      and p.department_id is distinct from s.department_id
      and (
        select q.status from public.review_requests q
        where q.sop_id = s.id and q.reviewer_id = p.id
        order by q.seq desc limit 1
      ) in ('declined', 'removed', 'expired')
  );
$$;

-- ---------- Who can be asked ----------

-- The person can review this SOP: an active Reviewer of any department that still exists, who isn't
-- its author or a co-author. The order departments are asked in is checked where requests are sent.
create or replace function public.is_eligible_reviewer(p_sop_id uuid, p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
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
$$;

-- Same checks; only the wording changes, as reviewers aren't all from the home department now.
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
      raise exception 'Select eligible reviewers; Authors and co-authors cannot review' using errcode = 'check_violation';
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

-- Other departments only once a reviewer from the SOP's department has finished this version.
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

-- The same condition for an other-department reviewer.
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

-- ---------- Who can read ----------

-- Reviewers: unless they lost access (reviewer_lost_access).
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
        or (exists (select 1 from public.review_requests q where q.sop_id = s.id and q.reviewer_id = p.id)
            and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$$;

-- Reviewers: only the versions sent to them, unless they lost access (reviewer_lost_access).
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
        or (exists (
          select 1 from public.review_requests q
          join public.review_rounds r on r.id = q.round_id
          where q.sop_id = s.id and q.reviewer_id = p.id and r.version = p_version
        ) and not public.reviewer_lost_access(s.id, p.id))
      )
  );
$$;

-- ---------- What someone who lost access can still see ----------

-- The signed-in person's own closed requests on SOPs they can no longer read: the title, version,
-- status and reason, and nothing else about the SOP, for their notifications.
create function public.my_closed_review_requests()
returns table (request_id uuid, sop_title text, version integer, status public.review_request_status, reason text, closed_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select q.id, s.title, r.version, q.status, coalesce(q.removal_reason, q.decline_reason), coalesce(q.removed_at, q.expired_at, q.decided_at)
  from public.review_requests q
  join public.sops s on s.id = q.sop_id
  join public.review_rounds r on r.id = q.round_id
  where q.reviewer_id = (select auth.uid())
    and public.is_active_user()
    and public.reviewer_lost_access(q.sop_id, q.reviewer_id)
    and q.seq = (select max(l.seq) from public.review_requests l where l.sop_id = q.sop_id and l.reviewer_id = q.reviewer_id);
$$;

-- Internal helpers: never called from the browser. reviewer_lost_access runs inside the read
-- policies through the security definer view functions, so it needs no grant.
revoke execute on function public.all_home_reviewers(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.has_home_finished(uuid) from public, anon, authenticated;
revoke execute on function public.reviewer_lost_access(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.my_closed_review_requests() from public, anon;
grant execute on function public.my_closed_review_requests() to authenticated;

-- So the API sees the new function straight away.
notify pgrst, 'reload schema';
