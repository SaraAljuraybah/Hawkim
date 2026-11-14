-- Only for a disposable LOCAL database with all migrations, never the shared Supabase project.
-- Uses the real RPCs, auth.uid(), role ACLs and RLS. Everything is rolled back at the end.
-- 20261114130100_pending_review_duration.sql: the main author changes a pending request's review
-- duration (no deadline yet; accept_review counts from it), with a private 'review-duration-changed'
-- event; accepted requests work as before; everything else is refused. Also checks that a removal's
-- and a decline's reason is saved on its timeline event and readable by the author and co-authors.
-- Run without that migration, this test must fail (the first pending change is refused).
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_hint text) returns void
language plpgsql as $$
declare
  rejected boolean := false;
  hint text;
begin
  begin execute p_sql;
  exception when others then
    get stacked diagnostics hint = pg_exception_hint;
    if coalesce(hint, '') <> p_hint then raise; end if;
    rejected := true;
  end;
  assert rejected, 'Expected a refusal from ' || p_sql;
end;
$$;

-- Read as the database owner, so RLS never hides what is being checked.
create function pg_temp.request_row(p_id uuid) returns public.review_requests
language sql security definer set search_path = '' as $$ select q.* from public.review_requests q where q.id = p_id $$;
create function pg_temp.request_of(p_round uuid, p_reviewer uuid) returns uuid
language sql security definer set search_path = '' as $$
  select q.id from public.review_requests q where q.round_id = p_round and q.reviewer_id = p_reviewer order by q.seq desc limit 1
$$;
create function pg_temp.events(p_sop uuid, p_type text) returns integer
language sql security definer set search_path = '' as $$
  select count(*)::integer from public.timeline_events e where e.sop_id = p_sop and e.type::text = p_type
$$;
-- What the signed-in person can read, through RLS.
create function pg_temp.visible(p_sop uuid, p_type text) returns integer
language sql as $$ select count(*)::integer from public.timeline_events e where e.sop_id = p_sop and e.type::text = p_type $$;

