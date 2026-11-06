-- NOT EXECUTED. Static companion to 20261106120000_delete_sop.sql and
-- 20261106120100_delete_sop_version_files.sql.
-- Only for a disposable LOCAL Supabase/PostgreSQL database with all migrations, and only with
-- explicit permission. Never run it against the shared Supabase project.
-- The functions are called as service_role (as the delete-sop Edge Function does), with the
-- actor's id passed in. Fixtures are inserted directly; everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text) returns void
language plpgsql as $$
declare
  rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise; end if;
    rejected := true;
  end;
  assert rejected, 'Expected ' || p_state || ' from ' || p_sql;
end;
$$;

-- People: 1 main author, 2 co-author, 3 other author, 4 deleted profile, 5 banned, 6 deleted Auth account, 7 reviewer.
insert into public.departments (id, name, initials) values ('delete-test-home', 'Delete test home', 'DT');
insert into auth.users (id) select ('93000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 7) n;
-- Every assigned employee holds a position (20261107120300_employee_positions.sql checks it at commit).
insert into public.profiles (id, full_name, email, initials, department_id, deleted_at, "position")
select ('93000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Delete person ' || n,
       'delete-person-' || n || '@test.invalid', 'DP', 'delete-test-home', case when n = 4 then now() end, 'Tester'
from generate_series(1, 7) n;
insert into public.user_roles (user_id, role)
select ('93000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'author'::public.app_role from generate_series(1, 6) n;
insert into public.user_roles (user_id, role) values ('93000000-0000-4000-8000-000000000007', 'reviewer');
update auth.users set banned_until = now() + interval '1 day' where id = '93000000-0000-4000-8000-000000000005';
update auth.users set deleted_at = now() where id = '93000000-0000-4000-8000-000000000006';

insert into public.guideline_versions (id, name, version, effective_date, file_name)
values ('93100000-0000-4000-8000-000000000001', 'Delete test guideline', '1.0', current_date, 'guideline.pdf');
insert into public.guideline_requirements (id, guideline_version_id, code, module, section, section_title, short_title, page, summary)
values ('93100000-0000-4000-8000-000000000002', '93100000-0000-4000-8000-000000000001', 'R1', 'M', 'S', 'Section', 'Short', 1, 'Summary');

-- An SOP with p_versions versions, all uploaded by its author, with the files 'del/<sop>/<n>.pdf'.
create function pg_temp.make_sop(p_author uuid, p_status public.sop_status, p_versions integer) returns uuid
language plpgsql as $$
declare
  new_id uuid := gen_random_uuid();
begin
  insert into public.sops (id, title, department_id, author_id, status, current_version)
  values (new_id, 'Delete test SOP', 'delete-test-home', p_author, p_status, p_versions);
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  select new_id, n, 'v' || n || '.pdf', 'pdf', 'del/' || new_id || '/' || n || '.pdf', 100, p_author
  from generate_series(1, p_versions) n;
  return new_id;
end;
$$;

do $$
declare
  author constant uuid := '93000000-0000-4000-8000-000000000001';
  coauthor constant uuid := '93000000-0000-4000-8000-000000000002';
  other_author constant uuid := '93000000-0000-4000-8000-000000000003';
  deleted_profile constant uuid := '93000000-0000-4000-8000-000000000004';
  banned constant uuid := '93000000-0000-4000-8000-000000000005';
  deleted_account constant uuid := '93000000-0000-4000-8000-000000000006';
  reviewer constant uuid := '93000000-0000-4000-8000-000000000007';
  guideline constant uuid := '93100000-0000-4000-8000-000000000001';
  requirement constant uuid := '93100000-0000-4000-8000-000000000002';
  sop uuid;
  kept_sop uuid;
  v_round uuid;
  v_request uuid;
  v_comment uuid;
  v_check uuid;
  v_result jsonb;
  path text;
  v_status public.sop_status;
begin
  -- ---------- Who may call them ----------
  assert not has_function_privilege('anon', 'public.delete_sop(uuid, uuid, text)', 'execute'), 'anon must not call delete_sop';
  assert not has_function_privilege('authenticated', 'public.delete_sop(uuid, uuid, text)', 'execute'), 'authenticated must not call delete_sop';
  assert has_function_privilege('service_role', 'public.delete_sop(uuid, uuid, text)', 'execute'), 'service_role calls delete_sop';
  assert not has_function_privilege('anon', 'public.delete_sop_version(uuid, uuid, integer)', 'execute'), 'anon must not call delete_sop_version';
  assert not has_function_privilege('authenticated', 'public.delete_sop_version(uuid, uuid, integer)', 'execute'), 'authenticated must not call delete_sop_version';
  assert has_function_privilege('service_role', 'public.delete_sop_version(uuid, uuid, integer)', 'execute'), 'service_role calls delete_sop_version';
  assert to_regprocedure('public.delete_sop_version(uuid, integer)') is null, 'The browser version of delete_sop_version is gone';

  sop := pg_temp.make_sop(author, 'draft', 2);
  perform set_config('request.jwt.claim.sub', author::text, true);
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', author, sop, 'Reason'), '42501');
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', author, sop), '42501');
  reset role;
  assert exists (select 1 from public.sops s where s.id = sop), 'A refused browser call deletes nothing';

  -- The Edge Function's role can call them (the checks below run as the test's owner role).
  set local role service_role;
  perform public.delete_sop_version(author, sop, 2);
  perform public.delete_sop(author, sop, 'Reason');
  reset role;
  assert not exists (select 1 from public.sops s where s.id = sop), 'service_role deletes the SOP';

  -- ---------- delete_sop: who, which status, the justification ----------
  foreach v_status in array array['draft', 'in-review', 'returned', 'in-approval']::public.sop_status[] loop
    sop := pg_temp.make_sop(author, v_status, 1);
    perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', coauthor, sop, 'Reason'), '42501');
    perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', other_author, sop, 'Reason'), '42501');
    perform pg_temp.expect_error(format('select public.delete_sop(null, %L, %L)', sop, 'Reason'), '42501');
    v_result := public.delete_sop(author, sop, 'Reason');
    assert not exists (select 1 from public.sops s where s.id = sop), 'The main author deletes a ' || v_status || ' SOP';
  end loop;
  foreach v_status in array array['approved', 'published']::public.sop_status[] loop
    sop := pg_temp.make_sop(author, v_status, 1);
    perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', author, sop, 'Reason'), '23514');
    assert exists (select 1 from public.sops s where s.id = sop), 'An ' || v_status || ' SOP is never deleted';
  end loop;
  foreach path in array array[deleted_profile, banned, deleted_account]::text[] loop
    sop := pg_temp.make_sop(path::uuid, 'draft', 1);
    perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', path, sop, 'Reason'), '42501');
  end loop;
  sop := pg_temp.make_sop(author, 'draft', 1);
  perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', author, sop, '   '), '22023');
  perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, null)', author, sop), '22023');
  perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', author, sop, repeat('x', 1001)), '22023');
  perform public.delete_sop(author, sop, '  ' || repeat('x', 1000) || '  ');
  perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', author, gen_random_uuid(), 'Reason'), 'P0002');

  -- ---------- delete_sop: running compliance checks ----------
  sop := pg_temp.make_sop(author, 'draft', 1);
  insert into public.compliance_checks (sop_id, sop_version, guideline_version_id, engine, triggered_by)
  values (sop, 1, guideline, 'sample', author) returning id into v_check;
  perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', author, sop, 'Reason'), '55006');
  -- A sample check left behind for more than 5 minutes isn't running any more.
  update public.compliance_checks set started_at = now() - interval '6 minutes' where id = v_check;
  perform public.delete_sop(author, sop, 'Reason');
  sop := pg_temp.make_sop(author, 'draft', 1);
  insert into public.compliance_checks (sop_id, sop_version, guideline_version_id, engine, triggered_by, started_at)
  values (sop, 1, guideline, 'hawkim', author, now() - interval '10 minutes') returning id into v_check;
  perform pg_temp.expect_error(format('select public.delete_sop(%L, %L, %L)', author, sop, 'Reason'), '55006');
  -- A service check left behind for more than 30 minutes isn't running any more.
  update public.compliance_checks set started_at = now() - interval '31 minutes' where id = v_check;
  perform public.delete_sop(author, sop, 'Reason');

  -- ---------- delete_sop: every row goes, other SOPs stay ----------
  kept_sop := pg_temp.make_sop(author, 'draft', 1);
  sop := pg_temp.make_sop(author, 'in-review', 3);
  update public.sop_versions set deleted_at = now(), deleted_by = author where sop_id = sop and version = 2;
  update public.sop_versions set storage_path = '' where sop_id = sop and version = 3;
  insert into public.sop_co_authors (sop_id, user_id, added_by) values (sop, coauthor, author);
  insert into public.review_rounds (sop_id, version, requested_by) values (sop, 1, author) returning id into v_round;
  insert into public.review_requests (round_id, sop_id, reviewer_id, status) values (v_round, sop, reviewer, 'completed') returning id into v_request;
  insert into public.sop_comments (sop_id, version, author_id, role, text, review_round_id, review_request_id)
  values (sop, 1, reviewer, 'reviewer', 'A comment', v_round, v_request) returning id into v_comment;
  update public.review_requests set comment_id = v_comment where id = v_request;
  insert into public.timeline_events (sop_id, type, actor_id, version, review_round_id, review_request_id, comment_id)
  values (sop, 'review-completed', reviewer, 1, v_round, v_request, v_comment);
  insert into public.compliance_checks (sop_id, sop_version, guideline_version_id, status, triggered_by, completed_at)
  values (sop, 1, guideline, 'completed', author, now()) returning id into v_check;
  insert into public.compliance_findings (check_id, requirement_id, result, justification, position)
  values (v_check, requirement, 'compliant', 'Fine', 1);

  v_result := public.delete_sop(author, sop, 'No longer needed');
  -- The deferred link from the SOP to its current version is checked now, not at the rollback.
  set constraints all immediate;
  -- Back to deferred, so later SOPs can again be created before their first version.
  set constraints all deferred;
  assert v_result->>'code' like 'SOP-%' and v_result->>'title' = 'Delete test SOP', 'The code and title are returned';
  assert v_result->'paths' = jsonb_build_array('del/' || sop || '/1.pdf', 'del/' || sop || '/2.pdf'),
    'Every non-empty file path is returned, deleted versions included: ' || (v_result->'paths')::text;
  assert not exists (select 1 from public.sops where id = sop), 'sops';
  assert not exists (select 1 from public.sop_versions where sop_id = sop), 'sop_versions';
  assert not exists (select 1 from public.sop_co_authors where sop_id = sop), 'sop_co_authors';
  assert not exists (select 1 from public.review_rounds where sop_id = sop), 'review_rounds';
  assert not exists (select 1 from public.review_requests where sop_id = sop), 'review_requests';
  assert not exists (select 1 from public.sop_comments where sop_id = sop), 'sop_comments';
  assert not exists (select 1 from public.timeline_events where sop_id = sop), 'timeline_events';
  assert not exists (select 1 from public.compliance_checks where sop_id = sop), 'compliance_checks';
  assert not exists (select 1 from public.compliance_findings where check_id = v_check), 'compliance_findings';
  assert exists (select 1 from public.sops where id = kept_sop), 'Other SOPs are kept';
  assert exists (select 1 from public.guideline_requirements where id = requirement), 'Reference data is kept';

  -- ---------- delete_sop_version: the existing rules, for the actor passed in ----------
  sop := pg_temp.make_sop(author, 'draft', 3);
  path := public.delete_sop_version(author, sop, 3);
  assert path = 'del/' || sop || '/3.pdf', 'The file path is returned';
  assert (select v.deleted_at is not null and v.deleted_by = author from public.sop_versions v where v.sop_id = sop and v.version = 3),
    'The row is only marked deleted';
  assert (select s.current_version = 2 from public.sops s where s.id = sop), 'The current version moves back';
  assert exists (select 1 from public.timeline_events e where e.sop_id = sop and e.type = 'version-deleted' and e.actor_id = author and e.version = 3),
    'The timeline records it';
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 3)', author, sop), 'P0002');
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 9)', author, sop), 'P0002');

  -- A co-author deletes only a version they uploaded; nobody else can.
  insert into public.sop_co_authors (sop_id, user_id, added_by) values (sop, coauthor, author);
  update public.sop_versions set uploaded_by = coauthor where sop_id = sop and version = 2;
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', coauthor, sop), '42501');
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 2)', other_author, sop), '42501');
  perform pg_temp.expect_error(format('select public.delete_sop_version(null, %L, 2)', sop), '42501');
  perform public.delete_sop_version(coauthor, sop, 2);
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', author, sop), '23514');

  -- Deleted profiles, banned users and deleted Auth accounts are refused, even as main author.
  foreach path in array array[deleted_profile, banned, deleted_account]::text[] loop
    sop := pg_temp.make_sop(path::uuid, 'draft', 2);
    perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 2)', path, sop), '42501');
    assert (select v.deleted_at is null from public.sop_versions v where v.sop_id = sop and v.version = 2), 'Nothing changes';
  end loop;
  -- A ban that has ended doesn't count.
  update auth.users set banned_until = now() - interval '1 minute' where id = banned;
  sop := pg_temp.make_sop(banned, 'draft', 2);
  perform public.delete_sop_version(banned, sop, 2);

  foreach v_status in array array['in-approval', 'approved', 'published']::public.sop_status[] loop
    sop := pg_temp.make_sop(author, v_status, 2);
    perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 2)', author, sop), '23514');
  end loop;
  sop := pg_temp.make_sop(author, 'in-review', 2);
  insert into public.review_rounds (sop_id, version, requested_by) values (sop, 2, author);
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 2)', author, sop), '23514');

  sop := pg_temp.make_sop(author, 'returned', 2);
  update public.sop_versions set storage_path = '' where sop_id = sop and version = 2;
  assert public.delete_sop_version(author, sop, 2) is null, 'An empty path is returned as none';

end;
$$;

rollback;
