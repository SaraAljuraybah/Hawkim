-- Tests for 20261110150000_unique_access_request_organization.sql. Only for a disposable LOCAL database
-- with every migration applied; never the shared project. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

-- Expects p_sql to fail with this SQLSTATE and, when given, this message.
create function pg_temp.expect_error(p_sql text, p_state text, p_message text default null) returns void
language plpgsql as $$
declare v_rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_state or (p_message is not null and sqlerrm <> p_message) then raise; end if;
    v_rejected := true;
  end;
  assert v_rejected, 'Expected ' || p_state || coalesce(' ' || p_message, '') || ' from ' || p_sql;
end;
$$;
-- A request through the function, as the access-requests Edge Function sends it (token hash 'a'…).
create function pg_temp.submit(p_organization text, p_email text) returns uuid language sql as $$
  select public.submit_access_request(p_organization, 'Request Person', 'Quality Lead', p_email, '+966500000000', 10, null, repeat('a', 64), 'info@organization.test', 'King Fahd Road, Riyadh', null, null, 'A test organization.');
$$;
create function pg_temp.taken(p_organization text, p_email text) returns void language plpgsql as $$
begin
  perform pg_temp.expect_error(format('select pg_temp.submit(%L, %L)', p_organization, p_email), 'P0001', 'organization_taken');
end;
$$;

-- Requests from before this migration, stored directly (the live table already has these kinds of rows):
-- "UO Old Dup" twice (pending and accepted), one accepted and one rejected name.
insert into public.access_requests (organization, contact_name, job_title, email, phone, approx_users, status, review_token_hash, review_expires_at, created_at)
values
  ('UO Old Dup', 'Old Person', 'Lead', 'old-1@test.invalid', '+966500000000', 5, 'pending', repeat('b', 64), now() + interval '14 days', '2026-11-01 10:00+00'),
  ('uo  old dup', 'Old Person', 'Lead', 'old-2@test.invalid', '+966500000000', 5, 'accepted', repeat('b', 64), now() + interval '14 days', '2026-11-02 10:00+00'),
  ('UO Old Accepted', 'Old Person', 'Lead', 'old-3@test.invalid', '+966500000000', 5, 'accepted', repeat('b', 64), now() + interval '14 days', '2026-11-03 10:00+00'),
  ('UO Old Rejected', 'Old Person', 'Lead', 'old-4@test.invalid', '+966500000000', 5, 'rejected', repeat('b', 64), now() + interval '14 days', '2026-11-04 10:00+00');

do $$
declare
  first uuid;
  later uuid;
  v_user uuid := 'a1000000-0000-4000-8000-000000000001';
begin
  -- Existing duplicate rows don't block the migration (it is applied) and stay as they were.
  assert (select count(*) from public.access_requests where organization in ('UO Old Dup', 'uo  old dup')) = 2, 'old duplicates kept';

  -- A new organization: stored, trimmed as before.
  first := pg_temp.submit('  Riyadh   Pharma  ', 'one@test.invalid');
  assert (select organization = 'Riyadh   Pharma' and status = 'pending' and review_expires_at > now() + interval '13 days'
          from public.access_requests where id = first), 'stored as before';

  -- The same name again, ignoring case, surrounding spaces and repeated inner spaces: refused, nothing stored.
  perform pg_temp.taken('Riyadh Pharma', 'two@test.invalid');
  perform pg_temp.taken('  RIYADH    pharma ', 'three@test.invalid');
  perform pg_temp.taken(E'riyadh\tpharma', 'four@test.invalid');
  assert (select count(*) from public.access_requests where email in ('two@test.invalid', 'three@test.invalid', 'four@test.invalid')) = 0, 'nothing stored';

  -- Against old rows too: pending and accepted names are taken; a rejected one can apply again.
  perform pg_temp.taken('uo old dup', 'five@test.invalid');
  perform pg_temp.taken('UO OLD ACCEPTED', 'six@test.invalid');
  later := pg_temp.submit('uo old rejected', 'seven@test.invalid');
  assert later is not null, 'rejected name reusable';

  -- Rejecting a pending request frees its name (reject_access_request unchanged).
  perform public.reject_access_request(first, repeat('a', 64));
  assert (select status = 'rejected' from public.access_requests where id = first), 'rejected';
  first := pg_temp.submit('riyadh pharma', 'eight@test.invalid');
  assert first is not null, 'name free after rejection';

  -- Accepting keeps the name taken (accept_access_request unchanged).
  insert into public.departments (id, name, initials) values ('uo-home', 'UO Home', 'UH');
  insert into auth.users (id) values (v_user);
  perform public.accept_access_request(first, repeat('a', 64), v_user, 'uo-home');
  assert (select status = 'accepted' and user_id = 'a1000000-0000-4000-8000-000000000001' from public.access_requests where id = first), 'accepted';
  perform pg_temp.taken('Riyadh Pharma', 'nine@test.invalid');

  -- The index on its own (as if two submissions came at the same moment): a second pending row for a
  -- new request's name can't be stored.
  perform pg_temp.expect_error($q$insert into public.access_requests (organization, contact_name, job_title, email, phone, approx_users, review_token_hash, review_expires_at)
    values ('RIYADH PHARMA', 'X', 'Y', 'race@test.invalid', '+966500000000', 5, repeat('c', 64), now() + interval '14 days')$q$, '23505');

  -- The 3-per-day limit per email address is unchanged (and checked first).
  perform pg_temp.submit('UO Limit A', 'limit@test.invalid');
  perform pg_temp.submit('UO Limit B', 'limit@test.invalid');
  perform pg_temp.submit('UO Limit C', 'limit@test.invalid');
  perform pg_temp.expect_error($q$select pg_temp.submit('UO Limit D', 'limit@test.invalid')$q$, 'P0001', 'too_many_requests');

  -- Definitions: owner, grants, SECURITY DEFINER and search_path (13 parameters since
  -- 20261115120000_request_organization_details.sql).
  assert (select p.prosecdef and p.proconfig = array['search_path=""'] and p.proowner = 'postgres'::regrole
          from pg_proc p where p.oid = 'public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text)'::regprocedure), 'definition';
  assert has_function_privilege('service_role', 'public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text)', 'execute'), 'service_role';
  assert not has_function_privilege('authenticated', 'public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text)', 'execute'), 'authenticated';
  assert not has_function_privilege('anon', 'public.submit_access_request(text, text, text, text, text, integer, text, text, text, text, text, text, text)', 'execute'), 'anon';
  -- The index: unique and partial, from this migration's time on.
  assert (select i.indisunique and pg_get_expr(i.indpred, i.indrelid) like '%created_at >= ''2026-11-10 15:00:00+00''%'
          from pg_index i where i.indexrelid = 'public.access_requests_organization_unique'::regclass), 'index';
end;
$$;

rollback;
