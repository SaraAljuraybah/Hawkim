-- SOP Details on the author's SOP page: the main author changes the SOP's title and description together,
-- at any stage before it is published (including while it is in review or in approval), as
-- update_sop_description already allowed for the description.
--
-- Only those two columns change (and updated_at, as for a description edit). Nothing else does: the status,
-- the review rounds and reviewer assignments and decisions, the versions and their files, the comments, the
-- compliance checks and the timeline are untouched, and no review cycle starts. No timeline event, as for
-- description edits (they aren't part of the SOP's review history).
--
-- Rules: the caller holds the author permission and is the SOP's main author (not a co-author); the SOP isn't
-- published; the title is required (trimmed, 1 to 150 characters: the column's own rule; the app also keeps
-- titles to 50, as when adding an SOP); the description is optional, trimmed, up to 1000 characters.
-- A removed SOP can't be edited (sops_deleted_guard refuses the update).
--
-- update_sop_description is kept as it is.

create function public.update_sop_details(p_sop_id uuid, p_title text, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  new_title text := btrim(coalesce(p_title, ''));
  new_description text := btrim(coalesce(p_description, ''));
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if not found or not public.has_role('author') or sop.author_id <> actor then
    raise exception 'Only the main author can change the SOP details' using errcode = 'insufficient_privilege';
  end if;
  if sop.status = 'published' then
    raise exception 'The SOP details can''t change once the SOP is published' using errcode = 'check_violation';
  end if;
  if length(new_title) not between 1 and 150 then
    raise exception 'The title is required and must be at most 150 characters' using errcode = 'check_violation';
  end if;
  if length(new_description) > 1000 then
    raise exception 'The description must be at most 1000 characters' using errcode = 'check_violation';
  end if;

  update public.sops set title = new_title, description = new_description, updated_at = now() where id = p_sop_id;
end;
$$;

alter function public.update_sop_details(uuid, text, text) owner to postgres;
revoke execute on function public.update_sop_details(uuid, text, text) from public, anon;
grant execute on function public.update_sop_details(uuid, text, text) to authenticated;
