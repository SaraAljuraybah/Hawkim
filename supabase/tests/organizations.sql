-- Tests for 20261116120000_organizations.sql: the organizations table, MedCare, organization_id on every
-- table, the composite foreign keys and the trigger that sets organization_id.
-- Only for a disposable LOCAL database with every migration (and the seed) applied; never the shared
-- project. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

-- Expects the statement to fail with this SQLSTATE and, when given, this hint.
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
-- Runs with the owner's rights while the request role stays the caller's, as a SECURITY DEFINER function does.
create function pg_temp.insert_department_as_function(p_id text, p_organization uuid) returns void
language sql security definer as $$
  insert into public.departments (id, name, initials, organization_id) values (p_id, p_id, 'API', p_organization);
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(),
  pg_temp.insert_department_as_function(text, uuid) to public;

-- Fixtures: a person in MedCare and, for the cross-organization checks, a second organization "Other"
-- with its own department and person.
insert into auth.users (id, email, aud, role)
select ('96000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'org-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 3) n;

do $$
declare
  medcare uuid;
  other uuid;
  med_person constant uuid := '96000000-0000-4000-8000-000000000001';
  other_person constant uuid := '96000000-0000-4000-8000-000000000002';
  sneaky constant uuid := '96000000-0000-4000-8000-000000000003';
  t text;
  n bigint;
  v_sop uuid;
  v_org uuid;
