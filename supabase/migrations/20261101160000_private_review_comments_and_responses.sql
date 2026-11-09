-- Reviewers review independently: a reviewer's comments, and the responses addressed to a reviewer,
-- can be read only by the SOP's author, its co-authors and that reviewer. Other reviewers can't read
-- them, nor can department members once the SOP is published.
--
-- This changes two read policies and nothing else. Other timeline events, review_requests and every
-- other table keep their rules, so decline reasons, removal reasons and other reviewers' decisions
-- stay readable as before. No row changes, and the functions that write these rows are unaffected.
--
-- Responses don't use can_view_version on purpose: older responses were saved on the SOP's current
-- version, which their reviewer may not have been sent.
--
-- Anyone in recipient_ids can read that response. When approval moves to the database, that lets
-- an Approver read a reply to their own comment; approvers still don't read reviewer comments.
-- supabase/scripts/rollback_private_review_comments_and_responses.sql undoes it.

-- ---------- Helper ----------

-- The signed-in person is active and is the SOP's author, a co-author, or one of these people.
create function public.can_read_review_note(p_sop_id uuid, p_people uuid[]) returns boolean
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
      and (s.author_id = p.id or public.is_co_author(s.id, p.id) or p.id = any (p_people))
  );
$$;

revoke execute on function public.can_read_review_note(uuid, uuid[]) from public, anon;
grant execute on function public.can_read_review_note(uuid, uuid[]) to authenticated;

-- ---------- Who can read comments and responses ----------

drop policy "People can read the comments on the versions they may see" on public.sop_comments;

create policy "People can read the comments they may see"
on public.sop_comments for select to authenticated
using (
  case when role = 'reviewer'
    then public.can_read_review_note(sop_id, array[author_id])
    else public.can_view_version(sop_id, version)
  end
);

drop policy "People can read the timeline of the versions they may see" on public.timeline_events;

create policy "People can read the timeline events they may see"
on public.timeline_events for select to authenticated
using (
  case when type = 'response'
    then public.can_read_review_note(sop_id, recipient_ids)
    else public.can_view_version(sop_id, version)
  end
);
