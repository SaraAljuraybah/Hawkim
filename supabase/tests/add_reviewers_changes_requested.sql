-- Only for a disposable LOCAL database with all migrations, never the shared Supabase project.
-- Uses the real RPCs, auth.uid(), role ACLs and RLS. Everything is rolled back at the end.
--
-- 20261106140000_add_reviewers_changes_requested.sql: the main author sends v1 to Noura and Omar.
-- Noura returns it with a comment and Omar's request expires, so the round is Changes Requested.
-- The author can then add a reviewer, and send Omar's request again; each reopens the round, and no
-- new version can be uploaded while anyone is taking part. Once everyone has finished, the round is
-- Changes Requested again (Noura's return is still there) and a new version can be uploaded.
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

-- 1 author, 2 Noura (home), 3 Omar (home), 4 Huda (other department), 5 another author, 6 co-author.
insert into public.departments (id, name, initials) values ('acr-home', 'Home', 'HO'), ('acr-other', 'Other', 'OT');
insert into auth.users (id) select ('c4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 6) n;
insert into public.profiles (id, full_name, email, initials, department_id)
select ('c4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Person ' || n, 'acr-' || n || '@test.invalid', 'PE',
       case when n = 4 then 'acr-other' else 'acr-home' end
from generate_series(1, 6) n;
insert into public.user_roles (user_id, role)
select ('c4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'reviewer'::public.app_role from generate_series(2, 4) n;
insert into public.user_roles (user_id, role)
select ('c4000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'author'::public.app_role from unnest(array[1, 5, 6]) n;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'sop-files', 'c4000000-0000-4000-8000-000000000001/c4100000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.pdf',
       'c4000000-0000-4000-8000-000000000001', '{"mimetype":"application/pdf","size":123}'::jsonb
from generate_series(1, 2) n;

do $$
declare
  author constant uuid := 'c4000000-0000-4000-8000-000000000001';
  noura constant uuid := 'c4000000-0000-4000-8000-000000000002';
  omar constant uuid := 'c4000000-0000-4000-8000-000000000003';
  huda constant uuid := 'c4000000-0000-4000-8000-000000000004';
  other_author constant uuid := 'c4000000-0000-4000-8000-000000000005';
  co_author constant uuid := 'c4000000-0000-4000-8000-000000000006';
  v_sop uuid;
  v_round uuid;
  v_noura public.review_requests;
  v_omar_expired public.review_requests;
  v_omar_resent public.review_requests;
  v_huda public.review_requests;
  v_round_row public.review_rounds;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', author::text, true);
  v_sop := public.create_sop('Changes Requested', 'Description', 'acr-home', author || '/c4100000-0000-4000-8000-000000000001.pdf', 'Procedure.pdf');
  perform public.add_co_authors(v_sop, array[co_author]);
  v_round := public.submit_for_review(v_sop, array[noura, omar], null, null, null);

  -- Noura accepts and returns it with a comment.
  perform set_config('request.jwt.claim.sub', noura::text, true);
  select * into v_noura from public.review_requests q where q.round_id = v_round and q.reviewer_id = noura;
  perform public.accept_review(v_noura.id);
  perform public.decide_review(v_noura.id, 'returned', 'Send it to Huda, it is her specialty.');

  -- Omar never responds: his response deadline passes and the request expires.
  reset role;
  update public.review_requests set response_due_at = now() - interval '1 minute'
  where round_id = v_round and reviewer_id = omar and status = 'pending';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.expire_due_requests(v_sop);
  select * into v_omar_expired from public.review_requests q where q.round_id = v_round and q.reviewer_id = omar;
  assert v_omar_expired.status = 'expired', 'Omar''s request expired';
  select * into v_round_row from public.review_rounds r where r.id = v_round;
  assert v_round_row.status = 'changes-requested' and v_round_row.closed_at is not null, 'Everyone finished and Noura returned it: Changes Requested';

  -- Still refused: someone other than the main author, and a reviewer who already has a request.
  perform set_config('request.jwt.claim.sub', co_author::text, true);
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', v_sop, huda), '');
  perform pg_temp.expect_error(format('select public.resend_review_request(%L)', v_omar_expired.id), '');
  perform set_config('request.jwt.claim.sub', other_author::text, true);
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', v_sop, huda), '');
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', v_sop, noura), '');
  -- Omar's latest request expired: Resend is for him, not Add Reviewers.
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', v_sop, omar), '');

  -- The author adds Huda (another department: Noura, from the SOP's department, has finished).
  perform public.add_reviewers(v_sop, array[huda], null, null, null);
  select * into v_round_row from public.review_rounds r where r.id = v_round;
  assert v_round_row.status = 'open' and v_round_row.closed_at is null, 'Adding a reviewer reopens the round';
  select * into v_huda from public.review_requests q where q.round_id = v_round and q.reviewer_id = huda;
  assert v_huda.status = 'pending', 'Huda has a pending request';
  assert exists (select 1 from public.timeline_events e where e.sop_id = v_sop and e.type = 'submitted' and e.recipient_ids = array[huda]),
    'Adding a reviewer is in the timeline, sent to Huda';

  -- The author sends Omar's request again: it reopens the round too.
  perform public.resend_review_request(v_omar_expired.id);
  select * into v_omar_resent from public.review_requests q where q.round_id = v_round and q.reviewer_id = omar order by q.seq desc limit 1;
  assert v_omar_resent.id <> v_omar_expired.id and v_omar_resent.status = 'pending', 'Omar has a new pending request';
  assert (select q.status from public.review_requests q where q.id = v_omar_expired.id) = 'expired', 'The expired request stays in the history';
  assert exists (select 1 from public.timeline_events e where e.sop_id = v_sop and e.type = 'review-request-resent' and e.recipient_ids = array[omar]),
    'Sending again is in the timeline, sent to Omar';
  reset role;
  assert v_omar_resent.response_due_at = public.hawkim_review_response_due_at(v_omar_resent.assigned_at),
    'Omar gets a new 2-working-day response deadline';
  assert v_omar_resent.response_due_at > now(), 'The new response deadline is in the future';
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', author::text, true);
  select * into v_round_row from public.review_rounds r where r.id = v_round;
  assert v_round_row.status = 'open', 'The round is open while Huda and Omar take part';

  -- While anyone is taking part, no new version.
  perform pg_temp.expect_error(format('select public.upload_sop_version(%L, %L, %L)', v_sop,
    author || '/c4100000-0000-4000-8000-000000000002.pdf', 'Procedure.pdf'), '');

  -- Huda completes it; Omar is still taking part, so the round stays open and still no new version.
  perform set_config('request.jwt.claim.sub', huda::text, true);
  perform public.accept_review(v_huda.id);
  perform public.decide_review(v_huda.id, 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  assert (select r.status from public.review_rounds r where r.id = v_round) = 'open', 'Open while Omar takes part';
  perform pg_temp.expect_error(format('select public.upload_sop_version(%L, %L, %L)', v_sop,
    author || '/c4100000-0000-4000-8000-000000000002.pdf', 'Procedure.pdf'), '');

  -- Omar completes it: everyone has finished, and Noura's return is still there.
  perform set_config('request.jwt.claim.sub', omar::text, true);
  perform public.accept_review(v_omar_resent.id);
  perform public.decide_review(v_omar_resent.id, 'completed', null);
  perform set_config('request.jwt.claim.sub', author::text, true);
  select * into v_round_row from public.review_rounds r where r.id = v_round;
  assert v_round_row.status = 'changes-requested' and v_round_row.closed_at is not null, 'Changes Requested again';
  assert (select q.status from public.latest_requests(v_round) q where q.reviewer_id = noura) = 'returned', 'Noura''s return is still her latest request';
  assert not exists (select 1 from public.timeline_events e where e.review_round_id = v_round and e.type = 'internal-review-completed'),
    'Not completed: someone returned it';

  -- A new version can be uploaded now; the v1 round can't be added to or sent again any more.
  assert public.upload_sop_version(v_sop, author || '/c4100000-0000-4000-8000-000000000002.pdf', 'Procedure.pdf') = 2, 'Version 2 uploaded';
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', v_sop, huda), '');

  -- The same privileges as before.
  reset role;
  assert not has_function_privilege('anon', 'public.add_reviewers(uuid,uuid[],date,integer,text)', 'EXECUTE'), 'add_reviewers: not anon';
  assert has_function_privilege('authenticated', 'public.add_reviewers(uuid,uuid[],date,integer,text)', 'EXECUTE'), 'add_reviewers: authenticated';
  assert not has_function_privilege('anon', 'public.resend_review_request(uuid)', 'EXECUTE'), 'resend_review_request: not anon';
  assert has_function_privilege('authenticated', 'public.resend_review_request(uuid)', 'EXECUTE'), 'resend_review_request: authenticated';
end;
$$;

rollback;
