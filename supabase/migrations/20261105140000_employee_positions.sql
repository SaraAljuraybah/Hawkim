-- Employee positions (job titles): an employee can hold SEVERAL positions in their department.
--
-- - One row per (employee, department, title). Positions belong to the employee's current home
--   department (profiles.department_id), which still drives every access rule; no new access model.
-- - A position is required for a department assignment: at commit time every active profile with a
--   department must have at least one position there. Checked by deferred constraint triggers, so one
--   transaction can assign a department and its positions together.
-- - profiles.position stays the PRIMARY position (read by the profile and user pages). It is synced into
--   this table, so existing writers that set profiles.position keep working.
-- - Existing profiles are backfilled from profiles.position. Legacy profiles without a position stay
--   valid until their department or positions change (see docs/divisions-departments.md, audit query).
-- - The browser can only read (active users, like profiles). Changes go through the admin-only RPC
--   set_employee_positions, which is also audited.
begin;

create table public.employee_positions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id),
  department_id text not null references public.departments(id),
  title text not null constraint employee_positions_title_length
    check (title = btrim(title) and char_length(title) between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create unique index employee_positions_unique_title
  on public.employee_positions(profile_id, department_id, lower(title));
create index employee_positions_department on public.employee_positions(department_id);

alter table public.employee_positions enable row level security;
create policy "Active users can read employee positions"
on public.employee_positions for select to authenticated
using ((select public.is_active_user()));
revoke all on public.employee_positions from public, anon, authenticated;
grant select on public.employee_positions to authenticated;

-- A position can only be held in the employee's current home department.
create function public.guard_employee_position() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.profile_id
      and p.deleted_at is null and p.department_id = new.department_id) then
    raise exception 'Positions must belong to the employee''s department' using errcode = '23514';
  end if;
  return new;
end; $$;
create trigger employee_positions_home_department before insert or update on public.employee_positions
for each row execute function public.guard_employee_position();

-- Keep the primary position (profiles.position) in the table, and drop positions of a department
-- the employee left. Runs after the row exists, so the foreign key is satisfied.
create function public.sync_profile_positions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.department_id is distinct from new.department_id then
    delete from public.employee_positions where profile_id = new.id and department_id is distinct from new.department_id;
  end if;
  if new.department_id is not null and new.deleted_at is null and new.position is not null then
    insert into public.employee_positions(profile_id, department_id, title)
    values (new.id, new.department_id, new.position)
    on conflict (profile_id, department_id, lower(title)) do nothing;
  end if;
  return null;
end; $$;
create trigger profiles_sync_positions after insert or update of department_id, position, deleted_at on public.profiles
for each row execute function public.sync_profile_positions();

-- Commit-time rule: an active employee assigned to a department holds at least one position there.
create function public.assert_employee_has_position(p_profile_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles p where p.id = p_profile_id and p.deleted_at is null and p.department_id is not null
      and not exists (select 1 from public.employee_positions e where e.profile_id = p.id and e.department_id = p.department_id)) then
    raise exception 'A position is required for a department assignment' using errcode = '23514';
  end if;
end; $$;
create function public.require_profile_position() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.assert_employee_has_position(new.id); return null; end; $$;
create function public.require_remaining_position() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.assert_employee_has_position(old.profile_id); return null; end; $$;
create constraint trigger profiles_require_position after insert or update of department_id on public.profiles
deferrable initially deferred for each row execute function public.require_profile_position();
create constraint trigger employee_positions_require_one after update or delete on public.employee_positions
deferrable initially deferred for each row execute function public.require_remaining_position();

-- Backfill from the existing single job title.
insert into public.employee_positions(profile_id, department_id, title)
select p.id, p.department_id, p.position from public.profiles p
where p.department_id is not null and p.deleted_at is null and p.position is not null
on conflict (profile_id, department_id, lower(title)) do nothing;

