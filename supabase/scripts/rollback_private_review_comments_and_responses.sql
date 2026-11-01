-- Undoes 20261101160000_private_review_comments_and_responses.sql. Only if something goes wrong
-- after applying it. Run it yourself in the Supabase SQL Editor (it is not a migration).
--
-- It restores both read policies exactly as they were and removes the helper, so anyone who can
-- view a version can read its comments and responses again. No row changes, and nothing changes in
-- the app. The migration stays recorded as applied, so a later fix goes in as a new migration.

begin;

drop policy "People can read the comments they may see" on public.sop_comments;

create policy "People can read the comments on the versions they may see"
on public.sop_comments for select to authenticated
using (public.can_view_version(sop_id, version));

drop policy "People can read the timeline events they may see" on public.timeline_events;

create policy "People can read the timeline of the versions they may see"
on public.timeline_events for select to authenticated
using (public.can_view_version(sop_id, version));

drop function public.can_read_review_note(uuid, uuid[]);

commit;
