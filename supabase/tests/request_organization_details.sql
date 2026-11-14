-- Tests for 20261115120000_request_organization_details.sql: Request Hawkim's organization details
-- (submit_access_request's rules, get_access_request), and accept_access_request filling only the empty
-- parts of the Organization Profile without ever failing because of it. The Organization Profile's new
-- rules are in organization_profile.sql.
-- Calls are made as the access-requests Edge Function makes them (role service_role).
-- Only for a disposable LOCAL database with every migration applied; never the shared project.
-- Everything is rolled back.
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
-- submit_access_request with the organization's details replaced (null keeps the valid default).
create function pg_temp.submit_sql(p_organization text, p_email text, p_org_email text, p_address text, p_maps_url text,
  p_website text, p_description text) returns text
language sql as $$
  select format('select public.submit_access_request(%L, %L, null, %L, %L, 10, null, %L, %L, %L, %L, %L, %L)',
    p_organization, 'Request Person', p_email, '+966500000000', repeat('a', 64),
    p_org_email, p_address, p_maps_url, p_website, p_description)
$$;
-- A pending request stored directly (as the owner), with any organization name and details.
create function pg_temp.add_request(p_id uuid, p_organization text, p_email text, p_org_email text, p_address text,
  p_maps_url text, p_website text, p_description text) returns void
language sql as $$
  insert into public.access_requests (id, organization, contact_name, email, phone, approx_users, review_token_hash, review_expires_at,
    organization_email, organization_address, organization_maps_url, organization_website, organization_description)
  values (p_id, p_organization, 'Request Person', p_email, '+966500000000', 10, repeat('c', 64), now() + interval '1 day',
    p_org_email, p_address, p_maps_url, p_website, p_description)
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(),
  pg_temp.submit_sql(text, text, text, text, text, text, text) to public;

-- A new deployment: no Super Admin, no active Admin, nothing saved in the Organization Profile but its
-- name (since 20261116140000 every organization has a name: here MedCare's row). Rolled back.
alter table public.organizations disable trigger user;
update public.organizations set super_admin_id = null, super_admin_assigned_at = null;
alter table public.organizations enable trigger user;
update public.profiles p set deleted_at = now()
where p.deleted_at is null and exists (select 1 from public.user_roles r where r.user_id = p.id and r.role = 'admin');
update public.organizations set name = 'MedCare', email = null, description = null, address = null, maps_url = null,
  website = null, updated_by = null;
insert into auth.users (id, email, aud, role)
select ('9b000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'rd-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 6) n;

do $$
declare
  v_id uuid;
  v_row record;
  v_settings public.organizations;
begin
  -- ---------- Grants and definitions ----------
  assert has_function_privilege('service_role', 'public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text)', 'execute');
  assert not has_function_privilege('anon', 'public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text)', 'execute');
  assert to_regprocedure('public.submit_access_request(text, text, text, text, text, integer, text, text)') is null, 'the 8-parameter version is gone';
  assert has_function_privilege('service_role', 'public.get_access_request(uuid, text)', 'execute');
  assert not has_function_privilege('anon', 'public.get_access_request(uuid, text)', 'execute');
  assert not has_function_privilege('authenticated', 'public.accept_access_request(uuid, text, uuid, text)', 'execute');
  assert (select p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole
          from pg_proc p where p.oid = 'public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text)'::regprocedure);

  -- ---------- submit_access_request: the Organization Profile's rules ----------
  perform pg_temp.act_as(null, 'service_role');
  v_id := public.submit_access_request(' RD Full Pharma ', 'Request Person', null, 'rd-full@test.invalid', '+966500000000', 10, null, repeat('a', 64),
    ' info@rd.test ', ' King Fahd Road, Riyadh ', ' https://maps.google.com/?q=riyadh ', ' https://rd.test ', ' Makes medicines. ');
  select * into v_row from public.get_access_request(v_id, repeat('a', 64));
  assert v_row.organization_email = 'info@rd.test' and v_row.organization_address = 'King Fahd Road, Riyadh'
    and v_row.organization_maps_url = 'https://maps.google.com/?q=riyadh' and v_row.organization_website = 'https://rd.test'
    and v_row.organization_description = 'Makes medicines.', 'stored trimmed and returned by get_access_request';

  -- Only an address, no website: the others are null. Only a Google Maps link is enough too.
  v_id := public.submit_access_request('RD Address Pharma', 'Request Person', null, 'rd-address@test.invalid', '+966500000000', 10, null, repeat('a', 64),
    'info@rd.test', 'King Fahd Road, Riyadh', '  ', '', 'Makes medicines.');
  assert (select organization_maps_url is null and organization_website is null from public.access_requests where id = v_id), 'blank: null';
  perform public.submit_access_request('RD Maps Pharma', 'Request Person', null, 'rd-maps@test.invalid', '+966500000000', 10, null, repeat('a', 64),
    'info@rd.test', null, 'https://maps.google.com/?q=riyadh', null, 'Makes medicines.');

  perform pg_temp.expect_error(pg_temp.submit_sql('RD E1', 'rd-e1@test.invalid', '  ', 'Riyadh', null, null, 'D'), 'P0001', 'organization-email');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E2', 'rd-e2@test.invalid', 'not-an-email', 'Riyadh', null, null, 'D'), 'P0001', 'organization-email');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E3', 'rd-e3@test.invalid', repeat('e', 250) || '@x.io', 'Riyadh', null, null, 'D'), 'P0001', 'organization-email');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E4', 'rd-e4@test.invalid', 'info@rd.test', 'Riyadh', null, null, null), 'P0001', 'organization-description');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E5', 'rd-e5@test.invalid', 'info@rd.test', 'Riyadh', null, null, repeat('d', 1001)), 'P0001', 'organization-description');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E6', 'rd-e6@test.invalid', 'info@rd.test', ' ', '', null, 'D'), 'P0001', 'organization-address-or-maps-url');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E7', 'rd-e7@test.invalid', 'info@rd.test', repeat('a', 301), null, null, 'D'), 'P0001', 'organization-address');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E8', 'rd-e8@test.invalid', 'info@rd.test', 'Line one' || chr(10) || 'two', null, null, 'D'), 'P0001', 'organization-address');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E9', 'rd-e9@test.invalid', 'info@rd.test', null, 'http://maps.google.com', null, 'D'), 'P0001', 'organization-maps-url');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E10', 'rd-e10@test.invalid', 'info@rd.test', null, 'https://' || repeat('m', 2040) || '.com', null, 'D'), 'P0001', 'organization-maps-url');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E11', 'rd-e11@test.invalid', 'info@rd.test', 'Riyadh', null, 'http://rd.test', 'D'), 'P0001', 'organization-website');
  perform pg_temp.expect_error(pg_temp.submit_sql('RD E12', 'rd-e12@test.invalid', 'info@rd.test', 'Riyadh', null, 'https://rd test', 'D'), 'P0001', 'organization-website');
  perform pg_temp.as_owner();
  assert not exists (select 1 from public.access_requests where organization like 'RD E%'), 'refused requests are not stored';
  -- The columns refuse http:// too (a write that skips the function).
  perform pg_temp.expect_error($q$select pg_temp.add_request(gen_random_uuid(), 'RD Col', 'rd-col@test.invalid', null, null, 'http://rd.test', null, null)$q$, '23514');

  -- ---------- accept_access_request: fills only the empty parts of the profile ----------
  -- Each case runs on its own and is undone (the deployment is new again for the next one).

  -- 1. Nothing saved but the organization's name: every detail is copied; the name is kept.
  perform pg_temp.add_request('9b000000-0000-4000-8000-0000000000a1', 'RD One Pharma', 'rd-1@test.invalid',
    'info@one.test', 'King Fahd Road, Riyadh', 'https://maps.google.com/?q=one', 'https://one.test', 'Makes medicines.');
  begin
    perform pg_temp.act_as(null, 'service_role');
    perform public.accept_access_request('9b000000-0000-4000-8000-0000000000a1', repeat('c', 64), '9b000000-0000-4000-8000-000000000001', 'unused');
    perform pg_temp.as_owner();
    select * into v_settings from public.organizations;
    assert v_settings.name = 'MedCare' and v_settings.email = 'info@one.test' and v_settings.description = 'Makes medicines.'
      and v_settings.address = 'King Fahd Road, Riyadh' and v_settings.maps_url = 'https://maps.google.com/?q=one'
      and v_settings.website = 'https://one.test' and v_settings.updated_by is null, 'everything copied';
    assert (select status = 'accepted' and organization_id = v_settings.id from public.access_requests
            where id = '9b000000-0000-4000-8000-0000000000a1'), 'accepted, in the organization';
    assert v_settings.super_admin_id = '9b000000-0000-4000-8000-000000000001', 'the applicant is its Super Admin';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;

  -- 2. A saved name and email: kept; only the empty values are filled.
  begin
    update public.organizations set name = 'Saved Name', email = 'saved@org.test';
    perform pg_temp.act_as(null, 'service_role');
    perform public.accept_access_request('9b000000-0000-4000-8000-0000000000a1', repeat('c', 64), '9b000000-0000-4000-8000-000000000001', 'unused');
    perform pg_temp.as_owner();
    select * into v_settings from public.organizations;
    assert v_settings.name = 'Saved Name' and v_settings.email = 'saved@org.test', 'saved values never overwritten';
    assert v_settings.description = 'Makes medicines.' and v_settings.address = 'King Fahd Road, Riyadh'
      and v_settings.maps_url = 'https://maps.google.com/?q=one' and v_settings.website = 'https://one.test', 'empty values filled';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;

  -- 3. A complete saved profile: nothing changes, not even updated_at.
  begin
    update public.organizations set name = 'Saved Name', email = 'saved@org.test', description = 'Saved.', address = 'Saved Road',
      maps_url = 'https://maps.google.com/?q=saved', website = 'https://saved.test', updated_at = '2026-01-01';
    perform pg_temp.act_as(null, 'service_role');
    perform public.accept_access_request('9b000000-0000-4000-8000-0000000000a1', repeat('c', 64), '9b000000-0000-4000-8000-000000000001', 'unused');
    perform pg_temp.as_owner();
    select * into v_settings from public.organizations;
    assert v_settings.description = 'Saved.' and v_settings.website = 'https://saved.test'
      and v_settings.updated_at = '2026-01-01', 'a complete profile is left alone';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;

  -- 4. A request name the profile would refuse (a tab in it): the name isn't used (the organization's is
  --    kept), the details are still copied and the request is accepted.
  perform pg_temp.add_request('9b000000-0000-4000-8000-0000000000a2', 'RD' || chr(9) || 'Tab Pharma', 'rd-2@test.invalid',
    'info@tab.test', 'Tab Road', null, null, 'Tabs.');
  begin
    perform pg_temp.act_as(null, 'service_role');
    perform public.accept_access_request('9b000000-0000-4000-8000-0000000000a2', repeat('c', 64), '9b000000-0000-4000-8000-000000000002', 'unused');
    perform pg_temp.as_owner();
    select * into v_settings from public.organizations;
    assert v_settings.name = 'MedCare' and v_settings.email = 'info@tab.test' and v_settings.address = 'Tab Road', 'details copied, name kept';
    assert (select status = 'accepted' from public.access_requests where id = '9b000000-0000-4000-8000-0000000000a2'), 'still accepted';
    assert (select o.super_admin_id from public.organizations o) = '9b000000-0000-4000-8000-000000000002', 'still the Super Admin';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;

  -- 5. The same refused name with a saved profile: the details are still filled in (no name needed).
  begin
    update public.organizations set name = 'Saved Name';
    perform pg_temp.act_as(null, 'service_role');
    perform public.accept_access_request('9b000000-0000-4000-8000-0000000000a2', repeat('c', 64), '9b000000-0000-4000-8000-000000000002', 'unused');
    perform pg_temp.as_owner();
    select * into v_settings from public.organizations;
    assert v_settings.name = 'Saved Name' and v_settings.email = 'info@tab.test' and v_settings.address = 'Tab Road'
      and v_settings.maps_url is null and v_settings.website is null, 'details copied, name kept';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;

  -- 6. A request sent before the form asked for the details: nothing to copy; the name is kept.
  insert into public.access_requests (id, organization, contact_name, email, phone, approx_users, review_token_hash, review_expires_at)
  values ('9b000000-0000-4000-8000-0000000000a3', 'RD Old Pharma', 'Request Person', 'rd-3@test.invalid', '+966500000000', 10, repeat('c', 64), now() + interval '1 day');
  begin
    perform pg_temp.act_as(null, 'service_role');
    perform public.accept_access_request('9b000000-0000-4000-8000-0000000000a3', repeat('c', 64), '9b000000-0000-4000-8000-000000000003', 'unused');
    perform pg_temp.as_owner();
    select * into v_settings from public.organizations;
    assert v_settings.name = 'MedCare' and v_settings.email is null and v_settings.description is null
      and v_settings.address is null and v_settings.maps_url is null and v_settings.website is null, 'nothing copied';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;

  -- 7. A profile value the column refuses (an http:// link saved before this migration, by the owner) is never
  --    touched: the copy only writes empty values, so the stored link stays and accepting works.
  begin
    update public.organizations set name = 'Saved Name', website = 'http://old.test';
    perform pg_temp.act_as(null, 'service_role');
    perform public.accept_access_request('9b000000-0000-4000-8000-0000000000a1', repeat('c', 64), '9b000000-0000-4000-8000-000000000001', 'unused');
    perform pg_temp.as_owner();
    select * into v_settings from public.organizations;
    assert v_settings.website = 'http://old.test' and v_settings.email = 'info@one.test', 'old link kept, the rest filled';
    raise exception 'undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
end;
$$;

rollback;
