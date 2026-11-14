-- Tests for 20261113150000_organization_profile.sql: who can read and save the Organization Profile, the
-- checks on its six values, and that each value is saved on its own (a new name changes nothing else).
-- The checks are as changed by 20261115120000_request_organization_details.sql.
-- Every call is made as the API would make it (role anon or authenticated, with the caller's id in the JWT
-- claims). Only for a disposable LOCAL database with every migration applied; never the shared project.
-- Everything is rolled back.
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
-- save_organization_profile with one value replaced (by its position, 1 to 6).
create function pg_temp.save_with(p_index integer, p_value text) returns text
language sql as $$
  select format('select public.save_organization_profile(%L, %L, %L, %L, %L, %L)',
    case when p_index = 1 then p_value else 'Riyadh Pharma' end,
    case when p_index = 2 then p_value else 'info@riyadh-pharma.test' end,
    case when p_index = 3 then p_value else 'Makes medicines.' end,
    case when p_index = 4 then p_value else 'King Fahd Road, Riyadh' end,
    case when p_index = 5 then p_value else 'https://maps.google.com/?q=riyadh' end,
    case when p_index = 6 then p_value else 'https://riyadh-pharma.test' end)
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(), pg_temp.save_with(integer, text) to public;

-- 1 the Super Admin, 2 a regular Admin, 3 staff.
insert into auth.users (id) select ('9a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 3) n;
insert into public.departments (id, name, initials) values ('op-home', 'OP Home', 'OH');
insert into public.profiles (id, full_name, email, initials, department_id, "position")
select ('9a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'OP Person ' || n, 'op-' || n || '@test.invalid', 'OP',
  case when n = 3 then 'op-home' end, case when n = 3 then 'Officer' end
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role) values
  ('9a000000-0000-4000-8000-000000000001', 'admin'), ('9a000000-0000-4000-8000-000000000002', 'admin'),
  ('9a000000-0000-4000-8000-000000000003', 'author');
alter table public.organizations disable trigger user;
update public.organizations set super_admin_id = null, super_admin_assigned_at = null;
update public.organizations set super_admin_id = '9a000000-0000-4000-8000-000000000001', super_admin_assigned_at = now();
alter table public.organizations enable trigger user;
-- An organization whose name was saved before the profile existed (one organization: MedCare's row,
-- 20261116140000_organization_settings_per_organization.sql).
update public.organizations set name = 'Old Name', email = null, description = null, address = null, maps_url = null, website = null;

do $$
declare
  super constant uuid := '9a000000-0000-4000-8000-000000000001';
  admin constant uuid := '9a000000-0000-4000-8000-000000000002';
  staff constant uuid := '9a000000-0000-4000-8000-000000000003';
  v_profile jsonb;
  i integer;
begin
  -- ---------- Grants ----------
  assert has_function_privilege('authenticated', 'public.get_organization_profile()', 'execute');
  assert not has_function_privilege('anon', 'public.get_organization_profile()', 'execute');
  assert not has_function_privilege('anon', 'public.save_organization_profile(text, text, text, text, text, text)', 'execute');
  assert not has_table_privilege('authenticated', 'public.organizations', 'select'), 'Read only through the function';

  -- ---------- Reading: active Admins only; the saved name is kept, the new values are not set ----------
  perform pg_temp.act_as(staff);
  perform pg_temp.expect_error('select public.get_organization_profile()', '42501');
  perform pg_temp.act_as(admin);
  v_profile := public.get_organization_profile();
  assert v_profile->>'name' = 'Old Name', 'Existing name kept';
  assert v_profile->'email' = 'null'::jsonb and v_profile->'description' = 'null'::jsonb and v_profile->'address' = 'null'::jsonb
    and v_profile->'mapsUrl' = 'null'::jsonb and v_profile->'website' = 'null'::jsonb, 'Nothing invented or copied';

  -- ---------- Saving: the Super Admin only ----------
  perform pg_temp.expect_error(pg_temp.save_with(0, ''), '42501', 'super-admin-required');
  perform pg_temp.act_as(staff);
  perform pg_temp.expect_error(pg_temp.save_with(0, ''), '42501', 'super-admin-required');

  -- ---------- Name, email and description are required; every value is checked ----------
  -- (Since 20261115120000_request_organization_details.sql: Website is optional, one of Address or Google
  -- Maps link is enough, and links start with https://.)
  perform pg_temp.act_as(super);
  for i in 1..3 loop
    perform pg_temp.expect_error(pg_temp.save_with(i, '   '), '22023');
  end loop;
  perform pg_temp.expect_error(format('select public.save_organization_profile(%L, %L, %L, %L, %L, %L)',
    'Riyadh Pharma', 'info@riyadh-pharma.test', 'Makes medicines.', '  ', '  ', 'https://riyadh-pharma.test'), '22023', 'address-or-maps-url');
  perform pg_temp.expect_error(pg_temp.save_with(2, 'not-an-email'), '22023', 'email');
  perform pg_temp.expect_error(pg_temp.save_with(5, 'maps.google.com'), '22023', 'maps-url');
  perform pg_temp.expect_error(pg_temp.save_with(5, 'https://maps google.com'), '22023', 'maps-url');
  perform pg_temp.expect_error(pg_temp.save_with(5, 'http://maps.google.com/?q=riyadh'), '22023', 'maps-url');
  perform pg_temp.expect_error(pg_temp.save_with(6, 'ftp://example.test'), '22023', 'website');
  perform pg_temp.expect_error(pg_temp.save_with(6, 'http://riyadh-pharma.test'), '22023', 'website');
  perform pg_temp.expect_error(pg_temp.save_with(1, repeat('n', 201)), '22023', 'name');
  perform pg_temp.expect_error(pg_temp.save_with(3, repeat('d', 1001)), '22023', 'description');
  perform pg_temp.expect_error(pg_temp.save_with(4, 'Line one' || chr(10) || 'line two'), '22023', 'address');
  perform pg_temp.as_owner();
  assert (select name = 'Old Name' and email is null from public.organizations), 'Refused saves change nothing';

  -- ---------- A save stores each value in its own column, trimmed ----------
  perform pg_temp.act_as(super);
  v_profile := public.save_organization_profile('  Riyadh Pharma ', ' info@riyadh-pharma.test ', ' Makes medicines. ',
    ' King Fahd Road, Riyadh ', ' https://maps.google.com/?q=riyadh ', ' https://riyadh-pharma.test ');
  assert v_profile - 'updatedAt' = jsonb_build_object('name', 'Riyadh Pharma', 'email', 'info@riyadh-pharma.test',
    'description', 'Makes medicines.', 'address', 'King Fahd Road, Riyadh', 'mapsUrl', 'https://maps.google.com/?q=riyadh',
    'website', 'https://riyadh-pharma.test'), 'Returned as stored';
  assert public.get_organization_name() = 'Riyadh Pharma', 'The top bar shows the new name';

  -- ---------- A new name changes nothing else ----------
  v_profile := public.save_organization_profile('Riyadh Pharma Group', 'info@riyadh-pharma.test', 'Makes medicines.',
    'King Fahd Road, Riyadh', 'https://maps.google.com/?q=riyadh', 'https://riyadh-pharma.test');
  assert v_profile->>'name' = 'Riyadh Pharma Group' and v_profile->>'email' = 'info@riyadh-pharma.test'
    and v_profile->>'address' = 'King Fahd Road, Riyadh' and v_profile->>'mapsUrl' = 'https://maps.google.com/?q=riyadh'
    and v_profile->>'website' = 'https://riyadh-pharma.test' and v_profile->>'description' = 'Makes medicines.', 'Only the name changed';
  perform pg_temp.as_owner();
  assert exists (select 1 from public.organization_management_audit where action = 'save-organization-profile'
    and actor_id = super and details->'fields' = '["name"]'::jsonb), 'Audited with the changed field only';
  assert (select updated_by from public.organizations) = super, 'Who saved it';
  -- A regular Admin reads what was saved.
  perform pg_temp.act_as(admin);
  assert public.get_organization_profile()->>'address' = 'King Fahd Road, Riyadh';

  -- ---------- Optional values: an empty Website, Address or Google Maps link is stored as null ----------
  perform pg_temp.act_as(super);
  v_profile := public.save_organization_profile('Riyadh Pharma Group', 'info@riyadh-pharma.test', 'Makes medicines.',
    '  ', 'https://maps.google.com/?q=riyadh', '  ');
  assert v_profile->'address' = 'null'::jsonb and v_profile->'website' = 'null'::jsonb
    and v_profile->>'mapsUrl' = 'https://maps.google.com/?q=riyadh', 'Only the Google Maps link';
  v_profile := public.save_organization_profile('Riyadh Pharma Group', 'info@riyadh-pharma.test', 'Makes medicines.',
    'King Fahd Road, Riyadh', '', '');
  assert v_profile->>'address' = 'King Fahd Road, Riyadh' and v_profile->'mapsUrl' = 'null'::jsonb, 'Only the address';
end;
$$;

rollback;
