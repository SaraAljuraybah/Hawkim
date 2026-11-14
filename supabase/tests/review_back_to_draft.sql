-- Only for a disposable LOCAL database with all migrations, never the shared Supabase project.
-- Uses the real RPCs, auth.uid(), role ACLs and RLS. Everything is rolled back at the end.
-- 20261114120100_review_back_to_draft.sql: when nobody is left in the current round (no pending or
-- accepted request, and no completed or returned one), the round closes and the SOP goes back to
-- Draft, for any version. History is kept, no timeline event is added, and the author submits again:
-- submit_for_review reopens that closed round (one round per version).
-- Run without that migration, this test must fail (the first back-to-Draft check refuses).
begin;
set local plpgsql.check_asserts = on;

-- The organization's folder, the first part of every stored file's path (20261116230000): MedCare's, the
-- first organization (with the owner's rights, so it also works while acting as a signed-in user).
create function pg_temp.org_folder() returns text
language sql stable security definer as $$ select o.id::text from public.organizations o order by o.created_at, o.id limit 1 $$;
grant execute on function pg_temp.org_folder() to public;

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
create function pg_temp.sop_status(p_sop uuid) returns text
language sql security definer set search_path = '' as $$ select s.status::text from public.sops s where s.id = p_sop $$;
create function pg_temp.round_status(p_round uuid) returns text
language sql security definer set search_path = '' as $$ select r.status::text from public.review_rounds r where r.id = p_round $$;
create function pg_temp.round_closed_at(p_round uuid) returns timestamptz
language sql security definer set search_path = '' as $$ select r.closed_at from public.review_rounds r where r.id = p_round $$;
create function pg_temp.rounds(p_sop uuid) returns integer
language sql security definer set search_path = '' as $$ select count(*)::integer from public.review_rounds r where r.sop_id = p_sop $$;
create function pg_temp.requests(p_sop uuid) returns text[]
language sql security definer set search_path = '' as $$
  select coalesce(array_agg(q.status::text order by q.seq), '{}') from public.review_requests q where q.sop_id = p_sop
$$;
create function pg_temp.events(p_sop uuid) returns text[]
language sql security definer set search_path = '' as $$
  select coalesce(array_agg(e.type::text order by e.type::text), '{}') from public.timeline_events e where e.sop_id = p_sop
$$;
create function pg_temp.request_row(p_id uuid) returns public.review_requests
language sql security definer set search_path = '' as $$ select q.* from public.review_requests q where q.id = p_id $$;
create function pg_temp.latest_status(p_round uuid, p_reviewer uuid) returns text
language sql security definer set search_path = '' as $$
  select q.status::text from public.latest_requests(p_round) q where q.reviewer_id = p_reviewer
$$;
create function pg_temp.finished(p_round uuid) returns boolean
language sql security definer set search_path = '' as $$ select public.has_home_finished(p_round) $$;
create function pg_temp.request_of(p_round uuid, p_reviewer uuid) returns uuid
language sql security definer set search_path = '' as $$
  select q.id from public.review_requests q where q.round_id = p_round and q.reviewer_id = p_reviewer order by q.seq desc limit 1
$$;
-- The events after an action: the ones before plus exactly the expected new ones.
create function pg_temp.plus(p_before text[], variadic p_new text[]) returns text[]
language sql as $$ select array_agg(t order by t) from unnest(p_before || p_new) t $$;

insert into public.departments (id, name, initials) values ('btd-home', 'Home', 'HO'), ('btd-other', 'Other', 'OT');
insert into auth.users (id) select ('b7000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, initials, department_id)
select ('b7000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Person ' || n, 'btd-' || n || '@test.invalid', 'PE',
       case when n = 5 then 'btd-other' else 'btd-home' end
from generate_series(1, 5) n;
insert into public.user_roles (user_id, role) values ('b7000000-0000-4000-8000-000000000001', 'author');
insert into public.user_roles (user_id, role)
select ('b7000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'reviewer'::public.app_role from generate_series(2, 5) n;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'sop-files', pg_temp.org_folder() || '/b7000000-0000-4000-8000-000000000001/b7100000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.pdf',
       'b7000000-0000-4000-8000-000000000001', '{"mimetype":"application/pdf","size":123}'::jsonb
from generate_series(1, 12) n;

do $$
declare
  author constant uuid := 'b7000000-0000-4000-8000-000000000001';
  home1 constant uuid := 'b7000000-0000-4000-8000-000000000002';
  home2 constant uuid := 'b7000000-0000-4000-8000-000000000003';
  home3 constant uuid := 'b7000000-0000-4000-8000-000000000004';
  other1 constant uuid := 'b7000000-0000-4000-8000-000000000005';
  sop uuid;
  round1 uuid;
  round2 uuid;
  old_request public.review_requests;
  new_request uuid;
  before text[];
  file integer := 0;
begin
  set local role authenticated;

  -- ---------- 1. Removing the only reviewer ----------
  perform set_config('request.jwt.claim.sub', author::text, true);
  file := file + 1;
  sop := public.create_sop('Removed only', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1], null, null, null);
  before := pg_temp.events(sop);
  perform public.remove_reviewer(pg_temp.request_of(round1, home1), 'Not needed');
  assert pg_temp.sop_status(sop) = 'draft', 'Removing the only reviewer sends the SOP back to Draft';
  assert pg_temp.round_status(round1) = 'closed' and pg_temp.round_closed_at(round1) is not null, 'The round is closed, not deleted';
  assert pg_temp.requests(sop) = array['removed'], 'The request is kept, as removed';
  assert pg_temp.events(sop) = pg_temp.plus(before, 'reviewer-removed'), 'Only the removal event: no event for going back to Draft';

  -- A Draft: the In Review actions refuse, and Submit for Review accepts it again (same department first).
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', sop, home2), '');
  perform pg_temp.expect_error(format('select public.remove_reviewer(%L, %L)', pg_temp.request_of(round1, home1), 'Again'), '');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, null, null)', sop, other1), 'home-reviewers-first');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L,%L]::uuid[], null, null, null)', sop, home2, other1), 'home-reviewers-first');
  assert pg_temp.sop_status(sop) = 'draft' and pg_temp.round_status(round1) = 'closed', 'A refused send changes nothing';
  -- Sent again: the closed round reopens (one round per version), with the new requests after the old one.
  old_request := pg_temp.request_row(pg_temp.request_of(round1, home1));
  before := pg_temp.events(sop);
  round2 := public.submit_for_review(sop, array[home1, home2], null, 4, null);
  assert round2 = round1, 'The same round reopens';
  assert pg_temp.sop_status(sop) = 'in-review', 'Submitted again';
  assert pg_temp.round_status(round1) = 'open' and pg_temp.round_closed_at(round1) is null, 'Reopened: open, closed_at cleared';
  assert pg_temp.rounds(sop) = 1, 'Still one round for the version';
  assert pg_temp.requests(sop) = array['removed', 'pending', 'pending'], 'Every request is kept, the new ones after the old one';
  assert pg_temp.events(sop) = pg_temp.plus(before, 'submitted'), 'Sent again from Draft: a submitted event';
  reset role;
  assert exists (select 1 from public.timeline_events e where e.sop_id = sop and e.type = 'submitted' and e.review_round_id = round1 and e.recipient_ids = array[home1, home2]), 'The event names the new reviewers';
  set local role authenticated;

  -- The removed reviewer invited again: a new request, and only the latest counts.
  assert pg_temp.latest_status(round1, home1) = 'pending', 'The latest request of home1 is the new one';
  assert pg_temp.request_row(old_request.id) = old_request, 'The removed request is unchanged';
  new_request := pg_temp.request_of(round1, home1);
  assert new_request <> old_request.id, 'A new request';
  -- Deadlines: the new requests get the fixed response deadline of the server and the new duration.
  reset role;
  assert (select q.response_due_at = public.hawkim_review_response_due_at(q.assigned_at) and q.review_duration_days = 4
          and q.deadline_policy = 'riyadh-working-days-v1' from public.review_requests q where q.id = new_request), 'The new request has its own deadlines';
  set local role authenticated;
  -- The old request can't be acted on; the new one can.
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform pg_temp.expect_error(format('select public.accept_review(%L)', old_request.id), '');
  perform public.accept_review(new_request);
  reset role;
  assert (select q.review_due_at = public.hawkim_review_due_at(q.accepted_at, 4) from public.review_requests q where q.id = new_request), 'The review deadline runs from acceptance';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', author::text, true);

  -- The department lock: the old removed request doesn't count, nor do pending or accepted.
  assert not pg_temp.finished(round1), 'Nobody finished the reopened round yet';
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', sop, other1), 'home-reviewer-must-finish');
  -- Expiry: only the new unanswered request expires; the old ones are left alone.
  reset role;
  update public.review_requests set response_due_at = now() - interval '1 minute' where id = pg_temp.request_of(round1, home2);
  set local role authenticated;
  perform public.expire_due_requests(sop);
  assert pg_temp.requests(sop) = array['removed', 'accepted', 'expired'], 'Only the new pending request expired';
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.round_status(round1) = 'open', 'home1 is still reviewing';
  -- Returned in the reopened round: counts as finished.
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.decide_review(new_request, 'returned', 'Please fix section 2');
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.finished(round1), 'A same-department reviewer returned it in the reopened round';
  assert pg_temp.round_status(round1) = 'changes-requested', 'The reopened round settles as Changes Requested';
  perform public.add_reviewers(sop, array[other1], null, null, null);
  assert pg_temp.round_status(round1) = 'open', 'Adding a reviewer reopens it as before';
  -- Completed by the other-department reviewer: still Changes Requested (home1 returned it).
  perform set_config('request.jwt.claim.sub', other1::text, true);
  perform public.accept_review(pg_temp.request_of(round1, other1));
  perform public.decide_review(pg_temp.request_of(round1, other1), 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.round_status(round1) = 'changes-requested', 'Settles as before';

  -- ---------- 2. The only reviewer declines ----------
  file := file + 1;
  sop := public.create_sop('Declined only', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1], null, null, null);
  before := pg_temp.events(sop);
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.decline_review(pg_temp.request_of(round1, home1), 'On leave');
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.sop_status(sop) = 'draft' and pg_temp.round_status(round1) = 'closed', 'Declined by the only reviewer: back to Draft';
  assert pg_temp.requests(sop) = array['declined'], 'The declined request is kept';
  assert pg_temp.events(sop) = pg_temp.plus(before, 'review-declined'), 'Only the decline event';

  -- ---------- 3. The only reviewer's request expires ----------
  file := file + 1;
  sop := public.create_sop('Expired only', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1], null, null, null);
  reset role;
  update public.review_requests set response_due_at = now() - interval '1 minute' where round_id = round1;
  set local role authenticated;
  before := pg_temp.events(sop);
  perform public.expire_due_requests(sop);
  assert pg_temp.sop_status(sop) = 'draft' and pg_temp.round_status(round1) = 'closed', 'Expired, the only request: back to Draft';
  assert pg_temp.requests(sop) = array['expired'], 'The expired request is kept';
  assert pg_temp.events(sop) = pg_temp.plus(before, 'review-expired'), 'Only the expiry event';
  -- Send Again needs In Review.
  perform pg_temp.expect_error(format('select public.resend_review_request(%L)', pg_temp.request_of(round1, home1)), 'request-not-resendable');
  -- Nothing left to expire: loading it again changes nothing.
  before := pg_temp.events(sop);
  perform public.expire_due_requests(sop);
  assert pg_temp.sop_status(sop) = 'draft' and pg_temp.events(sop) = before, 'A closed round is left alone';

  -- ---------- 3b. The last pending requests expire during Submit for Review ----------
  -- Both deadlines have passed but nothing has applied the expiry yet: the SOP still reads In Review.
  -- submit_for_review expires them first (withdraw_due), so the SOP is a Draft by the time it decides
  -- what kind of send this is: it reopens the round instead of refusing with "Upload a new version".
  file := file + 1;
  sop := public.create_sop('Expires during submit', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1, home2], null, null, null);
  reset role;
  update public.review_requests set response_due_at = now() - interval '1 minute' where round_id = round1;
  set local role authenticated;
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.requests(sop) = array['pending', 'pending'], 'Not expired yet';
  before := pg_temp.events(sop);
  assert public.submit_for_review(sop, array[home3], null, null, null) = round1, 'Submit for Review succeeds and reopens the round';
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.round_status(round1) = 'open', 'In Review again, the round open';
  assert pg_temp.rounds(sop) = 1, 'Still one round for the version';
  assert pg_temp.requests(sop) = array['expired', 'expired', 'pending'], 'Both expired during the call; the new request after them';
  assert pg_temp.events(sop) = pg_temp.plus(before, 'review-expired', 'review-expired', 'submitted'), 'The two expiries, then a submitted event';

  -- ---------- 4. A withdrawn (legacy) request and a removal ----------
  file := file + 1;
  sop := public.create_sop('Withdrawn and removed', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1, home2], null, null, null);
  reset role;
  update public.review_requests set status = 'withdrawn' where round_id = round1 and reviewer_id = home1;
  set local role authenticated;
  perform public.remove_reviewer(pg_temp.request_of(round1, home2), 'Not needed');
  assert pg_temp.sop_status(sop) = 'draft' and pg_temp.round_status(round1) = 'closed', 'Withdrawn and removed: back to Draft';
  assert pg_temp.requests(sop) = array['withdrawn', 'removed'], 'Both requests are kept';

  -- ---------- 5. Negative: someone is still reviewing, or finished ----------
  -- Pending and removed: still In Review, the round open.
  file := file + 1;
  sop := public.create_sop('Still pending', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1, home2], null, null, null);
  perform public.remove_reviewer(pg_temp.request_of(round1, home2), 'Not needed');
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.round_status(round1) = 'open', 'Someone pending: stays In Review';
  -- Accepted and declined: still In Review.
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.accept_review(pg_temp.request_of(round1, home1));
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.round_status(round1) = 'open', 'Someone accepted: stays In Review';
  -- Completed and removed: the round settles as before (Completed), In Review.
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.decide_review(pg_temp.request_of(round1, home1), 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.round_status(round1) = 'completed', 'Someone completed: settles as before';

  -- Returned and declined: Changes Requested, In Review.
  file := file + 1;
  sop := public.create_sop('Returned', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1, home2], null, null, null);
  perform set_config('request.jwt.claim.sub', home2::text, true);
  perform public.decline_review(pg_temp.request_of(round1, home2), 'Busy');
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.accept_review(pg_temp.request_of(round1, home1));
  perform public.decide_review(pg_temp.request_of(round1, home1), 'returned', 'Please fix section 2');
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.round_status(round1) = 'changes-requested', 'Someone returned it: settles as before';

  -- ---------- 6. Finished, then removed, doesn't count as finished ----------
  file := file + 1;
  sop := public.create_sop('Finished then removed', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1], null, null, null);
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.accept_review(pg_temp.request_of(round1, home1));
  perform public.decide_review(pg_temp.request_of(round1, home1), 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.add_reviewers(sop, array[home2], null, null, null);
  perform public.remove_reviewer(pg_temp.request_of(round1, home1), 'Not needed');
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.round_status(round1) = 'open', 'home2 is still pending';
  perform set_config('request.jwt.claim.sub', home2::text, true);
  perform public.decline_review(pg_temp.request_of(round1, home2), 'Busy');
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.sop_status(sop) = 'draft' and pg_temp.round_status(round1) = 'closed', 'A removed finisher does not count: back to Draft';
  assert pg_temp.requests(sop) = array['removed', 'declined'], 'Every request is kept';

  -- ---------- 7. Any version: the v2 round empties ----------
  file := file + 1;
  sop := public.create_sop('Second version', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1], null, null, null);
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.accept_review(pg_temp.request_of(round1, home1));
  perform public.decide_review(pg_temp.request_of(round1, home1), 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  reset role;
  update public.review_rounds set requested_at = requested_at - interval '2 minutes' where sop_id = sop;
  set local role authenticated;
  file := file + 1;
  perform public.upload_sop_version(sop, pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure v2.pdf');
  round2 := public.submit_for_review(sop, array[home3], null, null, null);
  before := pg_temp.events(sop);
  perform set_config('request.jwt.claim.sub', home3::text, true);
  perform public.decline_review(pg_temp.request_of(round2, home3), 'Busy');
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.sop_status(sop) = 'draft', 'Version 2 with nobody left: back to Draft';
  assert pg_temp.round_status(round2) = 'closed' and pg_temp.round_status(round1) = 'completed', 'Only the v2 round closes';
  assert pg_temp.events(sop) = pg_temp.plus(before, 'review-declined'), 'Only the decline event';
  before := pg_temp.events(sop);
  assert public.submit_for_review(sop, array[home1], null, null, null) = round2, 'Version 2 reopens its own round';
  assert pg_temp.sop_status(sop) = 'in-review' and pg_temp.rounds(sop) = 2, 'Still one round per version';
  assert pg_temp.round_status(round2) = 'open' and pg_temp.round_status(round1) = 'completed', 'Only the v2 round reopens';
  assert pg_temp.events(sop) = pg_temp.plus(before, 'submitted'), 'A submitted event, as for any Draft';
  -- The v1 completion doesn't count for v2: the lock is per version.
  assert not pg_temp.finished(round2), 'Nobody finished version 2';
  -- Completed in the reopened round: settles as Completed, with its event.
  before := pg_temp.events(sop);
  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.accept_review(pg_temp.request_of(round2, home1));
  perform public.decide_review(pg_temp.request_of(round2, home1), 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert pg_temp.round_status(round2) = 'completed' and pg_temp.finished(round2), 'The reopened round completes';
  assert pg_temp.events(sop) = pg_temp.plus(before, 'review-accepted', 'review-completed', 'internal-review-completed'), 'With the usual events';

  -- ---------- 7b. Back to Draft again, and reopened again ----------
  file := file + 1;
  sop := public.create_sop('Twice', 'Description', 'btd-home', pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure.pdf');
  round1 := public.submit_for_review(sop, array[home1], null, null, null);
  perform public.remove_reviewer(pg_temp.request_of(round1, home1), 'Not needed');
  assert public.submit_for_review(sop, array[home2], null, null, null) = round1, 'Reopened once';
  perform public.remove_reviewer(pg_temp.request_of(round1, home2), 'Not needed');
  assert pg_temp.sop_status(sop) = 'draft' and pg_temp.round_status(round1) = 'closed', 'Back to Draft again';
  assert public.submit_for_review(sop, array[home1], null, null, null) = round1, 'Reopened again';
  assert pg_temp.rounds(sop) = 1 and pg_temp.requests(sop) = array['removed', 'removed', 'pending'], 'One round, every request kept';

  -- ---------- 7c. A version uploaded while Draft gets its own round ----------
  perform public.remove_reviewer(pg_temp.request_of(round1, home1), 'Not needed');
  file := file + 1;
  perform public.upload_sop_version(sop, pg_temp.org_folder() || '/' || author || '/b7100000-0000-4000-8000-' || lpad(file::text, 12, '0') || '.pdf', 'Procedure v2.pdf');
  reset role;
  update public.review_rounds set requested_at = requested_at - interval '1 minute' where id = round1;
  set local role authenticated;
  round2 := public.submit_for_review(sop, array[home1], null, null, null);
  assert round2 <> round1 and pg_temp.rounds(sop) = 2, 'A new round for version 2';
  assert pg_temp.round_status(round1) = 'closed' and pg_temp.round_status(round2) = 'open', 'The v1 round stays closed';

  -- ---------- 8. Still internal ----------
  reset role;
  assert not has_function_privilege('authenticated', 'public.settle_review_round(uuid)', 'EXECUTE'), 'Internal helper';
  assert not has_function_privilege('anon', 'public.settle_review_round(uuid)', 'EXECUTE'), 'Internal helper';
end;
$$;

rollback;