begin
  -- ---------- MedCare ----------
  assert (select count(*) from public.organizations) = 1, 'Exactly one organization after the migration';
  select o.id into medcare from public.organizations o;
  assert (select o.name from public.organizations o) =
    coalesce((select nullif(btrim(s.name), '') from public.organization_settings s where s.singleton), 'MedCare'),
    'The saved organization name is kept; MedCare only when none was saved';
  -- The Super Admin and the SOP counter are copied again when the singletons are dropped (next
  -- migration), so they aren't compared here: the local seed assigns them after this migration.

  -- ---------- organization_id everywhere, never null, all MedCare ----------
  foreach t in array array[
    'departments', 'divisions', 'profiles', 'user_roles', 'employee_positions', 'user_invitations',
    'admin_profile_backup', 'sops', 'sop_versions', 'sop_co_authors', 'timeline_events', 'review_rounds',
    'review_requests', 'sop_comments', 'compliance_checks', 'compliance_findings', 'guideline_versions',
    'guideline_requirements', 'sample_findings', 'guideline_version_drafts', 'guideline_draft_requirements',
    'organization_management_audit', 'department_file_deletions', 'department_file_deletion_items',
    'ampersand_name_changes'
  ] loop
    assert exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t)::regclass and g.tgname = 'a0_organization'
      and not g.tgisinternal), t || ' sets organization_id in the database';
    assert exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t
      and c.column_name = 'organization_id' and c.is_nullable = 'NO' and c.column_default is null),
      t || ' has organization_id not null, with no default';
    execute format('select count(*) from public.%I where organization_id is distinct from %L', t, medcare) into n;
    assert n = 0, t || ': every existing row is MedCare''s';
  end loop;
  assert exists (select 1 from information_schema.columns c where c.table_schema = 'public'
    and c.table_name = 'access_requests' and c.column_name = 'organization_id' and c.is_nullable = 'YES');
  assert not exists (select 1 from public.access_requests r where r.status = 'accepted' and r.organization_id is null),
    'Accepted requests belong to MedCare';
  assert not exists (select 1 from public.access_requests r where r.status <> 'accepted' and r.organization_id is not null),
    'Pending and rejected requests belong to no organization';

  -- ---------- One composite foreign key per link, under its old name (the API's embeds rely on it) ----------
  assert (select count(*) from pg_constraint where conrelid = 'public.user_roles'::regclass and contype = 'f'
    and confrelid = 'public.profiles'::regclass) = 1, 'user_roles → profiles: one relationship (profiles?select=user_roles(role))';
  assert (select count(*) from pg_constraint where conrelid = 'public.departments'::regclass and contype = 'f'
    and confrelid = 'public.divisions'::regclass) = 1, 'departments → divisions: one relationship';
  assert (select pg_get_constraintdef(oid) ~ '^FOREIGN KEY \(organization_id, sop_id\) REFERENCES (public\.)?sops\(organization_id, id\)$'
    from pg_constraint where conname = 'sop_versions_sop_id_fkey'), 'sop_versions_sop_id_fkey keeps its name and is composite';
  assert (select pg_get_constraintdef(oid) ~ 'ON DELETE CASCADE'
    from pg_constraint where conname = 'user_roles_user_id_fkey'), 'the delete rule is kept';
  assert not exists (
    select 1 from pg_constraint c
    where c.connamespace = 'public'::regnamespace and c.contype = 'f' and c.confrelid in (
      'public.profiles'::regclass, 'public.departments'::regclass, 'public.sops'::regclass, 'public.compliance_checks'::regclass,
      'public.guideline_versions'::regclass, 'public.guideline_requirements'::regclass, 'public.review_rounds'::regclass)
      and array_length(c.conkey, 1) = 1
      and c.conrelid <> 'public.organizations'::regclass
      -- the singleton the next migration drops
      and c.conrelid <> 'public.super_admin'::regclass
      -- set null links (who sent an invitation, who saved the name) stay single-column
      and pg_get_constraintdef(c.oid) !~* 'set null'),
    'No single-column link to an organization''s rows is left';

  -- ---------- Grants ----------
  -- Embeds join on organization_id: a signed-in user can read it wherever they can read the rows.
  assert has_column_privilege('authenticated', 'public.departments', 'organization_id', 'select'), 'departments.organization_id readable';
  assert has_column_privilege('authenticated', 'public.divisions', 'organization_id', 'select'), 'divisions.organization_id readable';
  assert not has_column_privilege('authenticated', 'public.divisions', 'email', 'select'), 'divisions.email stays private';
  assert not has_table_privilege('authenticated', 'public.organizations', 'select'), 'organizations is not readable directly';
  assert not has_table_privilege('anon', 'public.organizations', 'select');
  assert not has_table_privilege('service_role', 'public.organizations', 'update');
  assert has_function_privilege('authenticated', 'public.current_organization_id()', 'execute');
  assert not has_function_privilege('anon', 'public.current_organization_id()', 'execute');
  assert not has_function_privilege('authenticated', 'public.only_organization_id()', 'execute');
  assert not has_function_privilege('authenticated', 'public.set_row_organization()', 'execute');

  -- ---------- The trigger: rows that start an organization's data ----------
  -- The owner, with one organization: MedCare (transitional).
  insert into public.departments (id, name, initials) values ('org-test-med', 'Org Test Med', 'OTM');
  assert (select organization_id from public.departments where id = 'org-test-med') = medcare;
  insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
  values (med_person, 'Med Person', 'org-1@test.invalid', 'MP', 'org-test-med', '+966512345671', 'Tester');
  insert into public.user_roles (user_id, role) values (med_person, 'author');
  assert public.only_organization_id() = medcare;

  -- A second organization: the owner must now say which one.
  insert into public.organizations (name) values ('Other') returning id into other;
  assert public.only_organization_id() is null, 'With two organizations there is no default';
  perform pg_temp.expect_error($q$insert into public.departments (id, name, initials) values ('org-test-none', 'No Org', 'NO')$q$,
    '23502', 'organization-required');
  insert into public.departments (id, name, initials, organization_id) values ('org-test-other', 'Org Test Other', 'OTO', other);
  insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
  values (other_person, 'Other Person', 'org-2@test.invalid', 'OP', 'org-test-other', '+966512345672', 'Tester', other);
  insert into public.user_roles (user_id, role) values (other_person, 'author');

  -- ---------- current_organization_id ----------
  perform pg_temp.act_as(med_person);
  assert public.current_organization_id() = medcare;
  perform pg_temp.act_as(other_person);
  assert public.current_organization_id() = other;
  perform pg_temp.act_as(null);
  assert public.current_organization_id() is null, 'Not signed in: no organization';
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = now() where id = other_person;
  perform pg_temp.act_as(other_person);
  assert public.current_organization_id() is null, 'A deleted profile has no organization';
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = null where id = other_person;

  -- ---------- The trigger: rows that belong to another row take its organization ----------
  -- The value sent is ignored: the role takes its person's organization.
  insert into public.user_roles (user_id, role, organization_id) values (med_person, 'reviewer', other);
  assert (select organization_id from public.user_roles where user_id = med_person and role = 'reviewer') = medcare,
    'A role always takes its person''s organization';
  -- The audit row takes its actor's organization.
  insert into public.organization_management_audit (actor_id, action, entity_id) values (other_person, 'org-test', 'x');
  assert (select organization_id from public.organization_management_audit where action = 'org-test') = other;
  -- An unknown parent is refused like a foreign key.
  perform pg_temp.expect_error(format('insert into public.user_roles (user_id, role) values (%L, %L)', sneaky, 'author'), '23503');

  -- ---------- A signed-in API caller always gets their own organization ----------
  -- The API has no insert grants: this is what a SECURITY DEFINER function running for them inserts.
  -- Whatever organization it sends, the row gets the caller's.
  perform pg_temp.act_as(other_person);
  perform pg_temp.insert_department_as_function('org-test-api', medcare);
  perform pg_temp.as_owner();
  assert (select organization_id from public.departments where id = 'org-test-api') = other,
    'An API caller''s row is always in their own organization';
  -- A caller without an organization can't create anything.
  perform pg_temp.act_as(sneaky);
  perform pg_temp.expect_error($q$select pg_temp.insert_department_as_function('org-test-api-2', null)$q$,
    '23502', 'organization-required');
  perform pg_temp.as_owner();

  -- ---------- Rows can't point to another organization's rows ----------
  -- An SOP in Other's department, by MedCare's author: refused by the composite foreign key.
  perform pg_temp.expect_error(format(
    'insert into public.sops (title, department_id, author_id, current_version) values (%L, %L, %L, 1)',
    'Cross', 'org-test-other', med_person), '23503');
  -- A MedCare person can't be moved into Other's department.
  perform pg_temp.expect_error(format('update public.profiles set department_id = %L where id = %L', 'org-test-other', med_person),
    '23503');
  -- A MedCare department can't be put in Other's division.
  insert into public.divisions (id, name, organization_id) values ('org-test-other-division', 'Other Division', other);
  perform pg_temp.expect_error(format('update public.departments set division_id = %L where id = %L',
    'org-test-other-division', 'org-test-med'), '23503');
  -- The Super Admin of Other can't be a MedCare person.
  perform pg_temp.expect_error(format('update public.organizations set super_admin_id = %L where id = %L', med_person, other),
    '23503');
  update public.organizations set super_admin_id = other_person where id = other;

  -- ---------- organization_id never changes ----------
  perform pg_temp.expect_error(format('update public.profiles set organization_id = %L where id = %L', other, med_person),
    '42501', 'organization-fixed');
  perform pg_temp.expect_error(format('update public.departments set organization_id = %L where id = %L', medcare, 'org-test-other'),
    '42501', 'organization-fixed');
  perform pg_temp.expect_error(format('update public.user_roles set organization_id = %L where user_id = %L', other, med_person),
    '42501', 'organization-fixed');
end;
$$;

rollback;
