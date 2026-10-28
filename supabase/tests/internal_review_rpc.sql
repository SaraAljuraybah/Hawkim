-- Run on a disposable LOCAL Supabase/PostgreSQL database after ALL migrations.
-- Uses the real RPCs, auth.uid(), role ACLs, tables, RLS, and workflow helpers.
-- All fixtures and workflow changes are rolled back. Never run on production.
begin;
set local plpgsql.check_asserts = on;
set local time zone 'Pacific/Auckland';

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

insert into public.departments (id, name, initials)
values ('rpc-test-home', 'RPC test home', 'RT'), ('rpc-test-foreign', 'RPC test foreign', 'RF');
insert into auth.users (id) select ('90000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 8) n;
insert into public.profiles (id, full_name, email, initials, department_id, deleted_at)
select ('90000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
       'RPC person ' || n, 'rpc-person-' || n || '@test.invalid', 'RP',
       case when n = 5 then 'rpc-test-foreign' else 'rpc-test-home' end,
       case when n = 7 then now() else null end
from generate_series(1, 8) n;
insert into public.user_roles (user_id, role)
select ('90000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'reviewer'::public.app_role
from generate_series(1, 8) n where n <> 6;
insert into public.user_roles (user_id, role)
select ('90000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'author'::public.app_role
from unnest(array[1, 4, 6]) n;

-- Files still go through create_sop/check_sop_file; only the Storage objects are
-- fixtures, as they would have been uploaded by the existing Storage service.
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'sop-files', '90000000-0000-4000-8000-000000000001/' ||
       '91000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.pdf',
       '90000000-0000-4000-8000-000000000001',
       '{"mimetype":"application/pdf","size":123}'::jsonb
from generate_series(1, 8) n;

do $$
declare
  author constant uuid := '90000000-0000-4000-8000-000000000001';
  reviewer constant uuid := '90000000-0000-4000-8000-000000000002';
  reviewer2 constant uuid := '90000000-0000-4000-8000-000000000003';
  coauthor constant uuid := '90000000-0000-4000-8000-000000000004';
  foreign_reviewer constant uuid := '90000000-0000-4000-8000-000000000005';
  other_author constant uuid := '90000000-0000-4000-8000-000000000006';
  inactive_reviewer constant uuid := '90000000-0000-4000-8000-000000000007';
  reviewer3 constant uuid := '90000000-0000-4000-8000-000000000008';
  sop uuid;
  another_sop uuid;
  legacy_sop uuid;
  round1 uuid;
  round2 uuid;
  request1 public.review_requests;
  request2 public.review_requests;
  removed_request public.review_requests;
  legacy_request public.review_requests;
  expected_response date := public.hawkim_riyadh_date(public.hawkim_review_response_due_at(now()));
  old_response_at timestamptz;
  old_decision_at timestamptz;
  old_comment_id uuid;
  note_length integer;
  i integer := 0;
begin
  perform set_config('request.jwt.claim.sub', author::text, true);
  set local role authenticated;
  sop := public.create_sop(repeat('t', 50), 'Existing description', 'rpc-test-home', author || '/91000000-0000-4000-8000-000000000001.pdf', 'Procedure.pdf');
  assert (select s.title = repeat('t', 50) from public.sops s where s.id = sop), '50-character title must save through the real RPC';
  perform pg_temp.expect_error(format('select public.create_sop(%L, null, %L, null, null)', repeat('t', 51), 'rpc-test-home'), '22023');
  perform pg_temp.expect_error(format('select public.create_sop(%L, null, %L, null, null)', E' \t\n', 'rpc-test-home'), '22023');
  perform pg_temp.expect_error(format('select public.create_sop(%L, null, %L, null, null)', 'Foreign attempt', 'rpc-test-foreign'), '23514');
  perform public.add_co_authors(sop, array[coauthor]);

  -- Direct calls cannot use main-author, co-author, reviewer, inactive, or
  -- foreign reviewer permissions to bypass separation of duties or eligibility.
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, 2, null)', sop, author), '23514');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, 2, null)', sop, coauthor), '23514');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, 2, null)', sop, foreign_reviewer), '23514');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, 2, null)', sop, inactive_reviewer), '23514');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L,%L]::uuid[], null, 2, null)', sop, reviewer, reviewer), '23514');
  foreach note_length in array array[0, 31] loop
    perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, %s, null)', sop, reviewer, note_length), '23514');
  end loop;
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], %L::date, 2, null)', sop, reviewer, expected_response + 1), '23514');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], %L::date, 2, null)', sop, reviewer, 'infinity'), '23514');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, 2, %L)', sop, reviewer, repeat('x', 1001)), '22023');
  assert not exists (select 1 from public.review_rounds r where r.sop_id = sop), 'Invalid submissions must not create a round';
  assert (select s.status = 'draft' from public.sops s where s.id = sop), 'Invalid submissions must not change the SOP';
  foreach i in array array[2, 4, 6] loop
    perform set_config('request.jwt.claim.sub', ('90000000-0000-4000-8000-' || lpad(i::text, 12, '0')), true);
    perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, 2, null)', sop, reviewer2), '42501');
  end loop;
  perform set_config('request.jwt.claim.sub', author::text, true);

  round1 := public.submit_for_review(sop, array[reviewer, reviewer2], expected_response, 2, repeat('n', 1000));
  select * into request1 from public.review_requests q where q.round_id = round1 and q.reviewer_id = reviewer;
  select * into request2 from public.review_requests q where q.round_id = round1 and q.reviewer_id = reviewer2;
  assert request1.status = 'pending' and request2.status = 'pending', 'All selected reviewers must receive requests together';
  assert request1.assigned_at = now() and request2.assigned_at = request1.assigned_at, 'Requests must share the precise server submission time';
  assert request1.response_due_at = public.hawkim_review_response_due_at(request1.assigned_at)
     and request2.response_due_at = request1.response_due_at, 'Every selected reviewer must get the authoritative fixed response window';
  assert request1.response_due_date = expected_response and request1.deadline_policy = 'riyadh-working-days-v1', 'New requests must record the working-day policy';
  assert request1.response_counts_from = public.hawkim_review_response_counts_from(request1.assigned_at), 'The server must save the Riyadh response allocation start separately from its precise send time';
  assert request1.review_due_at is null and request1.accepted_at is null, 'Review duration must not start before acceptance';
  assert (select e.note = repeat('n', 1000) from public.timeline_events e where e.review_round_id = round1 and e.type = 'submitted'), '1000-character comments must persist in the actual timeline';
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, 2, null)', sop, reviewer), '23514');
  perform pg_temp.expect_error(format('select public.accept_review(%L)', request1.id), '42501');
  perform set_config('request.jwt.claim.sub', coauthor::text, true);
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, 2, null)', sop, reviewer3), '42501');
  perform set_config('request.jwt.claim.sub', reviewer::text, true);
  perform pg_temp.expect_error(format('select public.accept_review(%L)', request2.id), '42501');
  perform pg_temp.expect_error(format('select public.decide_review(%L, %L, null)', request1.id, 'completed'), '23514');
  perform public.accept_review(request1.id);
  select * into request1 from public.review_requests q where q.id = request1.id;
  assert request1.accepted_at = now(), 'The server must fix the precise acceptance timestamp';
  assert request1.review_due_at = public.hawkim_review_due_at(request1.accepted_at, 2), 'The real accept RPC must count subsequent working dates';
  assert request1.review_due_date = public.hawkim_riyadh_date(request1.review_due_at), 'Saved date and authoritative instant must agree';
  assert (request1.review_due_at at time zone 'Asia/Riyadh')::time = time '23:59:59.999', 'Expiry must retain Riyadh millisecond precision';
  assert request1.response_due_at = request2.response_due_at, 'Accepting must not overwrite the response allocation';
  perform pg_temp.expect_error(format('select public.accept_review(%L)', request1.id), '23514');
  perform public.decide_review(request1.id, 'completed', 'Version one feedback');
  select * into request1 from public.review_requests q where q.id = request1.id;
  old_decision_at := request1.decided_at;
  old_comment_id := request1.comment_id;
  assert request1.status = 'completed' and old_comment_id is not null, 'Independent review decisions and comments must persist';

  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.add_reviewers(sop, array[reviewer3], null, 3, repeat('a', 501));
  select * into removed_request from public.review_requests q where q.round_id = round1 and q.reviewer_id = reviewer3;
  assert removed_request.response_due_at = public.hawkim_review_response_due_at(removed_request.assigned_at), 'Older clients omitting a response date still receive the fixed server allocation';
  assert exists (select 1 from public.timeline_events e where e.review_round_id = round1 and e.note = repeat('a', 501)), '501-character add-reviewer comments must persist';
  perform set_config('request.jwt.claim.sub', reviewer2::text, true);
  perform pg_temp.expect_error(format('select public.remove_reviewer(%L, %L)', removed_request.id, 'Unauthorized removal'), '42501');
  perform public.accept_review(request2.id);
  perform public.decide_review(request2.id, 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.remove_reviewer(removed_request.id, 'No longer needed');
  assert (select q.status = 'removed' and q.status_before_removal = 'pending' from public.review_requests q where q.id = removed_request.id), 'Cancellation must retain previous status';
  assert exists (select 1 from public.timeline_events e where e.review_request_id = removed_request.id and e.type = 'reviewer-removed' and e.note = 'No longer needed'), 'Cancellation audit must persist';
  assert (select r.status = 'completed' from public.review_rounds r where r.id = round1), 'Completed participating reviewers must settle the round';
  assert (select s.status = 'in-review' from public.sops s where s.id = sop), 'Finishing internal review must not automatically start approval';
  perform set_config('request.jwt.claim.sub', reviewer3::text, true);
  assert exists (select 1 from public.user_roles r where r.user_id = reviewer3 and r.role = 'reviewer'), 'Removing one assignment must preserve the global Reviewer permission';
  perform pg_temp.expect_error(format('select public.accept_review(%L)', removed_request.id), '23514');
  perform pg_temp.expect_error(format('select public.decide_review(%L, %L, null)', removed_request.id, 'completed'), '23514');

  -- A new version is sent through the original upload/round RPCs. Old decisions,
  -- timestamps, comments, and their version association must remain untouched.
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert public.upload_sop_version(sop, author || '/91000000-0000-4000-8000-000000000002.pdf', 'Revised procedure.pdf') = 2, 'The existing upload workflow must remain usable';
  round2 := public.submit_for_review(sop, array[reviewer, reviewer2], null, 5, repeat('r', 500));
  assert round2 <> round1, 'Resubmission must create a distinct version-scoped round';
  assert (select r.version = 2 from public.review_rounds r where r.id = round2), 'The resubmitted round must target the new version';
  assert (select q.status = 'completed' and q.decided_at = old_decision_at and q.comment_id = old_comment_id from public.review_requests q where q.id = request1.id), 'Resubmission must preserve historical decisions';
  assert (select c.version = 1 and c.text = 'Version one feedback' from public.sop_comments c where c.id = old_comment_id), 'Historical feedback must stay linked to v1';
  assert (select count(*) = 2 and bool_and(q.status = 'pending' and q.review_duration_days = 5 and q.review_due_at is null and q.deadline_policy = 'riyadh-working-days-v1') from public.review_requests q where q.round_id = round2), 'The new review round must use a fresh shared allocation without resetting history';
  assert exists (select 1 from public.timeline_events e where e.review_round_id = round2 and e.type = 'resubmitted' and e.note = repeat('r', 500)), '500-character resubmission comments must persist';
  perform set_config('request.jwt.claim.sub', reviewer::text, true);
  perform pg_temp.expect_error(format('select public.decide_review(%L, %L, null)', request1.id, 'completed'), '23514');

  -- Boundary lengths all save unchanged through the real submit RPC. Invalid
  -- 1001-character input was already proved to make no partial submission.
  perform set_config('request.jwt.claim.sub', author::text, true);
  i := 2;
  foreach note_length in array array[500, 501, 1000] loop
    i := i + 1;
    another_sop := public.create_sop('Comment boundary ' || note_length, null, 'rpc-test-home', author || '/91000000-0000-4000-8000-' || lpad(i::text, 12, '0') || '.pdf', 'Procedure.pdf');
    perform public.submit_for_review(another_sop, array[reviewer], null, null, repeat('x', note_length));
    assert exists (select 1 from public.timeline_events e where e.sop_id = another_sop and e.type = 'submitted' and e.note = repeat('x', note_length)), 'Submission comments must save at every supported boundary';
    assert (select q.review_duration_days is null and q.response_due_at is not null from public.review_requests q where q.sop_id = another_sop), 'Duration remains optional while response date is server controlled';
  end loop;

  -- Existing calendar-policy requests are not silently rewritten. Simulate a
  -- pre-migration pending request under the owner, then use the real accept RPC.
  legacy_sop := public.create_sop('Legacy pending request', null, 'rpc-test-home', author || '/91000000-0000-4000-8000-000000000006.pdf', 'Legacy.pdf');
  perform public.submit_for_review(legacy_sop, array[reviewer], null, 2, null);
  reset role;
  update public.review_requests set deadline_policy = 'calendar-v1' where sop_id = legacy_sop;
  set local role authenticated;
  select * into legacy_request from public.review_requests q where q.sop_id = legacy_sop;
  old_response_at := legacy_request.response_due_at;
  perform set_config('request.jwt.claim.sub', reviewer::text, true);
  perform public.accept_review(legacy_request.id);
  select * into legacy_request from public.review_requests q where q.id = legacy_request.id;
  assert legacy_request.review_due_at = public.hawkim_riyadh_end_of_day(public.hawkim_riyadh_date(legacy_request.accepted_at) + 2), 'Existing calendar allocation must retain its original semantics';
  assert legacy_request.deadline_policy = 'calendar-v1' and legacy_request.response_due_at = old_response_at, 'Historical policy and response date must not be changed';

  -- Existing withdrawal stops action on expired response requests. Administrative
  -- fixture adjustment is not an application mutation and is rolled back.
  reset role;
  update public.review_requests set response_due_date = public.hawkim_riyadh_date(now()) - 1,
    response_due_at = public.hawkim_riyadh_end_of_day(public.hawkim_riyadh_date(now()) - 1)
  where round_id = round2;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.withdraw_due_requests(sop);
  assert (select bool_and(q.status = 'withdrawn') from public.review_requests q where q.round_id = round2), 'Unanswered expired response tasks must be withdrawn';
  select * into request2 from public.review_requests q where q.round_id = round2 and q.reviewer_id = reviewer2;
  perform set_config('request.jwt.claim.sub', reviewer2::text, true);
  perform pg_temp.expect_error(format('select public.accept_review(%L)', request2.id), '23514');
  assert (select q.accepted_at is null and q.review_due_at is null from public.review_requests q where q.id = request2.id), 'Withdrawn tasks must not start a review allocation';

  -- Browser roles cannot invoke the unchecked internal sender or rewrite tables.
  assert not has_function_privilege('authenticated', 'public.send_review_requests(public.sops,uuid,public.timeline_event_type,uuid[],date,integer,text)', 'EXECUTE'), 'Internal sender must not become a browser mutation shortcut';
  assert not has_table_privilege('authenticated', 'public.review_requests', 'UPDATE'), 'RLS/privilege protection must still prevent direct deadline edits';
  assert not has_function_privilege('anon', 'public.accept_review(uuid)', 'EXECUTE'), 'Anonymous acceptance must remain unavailable';
  reset role;
end;
$$;

rollback;
