-- Requires 20261102120000_review_request_expired_values.sql first.
--
-- An unanswered review request is no longer withdrawn when its response deadline ends: it becomes
-- Expired. It is locked for the reviewer, and the main author decides what happens next: remove the
-- reviewer, add a different one, or send the request again (resend_review_request).
--
-- Expiring still runs at the start of every review action and when the browser asks; a scheduled
-- job isn't needed, because in-app notifications are only seen by someone who has the app open,
-- and loading the SOP expires what is due. An expired reviewer counts as not taking part, as a
-- withdrawn one did, so a round can complete without them and Send Again reopens it.
--
-- withdraw_due keeps its name for the functions that call it, and withdraw_due_requests stays for
-- tabs still open on the previous app. add_reviewers is unchanged: its list of statuses leaves
-- 'expired' out, so it refuses a reviewer whose latest request expired (Send Again is for them).
--
-- Past automatic withdrawals become Expired, with withdrawn_at kept, so the rollback can restore
-- them. Rounds don't change. Requests withdrawn and later removed stay as they are.
-- supabase/scripts/rollback_review_request_expired.sql undoes it.

alter table public.review_requests add column expired_at timestamptz;

comment on column public.review_requests.expired_at is
  'When the response deadline ended with no answer. Requests from before this status also keep withdrawn_at.';

-- ---------- Expiring ----------

-- THE ONLY AUTOMATIC STEP: in the SOP's open round, each latest request still pending at the end
-- of its response deadline expires, dated at that deadline, by System. The main author and the
-- reviewer are told. Does nothing when nothing is due.
create function public.expire_due(p_sop_id uuid) returns void
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
    update public.review_requests set status = 'expired', expired_at = due.response_due_at where id = due.id;
    insert into public.timeline_events (sop_id, type, actor_id, version, recipient_ids, review_round_id, review_request_id, created_at)
    values (p_sop_id, 'review-expired', null, cur_round.version, array[sop.author_id, due.reviewer_id], cur_round.id, due.id, due.response_due_at);
    changed := true;
  end loop;
  if changed then
    perform public.settle_review_round(cur_round.id);
  end if;
end;
$$;

create or replace function public.withdraw_due(p_sop_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.expire_due(p_sop_id);
end;
$$;

-- Applies the expiry now, for anyone who may see the SOP (the browser calls it when an SOP loads
-- and when a response deadline passes).
create function public.expire_due_requests(p_sop_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_view_sop(p_sop_id) then
    raise exception 'This SOP isn''t available' using errcode = 'insufficient_privilege';
  end if;
  perform 1 from public.sops s where s.id = p_sop_id for update;
  perform public.expire_due(p_sop_id);
end;
$$;

-- ---------- An expired reviewer isn't taking part, and can't act ----------

-- 'expired' joins the statuses that don't count, as withdrawn did.
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

-- An expired request is locked; the hint lets the browser read the SOP again.
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
$$;

-- 'expired' joins the statuses that don't count, as withdrawn did.
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
      select 1 from public.latest_requests(cur_round.id) q where q.status not in ('declined', 'withdrawn', 'expired', 'removed')
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

-- ---------- Sending an expired request again ----------

-- The main author sends the same version to the same reviewer again, with the same review duration
-- and a new response deadline (set by the server). It is a new request: the expired one stays in
-- the history, and the round reopens if it had completed.
create function public.resend_review_request(p_request_id uuid) returns void
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

revoke execute on function public.expire_due(uuid) from public, anon, authenticated;
revoke execute on function public.expire_due_requests(uuid) from public, anon;
revoke execute on function public.resend_review_request(uuid) from public, anon;
grant execute on function public.expire_due_requests(uuid) to authenticated;
grant execute on function public.resend_review_request(uuid) to authenticated;

-- ---------- Who can read the new events ----------

drop policy "People can read the timeline events they may see" on public.timeline_events;

create policy "People can read the timeline events they may see"
on public.timeline_events for select to authenticated
using (
  case when type in ('response', 'review-deadline-changed', 'review-expired', 'review-request-resent')
    then public.can_read_review_note(sop_id, recipient_ids)
    else public.can_view_version(sop_id, version)
  end
);

-- ---------- Past automatic withdrawals ----------

-- Only requests withdrawn by the automatic step: dated exactly at their response deadline, never
-- answered or removed, with System's timeline event. One statement, so both tables change together.
with safe as (
  select q.id
  from public.review_requests q
  where q.status = 'withdrawn'
    and q.withdrawn_at is not null and q.withdrawn_at = q.response_due_at
    and q.accepted_at is null and q.decided_at is null and q.removed_at is null
    and exists (
      select 1 from public.timeline_events e
      where e.review_request_id = q.id and e.type = 'review-withdrawn' and e.actor_id is null
    )
), events as (
  update public.timeline_events e set type = 'review-expired'
  from safe
  where e.review_request_id = safe.id and e.type = 'review-withdrawn' and e.actor_id is null
)
update public.review_requests q
set status = 'expired', expired_at = q.withdrawn_at
from safe
where q.id = safe.id;

-- So the API sees the new functions and column straight away.
notify pgrst, 'reload schema';
