-- Feature 1 of connecting the admin portal: an admin saves a user's name, phone and position.
--
-- Additive: adds one function and changes no table, column, policy or existing row. Email,
-- department, permissions, adding and deleting users stay in the browser for now.
--
-- Changing position runs the existing trigger profiles_sync_positions, which replaces the user's
-- primary row in employee_positions; their other positions are kept.
-- Undo: supabase/scripts/rollback_update_user_details.sql

begin;

create function public.update_user_details(p_user_id uuid, p_full_name text, p_phone text, p_position text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  person public.profiles;
  new_name text := btrim(p_full_name);
  new_position text := btrim(p_position);
  new_initials text;
  words text[];
  changed text[];
begin
  if not public.can_manage_organization() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if new_name is null or char_length(new_name) not between 1 and 100
    or p_phone is null or p_phone !~ '^\+9665[0-9]{8}$'
    or new_position is null or char_length(new_position) not between 1 and 100 then
    raise exception 'Invalid user details' using errcode = '23514';
  end if;

  -- The same lock as the other organization changes, including set_employee_positions.
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles p where p.id = p_user_id and p.deleted_at is null for update;
  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  -- Initials only follow a new name, worked out as in accept_access_request.
  new_initials := person.initials;
  if new_name is distinct from person.full_name then
    words := pg_catalog.regexp_split_to_array(new_name, '\s+');
    new_initials := upper(case
      when pg_catalog.array_length(words, 1) >= 2 then left(words[1], 1) || left(words[pg_catalog.array_length(words, 1)], 1)
      else left(words[1], 2)
    end);
  end if;

  changed := pg_catalog.array_remove(array[
    case when new_name is distinct from person.full_name then 'name' end,
    case when p_phone is distinct from person.phone then 'phone' end,
    case when new_position is distinct from person."position" then 'position' end
  ], null);

  update public.profiles p
  set full_name = new_name, initials = new_initials, phone = p_phone
  where p.id = person.id;

  -- Separate, because naming position in an update runs the positions trigger even when it's unchanged.
  if new_position is distinct from person."position" then
    update public.profiles p set "position" = new_position where p.id = person.id;
  end if;

  insert into public.organization_management_audit (actor_id, action, entity_id, details)
  values ((select auth.uid()), 'update-user-details', person.id::text, jsonb_build_object('fields', to_jsonb(changed)));

  return jsonb_build_object('name', new_name, 'initials', new_initials, 'phone', p_phone, 'position', new_position);
end;
$$;

alter function public.update_user_details(uuid, text, text, text) owner to postgres;
revoke all on function public.update_user_details(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.update_user_details(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
commit;
