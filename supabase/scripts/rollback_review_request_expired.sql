-- Undoes 20261102120100_review_request_expired.sql. Only if something goes wrong after applying it.
-- Run it yourself in the Supabase SQL Editor (it is not a migration), and only AFTER the app is back
-- on the code from before this change.
--
-- Every expired request becomes withdrawn again. Requests that were backfilled kept withdrawn_at, so
-- they return exactly as they were; requests that expired after the change get it from expired_at.
-- Their timeline events return to review-withdrawn. A request that was sent again stays a normal
-- request, and its event becomes "submitted", so the timeline will read "Submitted for review".
-- The expired_at column and the enum values stay, because the app may read the column and Postgres
-- can't easily remove the values; both are harmless. Both migrations stay recorded as applied, so a
-- later fix goes in as a new migration.

begin;

update public.review_requests
set status = 'withdrawn', withdrawn_at = coalesce(withdrawn_at, expired_at), expired_at = null
where status = 'expired';

update public.review_requests
set status_before_removal = 'withdrawn', withdrawn_at = coalesce(withdrawn_at, expired_at), expired_at = null
where status_before_removal = 'expired';

update public.timeline_events set type = 'review-withdrawn' where type = 'review-expired';
update public.timeline_events set type = 'submitted' where type = 'review-request-resent';

drop policy "People can read the timeline events they may see" on public.timeline_events;

create policy "People can read the timeline events they may see"
on public.timeline_events for select to authenticated
using (
  case when type in ('response', 'review-deadline-changed')
    then public.can_read_review_note(sop_id, recipient_ids)
    else public.can_view_version(sop_id, version)
  end
);

create or replace function public.withdraw_due(p_sop_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sop public.sops;
  cur_round public.review_rounds;
  due public.review_requests;
  changed boolean := false;
begin
  select * into sop from public.sops s where s.id = p_sop_id;
  cur_round := public.latest_round(p_sop_id);
  if sop.id is null or cur_round.id is null or cur_round.status <> 'open' or sop.status <> 'in-review' then
    return;
  end if;
  for due in
    select q.* from public.latest_requests(cur_round.id) q
    where q.status = 'pending' and q.response_due_at is not null and q.response_due_at <= now()
  loop
    update public.review_requests set status = 'withdrawn', withdrawn_at = due.response_due_at where id = due.id;
    insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, review_round_id, review_request_id, created_at)
    values (p_sop_id, 'review-withdrawn', null, cur_round.version, array[sop.author_id, due.reviewer_id], cur_round.id, due.id, due.response_due_at);
    changed := true;
  end loop;
  if changed then
    perform public.settle_review_round(cur_round.id);
  end if;
end;
$$;

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
  where q.status not in ('declined', 'withdrawn', 'removed');

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

create or replace function public.open_request(p_request_id uuid) returns public.review_requests
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
  perform public.withdraw_due(sop.id);
  select * into request from public.review_requests q where q.id = p_request_id;
  select * into cur_round from public.review_rounds r where r.id = request.round_id;
  if sop.status <> 'in-review' or cur_round.id <> (public.latest_round(sop.id)).id or cur_round.version <> sop.current_version or cur_round.status <> 'open' then
    raise exception 'This internal review round is no longer open' using errcode = 'check_violation';
  end if;
  if request.status = 'withdrawn' then
    raise exception 'This review request was withdrawn because it was not accepted or declined by its response due date' using errcode = 'check_violation';
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
$$;

create or replace function public.upload_sop_version(p_sop_id uuid, p_storage_path text, p_file_name text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  cur_round public.review_rounds;
  upload record;
  next_version integer;
begin
  -- Lock the SOP so two uploads at once can't get the same number.
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if not found or not public.has_role('author')
     or (sop.author_id <> actor and not public.is_co_author(p_sop_id, actor)) then
    raise exception 'Only the author or a co-author can upload a version' using errcode = 'insufficient_privilege';
  end if;
  if sop.status not in ('draft', 'returned', 'in-review') then
    raise exception 'A version can''t be uploaded while the SOP is %', sop.status using errcode = 'check_violation';
  end if;
  if sop.status = 'in-review' then
    perform public.withdraw_due(p_sop_id);
    cur_round := public.latest_round(p_sop_id);
    if cur_round.id is null or (cur_round.status = 'open' and exists (
      select 1 from public.latest_requests(cur_round.id) q where q.status not in ('declined', 'withdrawn', 'removed')
    )) then
      raise exception 'A new version can be uploaded once every reviewer has finished the current one' using errcode = 'check_violation';
    end if;
  end if;

  select * into upload from public.check_sop_file(p_storage_path, p_file_name);
  select max(v.version) + 1 into next_version from public.sop_versions v where v.sop_id = p_sop_id;

  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (p_sop_id, next_version, btrim(p_file_name), upload.file_type, p_storage_path, upload.file_size, actor);

  update public.sops set current_version = next_version, updated_at = now() where id = p_sop_id;

  insert into public.timeline_events (sop_id, type, actor_id, version)
  values (p_sop_id, 'version-uploaded', actor, next_version);

  return next_version;
end;
$$;

drop function public.resend_review_request(uuid);
drop function public.expire_due_requests(uuid);
drop function public.expire_due(uuid);

notify pgrst, 'reload schema';

commit;
