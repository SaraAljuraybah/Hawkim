-- A reply to one reviewer. respond_to_comments gets an optional third parameter, p_request_id.
--
-- Without it (or with null) nothing changes: the reply goes to everyone who commented since the
-- submission before the latest comment, as in 20261026150000_internal_review.sql.
--
-- With it, the reply goes only to that request's reviewer, under the same rules for who can respond,
-- the published block and the text. Any version is allowed, and the event is saved on the version
-- of the request's round: a reviewer can only read the timeline of the versions sent to them.
-- The request must be from this SOP, not removed, and have a comment (a decline reason isn't one).
-- These three refusals share a hint, which the app recognises, so keep it stable.
--
-- "Addressed to one reviewer" is about the recipient and the notification. It doesn't make the
-- reply private: anyone who can view that version can read it in the timeline.
--
-- Postgres treats the extra parameter as a different function, so the old one is dropped, and the
-- revoke and grant are done again. Calls with two arguments keep working through the default.
-- supabase/scripts/rollback_respond_to_one_reviewer.sql undoes it.

drop function public.respond_to_comments(uuid, text);

-- The author or a co-author replies to the comments. Without p_request_id, sent to everyone who
-- commented since the submission before the latest comment; with it, only to that request's
-- reviewer. Not once the SOP is published.
create function public.respond_to_comments(p_sop_id uuid, p_text text, p_request_id uuid default null) returns void
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke execute on function public.respond_to_comments(uuid, text, uuid) from public, anon;
grant execute on function public.respond_to_comments(uuid, text, uuid) to authenticated;

-- So the API sees the new function straight away.
notify pgrst, 'reload schema';
