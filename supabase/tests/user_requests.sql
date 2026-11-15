-- Tests for 20261120140000_user_requests.sql: Regulatory Guideline Addition requests saved in the database.
-- Who can send, read, cancel and decide them; the organization always comes from the requester; another
-- organization's requests can't be read, counted, cancelled or decided; approving records the decision only.
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text, p_hint text default null) returns void
language plpgsql as $$
declare v_state text; v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    assert v_state = p_state, format('Expected %s from %s, got %s (%s)', p_state, p_sql, v_state, sqlerrm);
    assert p_hint is null or v_hint = p_hint, format('Expected hint %s from %s, got %s', p_hint, p_sql, v_hint);
    return;
  end;
  assert false, 'Expected ' || p_state || ' from ' || p_sql;
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
-- How many requests the user can read (through the API's table access).
create function pg_temp.visible(p_user uuid) returns bigint
language plpgsql as $$
declare n bigint;
begin
  perform pg_temp.act_as(p_user);
  select count(*) into n from public.user_requests;
  perform pg_temp.as_owner();
  return n;
end;
$$;
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner(), pg_temp.visible(uuid) to public;

-- MedCare (A): an Admin, two authors. A second organization (B): its Admin (from Request Hawkim) and an author.
insert into auth.users (id, email, aud, role)
select ('9a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'ur-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position") values
  ('9a000000-0000-4000-8000-000000000001', 'UR A Admin', 'ur-1@test.invalid', 'UA', null, '+966500000021', null),
  ('9a000000-0000-4000-8000-000000000002', 'UR A Author', 'ur-2@test.invalid', 'UB', 'pharmacovigilance', '+966500000022', 'Officer'),
  ('9a000000-0000-4000-8000-000000000003', 'UR A Other', 'ur-3@test.invalid', 'UC', 'pharmacovigilance', '+966500000023', 'Officer');
insert into public.user_roles (user_id, role) values
  ('9a000000-0000-4000-8000-000000000001', 'admin'), ('9a000000-0000-4000-8000-000000000002', 'author'),
  ('9a000000-0000-4000-8000-000000000003', 'author');
insert into public.access_requests (id, organization, contact_name, email, phone, approx_users, review_token_hash, review_expires_at)
values ('9a000000-0000-4000-8000-0000000000a1', 'UR B Pharma', 'UR B Admin', 'ur-4@test.invalid', '+966500000024', 10, repeat('4', 64), now() + interval '1 day');
select pg_temp.act_as(null, 'service_role');
select public.accept_access_request('9a000000-0000-4000-8000-0000000000a1', repeat('4', 64), '9a000000-0000-4000-8000-000000000004', null);
select pg_temp.as_owner();
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
select '9a000000-0000-4000-8000-000000000005', 'UR B Author', 'ur-5@test.invalid', 'UE', d.id, '+966500000025', 'Officer', d.organization_id
from public.departments d join public.profiles a on a.organization_id = d.organization_id
where a.id = '9a000000-0000-4000-8000-000000000004' and d.system_key = 'pharmacovigilance';
insert into public.user_roles (user_id, role) values ('9a000000-0000-4000-8000-000000000005', 'author');

do $$
declare
  a_admin constant uuid := '9a000000-0000-4000-8000-000000000001';
  a_author constant uuid := '9a000000-0000-4000-8000-000000000002';
  a_other constant uuid := '9a000000-0000-4000-8000-000000000003';
  b_admin constant uuid := '9a000000-0000-4000-8000-000000000004';
  b_author constant uuid := '9a000000-0000-4000-8000-000000000005';
  medcare uuid := (select organization_id from public.profiles where id = '9a000000-0000-4000-8000-000000000001');
  b_org uuid := (select organization_id from public.profiles where id = '9a000000-0000-4000-8000-000000000004');
  v_request uuid; v_second uuid; v_third uuid; v_b_request uuid; v_row public.user_requests;
  guidelines_before text := (select count(*) || '/' || (select count(*) from public.guideline_version_drafts) || '/' ||
    (select count(*) from public.guideline_requirements) from public.guideline_versions);
begin
  -- ---------- Grants: read through RLS only, write through the three functions only ----------
  assert has_table_privilege('authenticated', 'public.user_requests', 'select');
  assert not has_table_privilege('authenticated', 'public.user_requests', 'insert')
    and not has_table_privilege('authenticated', 'public.user_requests', 'update')
    and not has_table_privilege('authenticated', 'public.user_requests', 'delete'), 'no direct writes';
  assert not has_table_privilege('anon', 'public.user_requests', 'select'), 'anon reads nothing';
  assert not has_function_privilege('anon', 'public.submit_user_request(text,text,text)', 'execute');
  assert not has_function_privilege('anon', 'public.cancel_user_request(uuid)', 'execute');
  assert not has_function_privilege('anon', 'public.decide_user_request(uuid,text)', 'execute');
  assert (select relrowsecurity from pg_class where oid = 'public.user_requests'::regclass), 'row level security is on';

  -- ---------- Sending: the caller is the requester, the organization is theirs ----------
  perform pg_temp.act_as(a_author);
  v_request := public.submit_user_request('regulatory-guideline-addition', '  Request to Add a Regulatory Guideline ', ' No guideline yet. ');
  perform pg_temp.expect_error($q$select public.submit_user_request('regulatory-guideline-addition', '   ', 'x')$q$, '23514', 'title');
  perform pg_temp.expect_error(format('select public.submit_user_request(%L, %L, %L)', 'regulatory-guideline-addition', repeat('t', 101), 'x'), '23514', 'title');
  perform pg_temp.expect_error($q$select public.submit_user_request('regulatory-guideline-addition', 'T', '  ')$q$, '23514', 'description');
  perform pg_temp.expect_error(format('select public.submit_user_request(%L, %L, %L)', 'regulatory-guideline-addition', 'T', repeat('d', 1001)), '23514', 'description');
  perform pg_temp.expect_error($q$select public.submit_user_request('department-access', 'T', 'D')$q$, '23514', 'type');
  perform pg_temp.expect_error($q$select public.submit_user_request(null, 'T', 'D')$q$, '23514', 'type');
  -- No direct insert, not even one naming another organization.
  perform pg_temp.expect_error(format('insert into public.user_requests (type, title, description, requester_id, organization_id) values (%L, %L, %L, %L, %L)',
    'regulatory-guideline-addition', 'T', 'D', a_author, b_org), '42501');
  perform pg_temp.as_owner();
  select * into v_row from public.user_requests where id = v_request;
  assert v_row.requester_id = a_author and v_row.organization_id = medcare and v_row.status = 'pending', 'saved as the requester''s';
  assert v_row.title = 'Request to Add a Regulatory Guideline' and v_row.description = 'No guideline yet.', 'trimmed';
  assert v_row.decided_by is null and v_row.decided_at is null and v_row.cancelled_at is null and v_row.created_at is not null;
  -- Whatever organization is sent, a row is its requester's organization's (even for the owner).
  insert into public.user_requests (id, type, title, description, requester_id, organization_id)
  values ('9a000000-0000-4000-8000-0000000000f1', 'regulatory-guideline-addition', 'T', 'D', a_author, b_org);
  assert (select organization_id from public.user_requests where id = '9a000000-0000-4000-8000-0000000000f1') = medcare, 'the requester''s organization';
  delete from public.user_requests where id = '9a000000-0000-4000-8000-0000000000f1';

  -- Signed-out callers and people without a profile can't send.
  perform pg_temp.act_as(gen_random_uuid());
  perform pg_temp.expect_error($q$select public.submit_user_request('regulatory-guideline-addition', 'T', 'D')$q$, '42501');
  perform pg_temp.as_owner();

  -- ---------- Reading: own requests; the Admin reads the organization's; nobody else ----------
  perform pg_temp.act_as(b_author);
  v_b_request := public.submit_user_request('regulatory-guideline-addition', 'UR B request', 'B needs a guideline');
  perform pg_temp.as_owner();
  assert (select organization_id from public.user_requests where id = v_b_request) = b_org, 'B''s request is B''s';
  assert pg_temp.visible(a_author) = 1, 'the requester sees theirs';
  assert pg_temp.visible(a_other) = 0, 'another author of the same organization sees none';
  assert pg_temp.visible(a_admin) = (select count(*) from public.user_requests where organization_id = medcare), 'A''s Admin sees A''s';
  assert pg_temp.visible(a_admin) >= 1;
  assert pg_temp.visible(b_admin) = 1 and pg_temp.visible(b_author) = 1, 'B sees only B''s';
  perform pg_temp.act_as(b_admin);
  assert not exists (select 1 from public.user_requests where id = v_request), 'B''s Admin can''t read A''s request';
  perform pg_temp.act_as(null, 'anon');
  perform pg_temp.expect_error('select count(*) from public.user_requests', '42501');
  perform pg_temp.as_owner();

  -- ---------- Cancelling: only the requester, only while pending ----------
  perform pg_temp.act_as(a_other);
  perform pg_temp.expect_error(format('select public.cancel_user_request(%L)', v_request), 'P0002');
  perform pg_temp.act_as(a_admin);
  perform pg_temp.expect_error(format('select public.cancel_user_request(%L)', v_request), 'P0002');
  perform pg_temp.act_as(b_author);
  perform pg_temp.expect_error(format('select public.cancel_user_request(%L)', v_request), 'P0002');
  perform pg_temp.act_as(a_author);
  perform public.cancel_user_request(v_request);
  perform pg_temp.expect_error(format('select public.cancel_user_request(%L)', v_request), 'P0001', 'not-pending');
  perform pg_temp.as_owner();
  assert (select status = 'cancelled' and cancelled_at is not null from public.user_requests where id = v_request), 'cancelled';
  -- A cancelled request can't be decided.
  perform pg_temp.act_as(a_admin);
  perform pg_temp.expect_error(format('select public.decide_user_request(%L, %L)', v_request, 'approved'), 'P0001', 'not-pending');
  perform pg_temp.as_owner();

  -- ---------- Deciding: an Admin of the same organization, once ----------
  perform pg_temp.act_as(a_author);
  v_second := public.submit_user_request('regulatory-guideline-addition', 'Second', 'Please add the GVP');
  v_third := public.submit_user_request('regulatory-guideline-addition', 'Third', 'Please add the GVP');
  perform pg_temp.expect_error(format('select public.decide_user_request(%L, %L)', v_second, 'approved'), '42501');
  perform pg_temp.act_as(b_admin);
  perform pg_temp.expect_error(format('select public.decide_user_request(%L, %L)', v_second, 'approved'), 'P0002');
  perform pg_temp.act_as(a_admin);
  perform pg_temp.expect_error(format('select public.decide_user_request(%L, %L)', v_second, 'maybe'), '23514');
  perform public.decide_user_request(v_second, 'approved');
  perform pg_temp.expect_error(format('select public.decide_user_request(%L, %L)', v_second, 'rejected'), 'P0001', 'not-pending');
  perform public.decide_user_request(v_third, 'rejected');
  perform pg_temp.as_owner();
  select * into v_row from public.user_requests where id = v_second;
  assert v_row.status = 'approved' and v_row.decided_by = a_admin and v_row.decided_at is not null, 'approved, by whom and when';
  assert (select status = 'rejected' and decided_by = a_admin from public.user_requests where id = v_third), 'rejected';
  assert exists (select 1 from public.organization_management_audit where action = 'decide-request' and entity_id = v_second::text
    and actor_id = a_admin and details->>'decision' = 'approved'), 'the decision is audited';
  -- The requester can't cancel a decided request; the decision stays.
  perform pg_temp.act_as(a_author);
  perform pg_temp.expect_error(format('select public.cancel_user_request(%L)', v_second), 'P0001', 'not-pending');
  perform pg_temp.as_owner();
  -- Approving adds no guideline.
  assert guidelines_before = (select count(*) || '/' || (select count(*) from public.guideline_version_drafts) || '/' ||
    (select count(*) from public.guideline_requirements) from public.guideline_versions), 'no guideline was added';
  assert not exists (select 1 from public.guideline_versions where organization_id = b_org), 'B still has no guideline';

  -- ---------- A request from a deleted user can be rejected, not approved ----------
  perform pg_temp.act_as(a_other);
  v_request := public.submit_user_request('regulatory-guideline-addition', 'Gone', 'Please add the GVP');
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = now() where id = a_other;
  perform pg_temp.act_as(a_admin);
  perform pg_temp.expect_error(format('select public.decide_user_request(%L, %L)', v_request, 'approved'), 'P0001', 'requester-deleted');
  perform public.decide_user_request(v_request, 'rejected');
  perform pg_temp.as_owner();
  -- The deleted user can no longer send or read.
  assert pg_temp.visible(a_other) = 0, 'a deleted user reads nothing';
  perform pg_temp.act_as(a_other);
  perform pg_temp.expect_error($q$select public.submit_user_request('regulatory-guideline-addition', 'T', 'D')$q$, '42501');
  perform pg_temp.as_owner();

  -- ---------- B's Admin decides B's request; A's are untouched ----------
  perform pg_temp.act_as(b_admin);
  perform public.decide_user_request(v_b_request, 'approved');
  perform pg_temp.as_owner();
  assert (select status from public.user_requests where id = v_b_request) = 'approved';
  assert (select count(*) from public.user_requests where organization_id = medcare and decided_by = b_admin) = 0, 'B decided nothing of A''s';
  -- A row never moves to another organization.
  perform pg_temp.expect_error(format('update public.user_requests set organization_id = %L where id = %L', medcare, v_b_request), '42501', 'organization-fixed');
end;
$$;

rollback;
