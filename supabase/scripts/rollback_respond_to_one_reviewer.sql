-- Undoes 20261101150000_respond_to_one_reviewer.sql. Only if something goes wrong after applying it.
-- Run it yourself in the Supabase SQL Editor (it is not a migration), and only AFTER the app is back
-- on PER_REVIEWER_RESPONSE_ACTIVE = false: with it on, the app sends p_request_id, which this removes.
--
-- It restores respond_to_comments exactly as it is in 20261026150000_internal_review.sql, with its
-- revoke and grant. No row changes: replies already sent stay in the timeline, with their request.
-- The migration stays recorded as applied, so a later fix goes in as a new migration.

begin;

drop function public.respond_to_comments(uuid, text, uuid);

-- The author or a co-author replies to the comments. Sent to everyone who commented since the
-- submission before the latest comment. Not once the SOP is published.
create function public.respond_to_comments(p_sop_id uuid, p_text text) returns void
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

revoke execute on function public.respond_to_comments(uuid, text) from public, anon;
grant execute on function public.respond_to_comments(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
