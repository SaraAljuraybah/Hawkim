-- Follow-up to the Divisions & Departments migrations (20261105120000-20261105150000).
--
-- 1. Positions: profiles.position (the primary title) and employee_positions stay consistent.
--    Changing the primary title replaces the old primary row; secondary titles are never touched.
--    RPCs that write the whole list (set_employee_positions, create_employee_profile) turn the
--    profile trigger off for their own statements, so it can never remove what they just wrote.
-- 2. Missing positions: a read-only admin audit. Nothing is invented or backfilled.
-- 3. Division email is OPTIONAL. When given it must be a valid address (same rule as the form).
-- 4. Users are persisted: create (with department, positions and roles), change roles, delete.
--    The Auth account itself is created/banned by the Edge Function `manage-users`; every
--    database rule (admin only, Approver only in Quality, Admin exclusive, last admin, self,
--    permissions in use on SOPs, one active profile per email) is enforced here.
-- 5. latest_round(): rounds created in the same transaction tie on requested_at; the version
--    (unique and increasing per SOP) now breaks the tie instead of a random uuid.
begin;

-- ---------- 3. Optional division email ----------
create or replace function public.validate_division_management() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.name := btrim(new.name);
  new.email := nullif(btrim(new.email), '');
  new.description := btrim(coalesce(new.description, ''));
  if new.name is null or length(new.name) not between 1 and 100
    or (new.email is not null and (length(new.email) > 254
      or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
    or length(new.description) > 500 then
    raise exception 'Invalid division fields' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end; $$;

-- ---------- 1. Position synchronisation ----------
create or replace function public.sync_profile_positions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- The calling RPC writes the complete, ordered position list itself.
  if coalesce(current_setting('hawkim.positions_managed', true), '') = 'on' then return null; end if;
  if tg_op = 'UPDATE' and old.department_id is distinct from new.department_id then
    -- Positions belong to the home department: the old department's titles end with it.
    delete from public.employee_positions where profile_id = new.id and department_id is distinct from new.department_id;
  elsif tg_op = 'UPDATE' and new.department_id is not null and old.position is not null and new.position is not null
      and old.position is distinct from new.position then
    -- The primary title was edited: it REPLACES the old primary row. Secondary rows are untouched.
    if lower(old.position) <> lower(new.position) and exists (select 1 from public.employee_positions
        where profile_id = new.id and department_id = new.department_id and lower(title) = lower(new.position)) then
      -- The new primary is already one of the employee's titles: keep that row, drop the replaced one.
      delete from public.employee_positions
      where profile_id = new.id and department_id = new.department_id and lower(title) = lower(old.position);
    else
      update public.employee_positions set title = new.position
      where profile_id = new.id and department_id = new.department_id and lower(title) = lower(old.position);
    end if;
  end if;
  if new.department_id is not null and new.deleted_at is null and new.position is not null then
    insert into public.employee_positions(profile_id, department_id, title)
    values (new.id, new.department_id, new.position)
    on conflict (profile_id, department_id, lower(title)) do nothing;
    -- The primary title is listed first.
    update public.employee_positions e set sort_order = m.lowest - 1
    from (select coalesce(min(sort_order), 1) as lowest from public.employee_positions
          where profile_id = new.id and department_id = new.department_id and lower(title) <> lower(new.position)) m
    where e.profile_id = new.id and e.department_id = new.department_id and lower(e.title) = lower(new.position)
      and e.sort_order >= m.lowest;
  end if;
  return null;
end; $$;

-- Same contract as before; it now marks its own writes so the profile trigger leaves them alone.
create or replace function public.set_employee_positions(p_profile_id uuid, p_titles text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare person public.profiles; titles text[]; i integer;
begin
  if not public.can_read_organizational_structure() then raise exception 'Administrator required' using errcode = '42501'; end if;
  select array_agg(t order by n) into titles from (
    select distinct on (lower(btrim(t))) btrim(t) as t, n
    from unnest(coalesce(p_titles, '{}')) with ordinality as x(t, n)
    where btrim(coalesce(t, '')) <> '' order by lower(btrim(t)), n
  ) cleaned;
  if titles is null or cardinality(titles) = 0 then
    raise exception 'A position is required for a department assignment' using errcode = '23514';
  end if;
  if cardinality(titles) > 10 or exists (select 1 from unnest(titles) t where char_length(t) > 100) then
    raise exception 'Invalid position fields' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles where id = p_profile_id and deleted_at is null for update;
  if not found or person.department_id is null then
    raise exception 'Organization changed; refresh and try again' using errcode = '40001';
  end if;
  if exists (select 1 from public.departments d where d.id = person.department_id and (d.removed_at is not null or d.deletion_job_id is not null)) then
    raise exception 'Department is no longer available' using errcode = '23514';
  end if;
  perform pg_catalog.set_config('hawkim.positions_managed', 'on', true);
  delete from public.employee_positions where profile_id = person.id;
  for i in 1 .. cardinality(titles) loop
    insert into public.employee_positions(profile_id, department_id, title, sort_order)
    values (person.id, person.department_id, titles[i], i - 1);
  end loop;
  update public.profiles set position = titles[1] where id = person.id and position is distinct from titles[1];
  perform pg_catalog.set_config('hawkim.positions_managed', 'off', true);
  insert into public.organization_management_audit(actor_id, action, entity_id, details)
  values (auth.uid(), 'set-employee-positions', person.id::text,
    jsonb_build_object('departmentId', person.department_id, 'positions', to_jsonb(titles)));
end; $$;

-- ---------- 2. Missing-position audit (read only) ----------
create function public.get_employees_missing_positions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_organizational_structure() then raise exception 'Administrator required' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email,
      'departmentId', p.department_id) order by p.full_name, p.id), '[]')
    from public.profiles p
    where p.deleted_at is null and p.department_id is not null
      and not exists (select 1 from public.employee_positions e where e.profile_id = p.id and e.department_id = p.department_id));