-- Admin-only: replace an employee's positions in their department. The first is the primary one.
create function public.set_employee_positions(p_profile_id uuid, p_titles text[]) returns void
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
  delete from public.employee_positions where profile_id = person.id;
  for i in 1 .. cardinality(titles) loop
    insert into public.employee_positions(profile_id, department_id, title, sort_order)
    values (person.id, person.department_id, titles[i], i - 1);
  end loop;
  update public.profiles set position = titles[1] where id = person.id and position is distinct from titles[1];
  insert into public.organization_management_audit(actor_id, action, entity_id, details)
  values (auth.uid(), 'set-employee-positions', person.id::text,
    jsonb_build_object('departmentId', person.department_id, 'positions', to_jsonb(titles)));
end; $$;

-- Snapshot: adds each employee's positions and server-computed division totals (distinct people,
-- SOP records), so totals never depend on which rows the browser has expanded or filtered.
create or replace function public.get_divisions_departments() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_organizational_structure() then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  return (
    with roles as (
      select user_id, jsonb_agg(role order by role) as permissions from public.user_roles group by user_id
    ), positions as (
      select profile_id, department_id, jsonb_agg(title order by sort_order, lower(title)) as titles
      from public.employee_positions group by profile_id, department_id
    ), active_people as (
      select p.* from public.profiles p where p.deleted_at is null and p.department_id is not null
    ), employees as (
      select p.department_id, count(distinct p.id) as n, jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'email', p.email, 'initials', p.initials, 'departmentId', p.department_id,
        'permissions', coalesce(r.permissions, '[]'), 'positions', coalesce(pos.titles, '[]')) order by p.full_name, p.id) as people
      from active_people p left join roles r on r.user_id = p.id
      left join positions pos on pos.profile_id = p.id and pos.department_id = p.department_id
      group by p.department_id
    ), live_sops as (
      select s.id, s.department_id, s.status from public.sops s where s.deleted_at is null and s.directory_group = 'department'
    ), status_counts as (
      select department_id, jsonb_object_agg(status, n) as counts
      from (select department_id, status, count(*) as n from live_sops group by department_id, status) t group by department_id
    ), documents as (
      select department_id, count(*) as n from live_sops group by department_id
    ), division_totals as (
      select d.division_id,
        count(distinct d.id) as departments,
        (select count(distinct p.id) from active_people p join public.departments x on x.id = p.department_id
          where x.division_id = d.division_id and x.removed_at is null) as employees,
        (select count(*) from live_sops s join public.departments x on x.id = s.department_id
          where x.division_id = d.division_id and x.removed_at is null) as sops
      from public.departments d where d.removed_at is null and d.division_id is not null group by d.division_id
    )
    select jsonb_build_object(
      'divisions', (select coalesce(jsonb_agg(to_jsonb(v) || jsonb_build_object(
          'department_count', coalesce(t.departments, 0), 'employees', coalesce(t.employees, 0), 'sops', coalesce(t.sops, 0))
        order by v.name, v.id), '[]')
        from public.divisions v left join division_totals t on t.division_id = v.id where v.is_active is not false),
      'departments', (select coalesce(jsonb_agg(to_jsonb(d) || jsonb_build_object(
        'employees', coalesce(e.n, 0), 'people', coalesce(e.people, '[]'), 'sops', coalesce(s.n, 0),
        'status_counts', coalesce(c.counts, '{}')) order by d.name, d.id), '[]')
        from public.departments d left join employees e on e.department_id = d.id
        left join documents s on s.department_id = d.id left join status_counts c on c.department_id = d.id
        where d.removed_at is null)
    )
  );
end; $$;

revoke all on function public.guard_employee_position(), public.sync_profile_positions(),
  public.assert_employee_has_position(uuid), public.require_profile_position(), public.require_remaining_position()
  from public, anon, authenticated;
revoke all on function public.set_employee_positions(uuid, text[]) from public, anon, authenticated;
grant execute on function public.set_employee_positions(uuid, text[]) to authenticated;
revoke all on function public.get_divisions_departments() from public, anon, authenticated;
grant execute on function public.get_divisions_departments() to authenticated;
notify pgrst, 'reload schema';
commit;
