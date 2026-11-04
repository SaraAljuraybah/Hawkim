-- The main author changes the SOP's description at any time before it is published.
-- No timeline event: description edits aren't part of the SOP's history.
create function public.update_sop_description(p_sop_id uuid, p_description text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  sop public.sops;
  cleaned text := btrim(coalesce(p_description, ''));
begin
  select * into sop from public.sops s where s.id = p_sop_id for update;
  if not found or not public.has_role('author') or sop.author_id <> actor then
    raise exception 'Only the main author can change the description' using errcode = 'insufficient_privilege';
  end if;
  if sop.status = 'published' then
    raise exception 'The description can''t change once the SOP is published' using errcode = 'check_violation';
  end if;
  if length(cleaned) > 1000 then
    raise exception 'The description must be at most 1000 characters' using errcode = 'check_violation';
  end if;

  update public.sops set description = cleaned, updated_at = now() where id = p_sop_id;
end;
$$;

revoke execute on function public.update_sop_description(uuid, text) from public, anon;
grant execute on function public.update_sop_description(uuid, text) to authenticated;
