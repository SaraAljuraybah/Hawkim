-- Companion to 20261119120000_delete_version_without_engaged_review.sql.
-- Only for a disposable LOCAL Supabase database with all migrations (run_all.local.sh). Never run it
-- against the shared Supabase project. delete_sop_version is called as the delete-sop Edge Function
-- does (the actor's id passed in). Fixtures are inserted directly, except the end-to-end case, which
-- uses submit_for_review and remove_reviewer. Everything is rolled back.
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

-- People: 1 main author, 2 reviewer, 3 reviewer who is deactivated later.
insert into public.departments (id, name, initials, division_id) values ('engaged-test-home', 'Engaged test home', 'ET', 'rnd');
insert into auth.users (id) select ('94000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 3) n;
insert into public.profiles (id, full_name, email, initials, department_id, "position")
select ('94000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Engaged person ' || n,
       'engaged-person-' || n || '@test.invalid', 'EP', 'engaged-test-home', 'Tester'
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role) values
  ('94000000-0000-4000-8000-000000000001', 'author'),
  ('94000000-0000-4000-8000-000000000002', 'reviewer'),
  ('94000000-0000-4000-8000-000000000003', 'reviewer');

-- An SOP with p_versions versions by its author.
create function pg_temp.make_sop(p_author uuid, p_status public.sop_status, p_versions integer) returns uuid
language plpgsql as $$
declare
  new_id uuid := gen_random_uuid();
begin
  insert into public.sops (id, title, department_id, author_id, status, current_version)
  values (new_id, 'Engaged test SOP', 'engaged-test-home', p_author, p_status, p_versions);
  insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
  select new_id, n, 'v' || n || '.pdf', 'pdf', 'eng/' || new_id || '/' || n || '.pdf', 100, p_author
  from generate_series(1, p_versions) n;
  return new_id;
end;
$$;

-- A round on version 1 with one request of the reviewer, both in the given states.
create function pg_temp.make_round(
  p_sop uuid, p_round_status public.review_round_status, p_request_status public.review_request_status,
  p_before_removal public.review_request_status default null, p_accepted boolean default false, p_reviewer uuid default '94000000-0000-4000-8000-000000000002'
) returns uuid
language plpgsql as $$
declare
  v_round uuid;
begin
  insert into public.review_rounds (sop_id, version, requested_by, status, closed_at)
  values (p_sop, 1, '94000000-0000-4000-8000-000000000001', p_round_status, case when p_round_status <> 'open' then now() end)
  returning id into v_round;
  insert into public.review_requests (round_id, sop_id, reviewer_id, status, accepted_at, status_before_removal, removed_at, removed_by, removal_reason)
  values (v_round, p_sop, p_reviewer, p_request_status, case when p_accepted then now() end, p_before_removal,
          case when p_request_status = 'removed' then now() end,
          case when p_request_status = 'removed' then '94000000-0000-4000-8000-000000000001'::uuid end,
          case when p_request_status = 'removed' then 'No longer needed' end);
  return v_round;
end;
$$;

do $$
declare
  author constant uuid := '94000000-0000-4000-8000-000000000001';
  reviewer constant uuid := '94000000-0000-4000-8000-000000000002';
  leaver constant uuid := '94000000-0000-4000-8000-000000000003';
  sop uuid;
  v_round uuid;
  v_request uuid;
  v_status public.review_request_status;
begin
  -- ---------- Deletable: nobody took part ----------

  -- 1. No reviewers at all: the first version can be deleted, and the others keep their numbers.
  sop := pg_temp.make_sop(author, 'draft', 3);
  perform public.delete_sop_version(author, sop, 1);
  assert (select array_agg(v.version order by v.version) from public.sop_versions v where v.sop_id = sop and v.deleted_at is null) = array[2, 3],
    'Versions 2 and 3 keep their numbers after deleting version 1';
  assert (select s.current_version from public.sops s where s.id = sop) = 3, 'The current version is still 3';
  assert (select v.deleted_at is not null from public.sop_versions v where v.sop_id = sop and v.version = 1),
    'Version 1 is only marked deleted, so its number is never reused';
  assert (select max(v.version) + 1 from public.sop_versions v where v.sop_id = sop) = 4,
    'The next upload (upload_sop_version: max of every version, deleted ones included, + 1) is version 4';

  -- 2. A reviewer removed before accepting; the round closed and the SOP went back to Draft.
  sop := pg_temp.make_sop(author, 'draft', 2);
  v_round := pg_temp.make_round(sop, 'closed', 'removed', 'pending');
  perform public.delete_sop_version(author, sop, 1);
  assert (select v.deleted_at is not null from public.sop_versions v where v.sop_id = sop and v.version = 1),
    'A version whose only reviewer was removed before accepting can be deleted';
  -- The review history stays.
  assert exists (select 1 from public.review_rounds r where r.id = v_round and r.status = 'closed'), 'The round is kept';
  assert exists (select 1 from public.review_requests q where q.round_id = v_round and q.status = 'removed'), 'The removed request is kept';
  assert (select s.current_version from public.sops s where s.id = sop) = 2, 'Version 2 keeps its number';

  -- 3. Requests that ended before anyone accepted: declined, expired, withdrawn.
  foreach v_status in array array['declined', 'expired', 'withdrawn']::public.review_request_status[] loop
    sop := pg_temp.make_sop(author, 'draft', 2);
    perform pg_temp.make_round(sop, 'closed', v_status);
    perform public.delete_sop_version(author, sop, 1);
    assert (select v.deleted_at is not null from public.sop_versions v where v.sop_id = sop and v.version = 1),
      'A version whose only request was ' || v_status || ' can be deleted';
  end loop;

  -- 4. The removed reviewer's profile was deactivated afterwards.
  sop := pg_temp.make_sop(author, 'draft', 2);
  perform pg_temp.make_round(sop, 'closed', 'removed', 'pending', false, leaver);
  update public.profiles set deleted_at = now() where id = leaver;
  perform public.delete_sop_version(author, sop, 1);
  assert (select v.deleted_at is not null from public.sop_versions v where v.sop_id = sop and v.version = 1),
    'A deactivated reviewer who never accepted doesn''t protect the version';

  -- ---------- Still protected: an active review, or one a reviewer took part in ----------

  -- 5. An active reviewer: pending, or accepted and reviewing, in an open round.
  sop := pg_temp.make_sop(author, 'in-review', 2);
  perform pg_temp.make_round(sop, 'open', 'pending');
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', author, sop), '23514');
  sop := pg_temp.make_sop(author, 'in-review', 2);
  perform pg_temp.make_round(sop, 'open', 'accepted', null, true);
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', author, sop), '23514');

  -- 6. A completed review, and a returned one.
  sop := pg_temp.make_sop(author, 'draft', 2);
  perform pg_temp.make_round(sop, 'completed', 'completed', null, true);
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', author, sop), '23514');
  sop := pg_temp.make_sop(author, 'returned', 2);
  perform pg_temp.make_round(sop, 'changes-requested', 'returned', null, true);
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', author, sop), '23514');

  -- 7. History with no active review, but a reviewer took part: removed after accepting.
  sop := pg_temp.make_sop(author, 'draft', 2);
  perform pg_temp.make_round(sop, 'closed', 'removed', 'accepted', true);
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', author, sop), '23514');

  -- 8. A comment on the version protects it, whatever the requests say.
  sop := pg_temp.make_sop(author, 'draft', 2);
  v_round := pg_temp.make_round(sop, 'closed', 'removed', 'pending');
  insert into public.sop_comments (sop_id, version, author_id, role, text, review_round_id)
  values (sop, 1, reviewer, 'reviewer', 'A note', v_round);
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 1)', author, sop), '23514');
  assert (select v.deleted_at is null from public.sop_versions v where v.sop_id = sop and v.version = 1), 'Nothing changes';

  -- ---------- End to end: submit for review, remove the only reviewer, delete the version ----------
  sop := pg_temp.make_sop(author, 'draft', 2);
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', author, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.submit_for_review(sop, array[reviewer], null, null, null);
  reset role;
  assert (select s.status from public.sops s where s.id = sop) = 'in-review', 'Submitted';
  -- While the reviewer is pending, the version is protected.
  perform pg_temp.expect_error(format('select public.delete_sop_version(%L, %L, 2)', author, sop), '23514');
  select q.id into v_request from public.review_requests q where q.sop_id = sop and q.reviewer_id = reviewer;
  set local role authenticated;
  perform public.remove_reviewer(v_request, 'Picked the wrong reviewer');
  reset role;
  assert (select s.status from public.sops s where s.id = sop) = 'draft', 'Nobody left: back to Draft';
  assert (select r.status from public.review_rounds r where r.sop_id = sop and r.version = 2) = 'closed', 'The round is closed';
  perform public.delete_sop_version(author, sop, 2);
  assert (select s.current_version from public.sops s where s.id = sop) = 1, 'Version 1 is current again';
  assert exists (select 1 from public.timeline_events e where e.sop_id = sop and e.type = 'reviewer-removed'),
    'The removal stays in the timeline';
  assert exists (select 1 from public.timeline_events e where e.sop_id = sop and e.type = 'version-deleted' and e.version = 2),
    'The deletion is recorded';

  -- The helper is not callable from the browser.
  assert not has_function_privilege('authenticated', 'public.version_review_protected(uuid, integer)', 'execute'),
    'authenticated must not call version_review_protected';
  assert not has_function_privilege('anon', 'public.version_review_protected(uuid, integer)', 'execute'),
    'anon must not call version_review_protected';
end;
$$;

rollback;
