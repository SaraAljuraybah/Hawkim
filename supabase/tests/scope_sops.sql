-- Tests for 20261116180000_scope_sops.sql: each organization numbers its own SOPs (SOP-001, ...), and
-- nobody sees, opens or deletes another organization's SOPs (published ones included, even as an Admin).
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

-- MedCare: an Admin, an author and a published SOP in Pharmacovigilance.
-- Other: an Admin, an author, a reader in the "same" department name, and a draft SOP.
insert into auth.users (id, email, aud, role)
select ('98400000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'sop-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 6) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position") values
  ('98400000-0000-4000-8000-000000000001', 'Sop Med Admin', 'sop-1@test.invalid', 'MA', null, '+966512345601', null),
  ('98400000-0000-4000-8000-000000000002', 'Sop Med Author', 'sop-2@test.invalid', 'MU', 'pharmacovigilance', '+966512345602', 'Officer');
insert into public.user_roles (user_id, role) values
  ('98400000-0000-4000-8000-000000000001', 'admin'), ('98400000-0000-4000-8000-000000000002', 'author');
insert into public.sops (id, title, department_id, author_id, current_version, status)
values ('98400000-0000-4000-8000-0000000000b1', 'Sop Med Published', 'pharmacovigilance', '98400000-0000-4000-8000-000000000002', 1, 'published');
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('98400000-0000-4000-8000-0000000000b1', 1, 'med.pdf', 'pdf', 'sop-test/med.pdf', 1, '98400000-0000-4000-8000-000000000002');

insert into public.organizations (id, name) values ('98400000-0000-4000-8000-0000000000aa', 'Sop Other');
insert into public.departments (id, name, initials, organization_id)
values ('sop-other-pv', 'Pharmacovigilance', 'PV', '98400000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('98400000-0000-4000-8000-000000000003', 'Sop Other Admin', 'sop-3@test.invalid', 'OA', null, '+966512345603', null, '98400000-0000-4000-8000-0000000000aa'),
  ('98400000-0000-4000-8000-000000000004', 'Sop Other Author', 'sop-4@test.invalid', 'OU', 'sop-other-pv', '+966512345604', 'Officer', '98400000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('98400000-0000-4000-8000-000000000003', 'admin'), ('98400000-0000-4000-8000-000000000004', 'author');
set constraints all immediate;
set constraints all deferred;

do $$
declare
  other constant uuid := '98400000-0000-4000-8000-0000000000aa';
  med_admin constant uuid := '98400000-0000-4000-8000-000000000001';
  med_author constant uuid := '98400000-0000-4000-8000-000000000002';
  other_admin constant uuid := '98400000-0000-4000-8000-000000000003';
  other_author constant uuid := '98400000-0000-4000-8000-000000000004';
  med_sop constant uuid := '98400000-0000-4000-8000-0000000000b1';
  medcare uuid := (select organization_id from public.profiles where id = '98400000-0000-4000-8000-000000000001');
  med_last integer := (select last_sop_number from public.organizations where id = (select organization_id from public.profiles where id = '98400000-0000-4000-8000-000000000001'));
  v_sop uuid;
  v_code text;
begin
  -- ---------- SOP codes: per organization ----------
  assert to_regclass('public.sop_code_counter') is null, 'the one counter is gone';
  assert (select code from public.sops where id = med_sop) = 'SOP-' || lpad(med_last::text, 3, '0'), 'MedCare continues its numbering';
  insert into public.sops (title, department_id, author_id, current_version)
  values ('Sop Other First', 'sop-other-pv', other_author, 1) returning id, code into v_sop, v_code;
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (v_sop, 1, 'other.pdf', 'pdf', 'sop-test/other.pdf', 1, other_author);
  assert v_code = 'SOP-001', 'Other''s first SOP is SOP-001, got ' || v_code;
  assert (select organization_id from public.sops where id = v_sop) = other;
  assert exists (select 1 from public.sops where code = 'SOP-001' and organization_id = medcare) or med_last < 1, 'MedCare can have one too';
  -- Within one organization codes stay unique.
  insert into public.sops (title, department_id, author_id, current_version)
  values ('Sop Med Second', 'pharmacovigilance', med_author, 1) returning id, code into v_sop, v_code;
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  values (v_sop, 1, 'second.pdf', 'pdf', 'sop-test/second.pdf', 1, med_author);
  assert v_code = 'SOP-' || lpad((med_last + 1)::text, 3, '0'), 'MedCare''s next number, got ' || v_code;
  perform pg_temp.expect_error(format('update public.sops set code = %L where id = %L',
    (select code from public.sops where id = med_sop), v_sop), '23505');
  v_sop := (select id from public.sops where organization_id = other);

  -- ---------- Seeing: only one's own organization's SOPs ----------
  perform pg_temp.act_as(other_author);
  assert not public.can_view_sop(med_sop), 'a published MedCare SOP isn''t visible in Other (even with a same-named department)';
  assert not public.can_view_version(med_sop, 1);
  assert not public.can_read_sop_file('sop-test/med.pdf'), 'nor its file';
  assert public.can_view_sop(v_sop), 'their own SOP is';
  perform pg_temp.act_as(other_admin);
  assert not public.admin_can_read_published_sop(med_sop), 'Other''s Admin doesn''t read MedCare''s published SOPs';
  assert not public.admin_can_read_published_sop_file('sop-test/med.pdf');
  perform pg_temp.act_as(med_admin);
  assert public.admin_can_read_published_sop(med_sop), 'MedCare''s Admin still does';
  assert public.admin_can_read_published_sop_file('sop-test/med.pdf');
  perform pg_temp.act_as(med_author);
  assert not public.can_view_sop(v_sop), 'nor MedCare Other''s';

  -- ---------- Changing and deleting another organization's SOP: "not found" / refused like an unknown one ----------
  perform pg_temp.act_as(other_author);
  perform pg_temp.expect_error(format('select public.update_sop_details(%L, %L, %L)', med_sop, 'Taken', ''), '42501');
  perform pg_temp.expect_error(format('select public.add_co_authors(%L, %L)', med_sop, array[other_author]), '42501');
  -- delete-sop (service role, the verified actor).
  perform pg_temp.act_as(null, 'service_role');
  perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', other_author, med_sop, 'Taken'), 'P0002');
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', other_author, med_sop), 'P0002');
  perform pg_temp.as_owner();
  assert (select title = 'Sop Med Published' and deleted_at is null from public.sops where id = med_sop), 'MedCare''s SOP untouched';
end;
$$;

rollback;