insert into public.departments (id, name, initials) values ('prd-home', 'Home', 'HO');
insert into auth.users (id) select ('b8000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 7) n;
insert into public.profiles (id, full_name, email, initials, department_id)
select ('b8000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Person ' || n, 'prd-' || n || '@test.invalid', 'PE', 'prd-home'
from generate_series(1, 7) n;
insert into public.user_roles (user_id, role) values ('b8000000-0000-4000-8000-000000000001', 'author'), ('b8000000-0000-4000-8000-000000000002', 'author');
insert into public.user_roles (user_id, role)
select ('b8000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'reviewer'::public.app_role from generate_series(3, 7) n;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'sop-files', 'b8000000-0000-4000-8000-000000000001/b8100000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.pdf',
       'b8000000-0000-4000-8000-000000000001', '{"mimetype":"application/pdf","size":123}'::jsonb
from generate_series(1, 8) n;

do $$
declare
  author constant uuid := 'b8000000-0000-4000-8000-000000000001';
  coauthor constant uuid := 'b8000000-0000-4000-8000-000000000002';
  r1 constant uuid := 'b8000000-0000-4000-8000-000000000003';
  r2 constant uuid := 'b8000000-0000-4000-8000-000000000004';
  r3 constant uuid := 'b8000000-0000-4000-8000-000000000005';
  r4 constant uuid := 'b8000000-0000-4000-8000-000000000006';
  r5 constant uuid := 'b8000000-0000-4000-8000-000000000007';
  sop uuid;
  round1 uuid;
  req public.review_requests;
  file integer := 0;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', author::text, true);
  file := file + 1;
  sop := public.create_sop('Durations', 'Description', 'prd-home', author || '/b8100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  reset role;
  insert into public.sop_co_authors (sop_id, user_id, added_by) values (sop, coauthor, author);
  set local role authenticated;
  round1 := public.submit_for_review(sop, array[r1, r2, r3, r4], null, 3, null);

  -- ---------- A pending request's review duration ----------
  perform public.change_review_deadline(pg_temp.request_of(round1, r1), 5);
  req := pg_temp.request_row(pg_temp.request_of(round1, r1));
  assert req.status = 'pending' and req.review_duration_days = 5, 'The planned duration changed; still pending';
  assert req.review_due_at is null and req.review_due_date is null and req.accepted_at is null, 'No review deadline before acceptance';
  reset role;
  assert req.response_due_at = public.hawkim_review_response_due_at(req.assigned_at), 'The response deadline is unchanged';
  set local role authenticated;
  reset role;
  assert (select e.previous_review_duration_days = 3 and e.new_review_duration_days = 5 and e.recipient_ids = array[r1] and e.actor_id = author
            and e.review_request_id = req.id and e.previous_review_due_at is null and e.new_review_due_at is null
          from public.timeline_events e where e.sop_id = sop and e.type = 'review-duration-changed'), 'A private event with the old and new durations';
  set local role authenticated;
  assert pg_temp.events(sop, 'review-deadline-changed') = 0, 'Not a deadline change';
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 5)', req.id), '');
  assert pg_temp.events(sop, 'review-duration-changed') = 1, 'An unchanged duration is refused, with no event';
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 0)', req.id), '');
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 3651)', req.id), '');
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, null)', req.id), '');

  -- Accepting counts the deadline from the new duration.
  perform set_config('request.jwt.claim.sub', r1::text, true);
  perform public.accept_review(req.id);
  req := pg_temp.request_row(req.id);
  reset role;
  assert req.review_due_at = public.hawkim_review_due_at(req.accepted_at, 5), 'The review deadline uses the changed duration';
  set local role authenticated;

  -- Accepted: a deadline change, as before.
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.change_review_deadline(req.id, 8);
  reset role;
  assert (pg_temp.request_row(req.id)).review_due_at = public.hawkim_review_due_at(req.accepted_at, 8), 'Accepted: the deadline moves';
  set local role authenticated;
  assert pg_temp.events(sop, 'review-deadline-changed') = 1 and pg_temp.events(sop, 'review-duration-changed') = 1, 'With the deadline event, as before';

  -- A pending request sent without a duration can be given one.
  reset role;
  update public.review_requests set review_duration_days = null where id = pg_temp.request_of(round1, r2);
  set local role authenticated;
  perform public.change_review_deadline(pg_temp.request_of(round1, r2), 4);
  assert (pg_temp.request_row(pg_temp.request_of(round1, r2))).review_duration_days = 4, 'A duration is set';
  reset role;
  assert (select e.previous_review_duration_days is null and e.new_review_duration_days = 4 from public.timeline_events e
          where e.sop_id = sop and e.type = 'review-duration-changed' and e.recipient_ids = array[r2]), 'From none to 4';
  set local role authenticated;

  -- Only the main author.
  perform set_config('request.jwt.claim.sub', coauthor::text, true);
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r3)), '');
  perform set_config('request.jwt.claim.sub', r3::text, true);
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r3)), '');

  -- Private: the author, co-authors and that reviewer read it; another reviewer doesn't.
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.visible(sop, 'review-duration-changed') = 2, 'The author reads both';
  perform set_config('request.jwt.claim.sub', coauthor::text, true);
  assert pg_temp.visible(sop, 'review-duration-changed') = 2, 'A co-author reads both';
  perform set_config('request.jwt.claim.sub', r1::text, true);
  assert pg_temp.visible(sop, 'review-duration-changed') = 1, 'r1 reads only their own';
  perform set_config('request.jwt.claim.sub', r3::text, true);
  assert pg_temp.visible(sop, 'review-duration-changed') = 0, 'r3 reads none';

  -- ---------- Refused: declined, removed, expired, completed, returned ----------
  perform set_config('request.jwt.claim.sub', r3::text, true);
  perform public.decline_review(pg_temp.request_of(round1, r3), '  On leave  ');
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r3)), 'review-deadline-unavailable');
  perform public.remove_reviewer(pg_temp.request_of(round1, r4), '  Not needed  ');
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r4)), 'review-deadline-unavailable');

  -- The reasons are saved on their events, trimmed, and the author and co-authors read them.
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert (select e.note from public.timeline_events e where e.sop_id = sop and e.type = 'reviewer-removed') = 'Not needed', 'The author reads the removal reason';
  assert (select e.note from public.timeline_events e where e.sop_id = sop and e.type = 'review-declined') = 'On leave', 'The author reads the decline reason';
  perform set_config('request.jwt.claim.sub', coauthor::text, true);
  assert (select e.note from public.timeline_events e where e.sop_id = sop and e.type = 'reviewer-removed') = 'Not needed', 'A co-author reads the removal reason';
  assert (select e.note from public.timeline_events e where e.sop_id = sop and e.type = 'review-declined') = 'On leave', 'A co-author reads the decline reason';
  perform set_config('request.jwt.claim.sub', author::text, true);

  -- Past its response deadline: the change applies the expiry first, so it is refused. The refused call
  -- rolls back as a whole (expiry included); the next expiry run expires it, and it stays refused.
  perform public.add_reviewers(sop, array[r5], null, 2, null);
  reset role;
  update public.review_requests set response_due_at = now() - interval '1 minute' where id = pg_temp.request_of(round1, r5);
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r5)), 'review-deadline-unavailable');
  assert (pg_temp.request_row(pg_temp.request_of(round1, r5))).review_duration_days = 2, 'Unchanged';
  perform public.expire_due_requests(sop);
  assert (pg_temp.request_row(pg_temp.request_of(round1, r5))).status = 'expired', 'Expired';
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r5)), 'review-deadline-unavailable');
  assert (pg_temp.request_row(pg_temp.request_of(round1, r5))).review_duration_days = 2, 'Still unchanged';

  -- Completed and returned.
  perform set_config('request.jwt.claim.sub', r2::text, true);
  perform public.accept_review(pg_temp.request_of(round1, r2));
  perform public.decide_review(pg_temp.request_of(round1, r2), 'returned', 'Please fix section 2');
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r2)), 'review-deadline-unavailable');
  perform set_config('request.jwt.claim.sub', r1::text, true);
  perform public.decide_review(pg_temp.request_of(round1, r1), 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r1)), 'review-deadline-unavailable');

  -- ---------- Refused: an older version ----------
  reset role;
  update public.review_rounds set requested_at = requested_at - interval '1 minute' where id = round1;
  set local role authenticated;
  file := file + 1;
  perform public.upload_sop_version(sop, author || '/b8100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure v2.pdf');
  perform public.submit_for_review(sop, array[r3], null, 3, null);
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r3)), 'review-deadline-unavailable');

  -- ---------- Refused: a Draft (nobody left, 20261114120100_review_back_to_draft.sql) ----------
  file := file + 1;
  sop := public.create_sop('Draft again', 'Description', 'prd-home', author || '/b8100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[r1], null, 3, null);
  perform public.remove_reviewer(pg_temp.request_of(round1, r1), 'Not needed');
  assert (select s.status from public.sops s where s.id = sop) = 'draft', 'Back to Draft';
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 6)', pg_temp.request_of(round1, r1)), 'review-deadline-unavailable');

  -- ---------- Privileges ----------
  reset role;
  assert not has_function_privilege('anon', 'public.change_review_deadline(uuid,integer)', 'EXECUTE'), 'Not for anonymous users';
  assert has_function_privilege('authenticated', 'public.change_review_deadline(uuid,integer)', 'EXECUTE'), 'Signed-in users call it (it checks who)';
end;
$$;

rollback;
