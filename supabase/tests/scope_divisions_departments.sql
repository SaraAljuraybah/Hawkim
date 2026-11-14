-- Tests for 20261116170000_scope_divisions_departments.sql: each organization has its own divisions and
-- departments (names, initials and the Quality department are per organization), and nobody sees, edits,
-- deletes or counts another organization's through Divisions & Departments or the organizational structure.
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text, p_hint text default null) returns void
language plpgsql as $$
declare rejected boolean := false; v_hint text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    if sqlstate <> p_state then raise; end if;
    if p_hint is not null and v_hint is distinct from p_hint then
      raise exception 'Expected hint % but got % from %', p_hint, v_hint, p_sql;
    end if;
    rejected := true;
  end;
  assert rejected, 'Expected ' || p_state || coalesce(' (' || p_hint || ')', '') || ' from ' || p_sql;
end;
$$;
create function pg_temp.act_as(p_user uuid, p_role text default 'authenticated') returns void
language plpgsql as $$
begin
  perform set_config('role', p_role, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
end;
$$;
create function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner() to public;

-- MedCare: the seed's divisions and departments (Pharmacovigilance, Quality Assurance, ...), an Admin.
-- Other: an Admin and a staff member in its own division and department.
insert into auth.users (id, email, aud, role)
select ('98300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'dd-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 4) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
values ('98300000-0000-4000-8000-000000000001', 'DD Med Admin', 'dd-1@test.invalid', 'DM', null, '+966512345601', null);
insert into public.user_roles (user_id, role) values ('98300000-0000-4000-8000-000000000001', 'admin');
-- The local seed has no divisions: one for MedCare's Pharmacovigilance department.
insert into public.divisions (id, name, description) values ('dd-med-division', 'DD Medical Division', '');
update public.departments set division_id = 'dd-med-division' where id = 'pharmacovigilance';

insert into public.organizations (id, name) values ('98300000-0000-4000-8000-0000000000aa', 'DD Other');
insert into public.divisions (id, name, description, organization_id)
values ('dd-other-division', 'DD Other Division', '', '98300000-0000-4000-8000-0000000000aa');
insert into public.departments (id, name, initials, division_id, organization_id)
values ('dd-other-department', 'DD Other Department', 'DOD', 'dd-other-division', '98300000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('98300000-0000-4000-8000-000000000002', 'DD Other Admin', 'dd-2@test.invalid', 'OA', null, '+966512345602', null, '98300000-0000-4000-8000-0000000000aa'),
  ('98300000-0000-4000-8000-000000000003', 'DD Other Staff', 'dd-3@test.invalid', 'OS', 'dd-other-department', '+966512345603', 'Officer',
   '98300000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('98300000-0000-4000-8000-000000000002', 'admin'), ('98300000-0000-4000-8000-000000000003', 'author');
set constraints all immediate;
set constraints all deferred;

do $$
declare
  other constant uuid := '98300000-0000-4000-8000-0000000000aa';
  med_admin constant uuid := '98300000-0000-4000-8000-000000000001';
  other_admin constant uuid := '98300000-0000-4000-8000-000000000002';
  other_staff constant uuid := '98300000-0000-4000-8000-000000000003';
  med_division text := (select division_id from public.departments where id = 'pharmacovigilance');
  med_division_name text := (select v.name from public.divisions v join public.departments d on d.division_id = v.id where d.id = 'pharmacovigilance');
  med_stamp timestamptz := (select updated_at from public.departments where id = 'pharmacovigilance');
  med_division_stamp timestamptz := (select v.updated_at from public.divisions v join public.departments d on d.division_id = v.id where d.id = 'pharmacovigilance');
  v_department text;
  v_division text;
  v_snapshot jsonb;
  v_structure jsonb;
begin
  assert med_division = 'dd-med-division', 'MedCare''s Pharmacovigilance department is in its division';
  perform pg_temp.act_as(other_admin);

  -- ---------- Names, initials and divisions are per organization ----------
  -- Other can use MedCare's names and initials.
  v_division := public.save_division(null, med_division_name, '', '');
  v_department := public.save_department(null, 'Pharmacovigilance', 'PV', '', v_division, null, '');
  perform pg_temp.as_owner();
  assert (select organization_id from public.departments where id = v_department) = other, 'created in Other';
  assert (select organization_id from public.divisions where id = v_division) = other;
  perform pg_temp.act_as(other_admin);
  -- Within one organization they are still unique.
  perform pg_temp.expect_error(format('select public.save_department(null, %L, %L, %L, %L, null, %L)',
    'pharmacovigilance', 'XYZ', '', v_division, ''), '23505');
  perform pg_temp.expect_error(format('select public.save_division(null, %L, %L, %L)', med_division_name, '', ''), '23505');
  -- A department can't be put in another organization's division.
  perform pg_temp.expect_error(format('select public.save_department(null, %L, %L, %L, %L, null, %L)',
    'DD Elsewhere', 'DDE', '', med_division, ''), '23514');

  -- ---------- MedCare's divisions and departments: unknown to Other (the conflict answer) ----------
  perform pg_temp.expect_error(format('select public.save_department(%L, %L, %L, %L, %L, %L, %L)',
    'pharmacovigilance', 'Taken', 'TK', '', v_division, med_stamp, ''), 'P0001', 'conflict');
  perform pg_temp.expect_error(format('select public.delete_department(%L, %L, %L)', 'pharmacovigilance', 'empty', med_stamp), 'P0001', 'conflict');
  perform pg_temp.expect_error(format('select public.begin_department_file_deletion(%L, %L)', 'pharmacovigilance', med_stamp), 'P0001', 'conflict');
  perform pg_temp.expect_error(format('select public.save_division(%L, %L, %L, %L, %L)', med_division, 'Taken', '', '', med_division_stamp), 'P0001', 'conflict');
  perform pg_temp.expect_error(format('select public.delete_division(%L, %L)', med_division, med_division_stamp), 'P0001', 'conflict');

  -- ---------- The Admin's snapshot and the organizational structure: only their organization ----------
  v_snapshot := public.get_divisions_departments();
  assert not exists (select 1 from jsonb_array_elements(v_snapshot->'departments') d where d->>'id' = 'pharmacovigilance'),
    'MedCare''s departments aren''t in Other''s snapshot';
  assert not exists (select 1 from jsonb_array_elements(v_snapshot->'divisions') d where d->>'id' = med_division),
    'nor its divisions';
  assert (select count(*) from jsonb_array_elements(v_snapshot->'departments')) = 2, 'Other''s two departments';
  assert (select sum((d->>'employees')::int) from jsonb_array_elements(v_snapshot->'departments') d) = 1, 'and its one employee';
  perform pg_temp.act_as(other_staff);
  v_structure := public.get_organizational_structure();
  assert (select count(*) from jsonb_array_elements(v_structure->'departments')) = 2, 'staff see their organization''s chart';
  assert not exists (select 1 from jsonb_array_elements(v_structure->'departments') d where d->>'id' = 'pharmacovigilance');
  assert not exists (select 1 from public.organizational_structure_emails() e where e.id in ('pharmacovigilance', med_division)),
    'no emails of MedCare''s divisions or departments';
  -- MedCare's Admin still sees MedCare's own.
  perform pg_temp.act_as(med_admin);
  v_snapshot := public.get_divisions_departments();
  assert exists (select 1 from jsonb_array_elements(v_snapshot->'departments') d where d->>'id' = 'pharmacovigilance'), 'MedCare sees its own';
  assert not exists (select 1 from jsonb_array_elements(v_snapshot->'departments') d where d->>'id' in ('dd-other-department', v_department)),
    'and none of Other''s';

  -- ---------- One Quality department per organization ----------
  perform pg_temp.as_owner();
  assert exists (select 1 from public.departments where is_quality and organization_id <> other), 'MedCare has its Quality department';
  update public.departments set is_quality = true where id = v_department;
  perform pg_temp.expect_error(format('update public.departments set is_quality = true where id = %L', 'dd-other-department'), '23505');

  -- Nothing of MedCare changed.
  assert (select name from public.departments where id = 'pharmacovigilance') = 'Pharmacovigilance' and
    (select removed_at from public.departments where id = 'pharmacovigilance') is null, 'MedCare''s department untouched';
end;
$$;

rollback;