end; $$;

-- ---------- 5. Deterministic latest round ----------
create or replace function public.latest_round(p_sop_id uuid) returns public.review_rounds
language sql stable security definer set search_path = '' as $$
  select r.* from public.review_rounds r where r.sop_id = p_sop_id
  order by r.requested_at desc, r.version desc, r.id desc limit 1;
$$;

-- ---------- 4. Users ----------
-- The same "permission in use" rule as frontend/src/lib/userAdmin.ts (sopsUsing). Approver
-- assignments are not stored in the database yet, so an Approver permission is never "in use".
create function public.user_role_in_use(p_user_id uuid, p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_role
    when 'author' then exists (
      select 1 from public.sops s
      where s.deleted_at is null and s.status <> 'published'
        and (s.author_id = p_user_id
          or exists (select 1 from public.sop_co_authors c where c.sop_id = s.id and c.user_id = p_user_id)))
    when 'reviewer' then exists (
      select 1 from public.sops s
      cross join lateral public.latest_round(s.id) lr
      where s.deleted_at is null and s.status in ('in-review', 'in-approval', 'returned', 'approved') and lr.id is not null
        and exists (
          select 1 from (
            select q.status from public.review_requests q
            where q.round_id = lr.id and q.reviewer_id = p_user_id order by q.seq desc limit 1
          ) latest where latest.status not in ('declined', 'withdrawn', 'expired', 'removed')))
    else false
  end;
$$;

-- Validates a new employee; with p_user_id null it only validates (the Edge Function's dry run
-- before any Auth account exists). With the new Auth user's id it creates profile, positions and roles.
create function public.create_employee_profile(p_user_id uuid, p_name text, p_email text, p_phone text,
  p_department_id text, p_positions text[], p_roles public.app_role[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\s+', '', 'g');
  titles text[]; roles public.app_role[]; words text[]; v_initials text; quality boolean; i integer;
begin
  if not public.can_read_organizational_structure() then raise exception 'Administrator required' using errcode = '42501'; end if;
  if v_phone ~ '^05[0-9]{8}$' then v_phone := '+966' || substr(v_phone, 2); end if;
  select array_agg(t order by n) into titles from (
    select distinct on (lower(btrim(t))) btrim(t) as t, n
    from unnest(coalesce(p_positions, '{}')) with ordinality as x(t, n)
    where btrim(coalesce(t, '')) <> '' order by lower(btrim(t)), n
  ) cleaned;
  select coalesce(array_agg(distinct r), '{}') into roles from unnest(coalesce(p_roles, '{}')) r where r is not null;
  if length(v_name) not between 1 and 100
    or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or v_phone !~ '^\+9665[0-9]{8}$'
    or titles is null or cardinality(titles) > 10 or exists (select 1 from unnest(titles) t where char_length(t) > 100) then
    raise exception 'Invalid user fields' using errcode = '23514';
  end if;
  if 'admin' = any(roles) and cardinality(roles) > 1 then
    raise exception 'An admin cannot have any other role' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select d.is_quality into quality from public.departments d
  where d.id = p_department_id and d.removed_at is null and d.deletion_job_id is null for share;
  if not found then raise exception 'Department is no longer available' using errcode = '23514'; end if;
  if 'approver' = any(roles) and not quality then
    raise exception 'Approver is only allowed in the Quality department' using errcode = '23514';
  end if;
  if exists (select 1 from public.profiles where email = v_email and deleted_at is null) then
    raise exception 'Email already in use' using errcode = '23505';
  end if;
  if p_user_id is null then return null; end if;

  -- The Auth account was just created for exactly this address, and has no profile yet.
  if not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email)
    or exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Organization changed; refresh and try again' using errcode = '40001';
  end if;
  words := regexp_split_to_array(v_name, '\s+');
  v_initials := upper(left(words[1], 1) || case when cardinality(words) > 1 then left(words[cardinality(words)], 1) else '' end);
  perform pg_catalog.set_config('hawkim.positions_managed', 'on', true);
  insert into public.profiles(id, full_name, email, initials, department_id, phone, position)
  values (p_user_id, v_name, v_email, v_initials, p_department_id, v_phone, titles[1]);
  for i in 1 .. cardinality(titles) loop
    insert into public.employee_positions(profile_id, department_id, title, sort_order)
    values (p_user_id, p_department_id, titles[i], i - 1);
  end loop;
  perform pg_catalog.set_config('hawkim.positions_managed', 'off', true);
  insert into public.user_roles(user_id, role) select p_user_id, r from unnest(roles) r;
  insert into public.organization_management_audit(actor_id, action, entity_id, details)
  values (auth.uid(), 'create-user', p_user_id::text,
    jsonb_build_object('departmentId', p_department_id, 'positions', to_jsonb(titles), 'roles', to_jsonb(roles)));
  return p_user_id;
end; $$;

create function public.set_user_roles(p_user_id uuid, p_roles public.app_role[]) returns void
language plpgsql security definer set search_path = '' as $$
declare person public.profiles; roles public.app_role[]; removed public.app_role;
begin
  if not public.can_read_organizational_structure() then raise exception 'Administrator required' using errcode = '42501'; end if;
  select coalesce(array_agg(distinct r), '{}') into roles from unnest(coalesce(p_roles, '{}')) r where r is not null;
  if 'admin' = any(roles) and cardinality(roles) > 1 then
    raise exception 'An admin cannot have any other role' using errcode = '23514';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles where id = p_user_id and deleted_at is null for update;
  if not found then raise exception 'Organization changed; refresh and try again' using errcode = '40001'; end if;
  for removed in select role from public.user_roles where user_id = p_user_id and not (role = any(roles)) loop
    if removed = 'admin' then
      if p_user_id = auth.uid() then
        raise exception 'You cannot remove your own Admin permission' using errcode = '23514';
      end if;
      if not exists (select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
          where r.role = 'admin' and p.deleted_at is null and r.user_id <> p_user_id) then
        raise exception 'At least one admin must remain' using errcode = '23514';
      end if;
    elsif public.user_role_in_use(p_user_id, removed) then
      raise exception 'This permission is in use on SOPs' using errcode = '23514';
    end if;
  end loop;
  delete from public.user_roles where user_id = p_user_id and not (role = any(roles));
  insert into public.user_roles(user_id, role) select p_user_id, r from unnest(roles) r on conflict do nothing;
  insert into public.organization_management_audit(actor_id, action, entity_id, details)
  values (auth.uid(), 'set-user-roles', p_user_id::text, jsonb_build_object('roles', to_jsonb(roles)));
end; $$;

-- Ends a profile (the name stays on SOP history). Repeating it on an ended profile returns the id
-- again, so the Edge Function can retry banning the Auth account.
create function public.delete_user_profile(p_user_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare person public.profiles;
begin
  if not public.can_read_organizational_structure() then raise exception 'Administrator required' using errcode = '42501'; end if;
  if p_user_id = auth.uid() then raise exception 'You cannot delete your own account' using errcode = '23514'; end if;
  perform pg_catalog.pg_advisory_xact_lock(72441, 1);
  select * into person from public.profiles where id = p_user_id for update;
  if not found then raise exception 'Organization changed; refresh and try again' using errcode = '40001'; end if;
  if person.deleted_at is not null then return person.id; end if;
  if exists (select 1 from public.user_roles where user_id = p_user_id and role = 'admin')
    and not exists (select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
      where r.role = 'admin' and p.deleted_at is null and r.user_id <> p_user_id) then
    raise exception 'At least one admin must remain' using errcode = '23514';
  end if;
  if public.user_role_in_use(p_user_id, 'author') or public.user_role_in_use(p_user_id, 'reviewer') then
    raise exception 'This user still has work in progress on SOPs' using errcode = '23514';
  end if;
  update public.profiles set deleted_at = now() where id = p_user_id;
  insert into public.organization_management_audit(actor_id, action, entity_id) values (auth.uid(), 'delete-user', p_user_id::text);
  return p_user_id;
end; $$;

revoke all on function public.get_employees_missing_positions(), public.user_role_in_use(uuid, public.app_role),
  public.create_employee_profile(uuid, text, text, text, text, text[], public.app_role[]),
  public.set_user_roles(uuid, public.app_role[]), public.delete_user_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.get_employees_missing_positions(),
  public.create_employee_profile(uuid, text, text, text, text, text[], public.app_role[]),
  public.set_user_roles(uuid, public.app_role[]), public.delete_user_profile(uuid)
  to authenticated;
notify pgrst, 'reload schema';
commit;
