-- Undoes 20261102130000_other_department_reviewers.sql. Only if something goes wrong after applying it.
-- Run it yourself in the Supabase SQL Editor (it is not a migration), and only AFTER the app is back
-- on the code from before this change.
--
-- FIRST run this. Every request listed here is from another department. After the rollback those
-- reviewers can't accept or decide, so the main author should remove the open ones first. Someone
-- who had lost access gets it back for the versions sent to them, as the old rules allow.
--
--   select q.id, q.status, s.title, p.full_name
--   from public.review_requests q
--   join public.sops s on s.id = q.sop_id
--   join public.profiles p on p.id = q.reviewer_id
--   where p.department_id <> s.department_id;
--
-- It restores the seven functions as they were and removes the four new ones. No row changes.
-- The migration stays recorded as applied, so a later fix goes in as a new migration.

begin;

create or replace function public.is_eligible_reviewer(p_sop_id uuid, p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sops s
    join public.profiles p on p.id = p_user_id and p.deleted_at is null and p.department_id = s.department_id
    where s.id = p_sop_id
      and s.author_id <> p_user_id
      and not public.is_co_author(s.id, p_user_id)
      and exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'reviewer')
      and not exists (select 1 from public.user_roles r where r.user_id = p_user_id and r.role = 'admin')
  );
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

  perform public.send_review_requests(sop, cur_round.id, 'review-request-resent', array[request.reviewer_id], null, request.review_duration_days, null);
  update public.sops set updated_at = now() where id = sop.id;
  perform public.settle_review_round(cur_round.id);
end;
$$;

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
        or exists (select 1 from public.review_requests q where q.sop_id = s.id and q.reviewer_id = p.id)
      )
  );
$$;

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
        or exists (
          select 1 from public.review_requests q
          join public.review_rounds r on r.id = q.round_id
          where q.sop_id = s.id and q.reviewer_id = p.id and r.version = p_version
        )
      )
  );
$$;

drop function public.my_closed_review_requests();
drop function public.reviewer_lost_access(uuid, uuid);
drop function public.has_home_finished(uuid);
drop function public.all_home_reviewers(uuid, uuid[]);

notify pgrst, 'reload schema';

commit;
