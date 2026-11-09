-- Only for a disposable LOCAL database with all migrations, never the shared Supabase project.
-- Uses the real RPCs, auth.uid(), role ACLs and RLS. Everything is rolled back at the end.
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

create function pg_temp.visible_versions(p_sop uuid) returns integer[]
language sql as $$
  select coalesce(array_agg(v.version order by v.version), '{}') from public.sop_versions v where v.sop_id = p_sop;
$$;

insert into public.departments (id, name, initials) values ('od-home', 'Home', 'HO'), ('od-other', 'Other', 'OT'), ('od-gone', 'Gone', 'GO');
insert into auth.users (id) select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 6) n;
insert into public.profiles (id, full_name, email, initials, department_id)
select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Person ' || n, 'od-' || n || '@test.invalid', 'PE',
       case when n in (1, 2, 3) then 'od-home' when n = 6 then 'od-gone' else 'od-other' end
from generate_series(1, 6) n;
update public.departments set removed_at = now() where id = 'od-gone';
insert into public.user_roles (user_id, role)
select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'reviewer'::public.app_role from generate_series(2, 6) n;
insert into public.user_roles (user_id, role) values ('a0000000-0000-4000-8000-000000000001', 'author');
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'sop-files', 'a0000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '.pdf',
       'a0000000-0000-4000-8000-000000000001', '{"mimetype":"application/pdf","size":123}'::jsonb
from generate_series(1, 3) n;

do $$
declare
  author constant uuid := 'a0000000-0000-4000-8000-000000000001';
  home1 constant uuid := 'a0000000-0000-4000-8000-000000000002';
  home2 constant uuid := 'a0000000-0000-4000-8000-000000000003';
  other1 constant uuid := 'a0000000-0000-4000-8000-000000000004';
  other2 constant uuid := 'a0000000-0000-4000-8000-000000000005';
  gone constant uuid := 'a0000000-0000-4000-8000-000000000006';
  sop uuid;
  round1 uuid;
  home_request public.review_requests;
  other_request public.review_requests;
  other2_request public.review_requests;
  closed record;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', author::text, true);
  sop := public.create_sop('Other departments', 'Description', 'od-home', author || '/b1000000-0000-4000-8000-000000000001.pdf', 'Procedure.pdf');

  -- The first send of a version: only the SOP's department, even in a mixed batch.
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L]::uuid[], null, null, null)', sop, other1), 'home-reviewers-first');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L,%L]::uuid[], null, null, null)', sop, home1, other1), 'home-reviewers-first');
  round1 := public.submit_for_review(sop, array[home1], null, null, null);

  -- Pending and accepted aren't enough: a same-department reviewer has to finish.
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', sop, other1), 'home-reviewer-must-finish');
  perform set_config('request.jwt.claim.sub', home1::text, true);
  select * into home_request from public.review_requests q where q.round_id = round1 and q.reviewer_id = home1;
  perform public.accept_review(home_request.id);
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', sop, other1), 'home-reviewer-must-finish');
  -- A same-department reviewer can always be added.
  perform public.add_reviewers(sop, array[home2], null, null, null);

  perform set_config('request.jwt.claim.sub', home1::text, true);
  perform public.decide_review(home_request.id, 'completed', null);
  assert public.can_view_version(sop, 1), 'A same-department reviewer reads what was sent to them';

  -- Now any department that still exists; a removed department's people can't be asked.
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', sop, gone), '');
  perform public.add_reviewers(sop, array[other1, other2], null, 3, null);
  select * into other_request from public.review_requests q where q.round_id = round1 and q.reviewer_id = other1;
  select * into other2_request from public.review_requests q where q.round_id = round1 and q.reviewer_id = other2;

  -- An other-department reviewer can act, and reads the version sent to them.
  perform set_config('request.jwt.claim.sub', other1::text, true);
  perform public.accept_review(other_request.id);
  assert (select count(*) from public.sops s where s.id = sop) = 1, 'A reviewer taking part can read the SOP';
  assert pg_temp.visible_versions(sop) = array[1], 'A reviewer taking part reads the version sent to them';

  -- A new version: not sent to them, so they can't read it. Same-department first again.
  perform public.decide_review(other_request.id, 'completed', 'Reviewed');
  perform set_config('request.jwt.claim.sub', home2::text, true);
  perform public.accept_review((select q.id from public.review_requests q where q.round_id = round1 and q.reviewer_id = home2));
  perform public.decide_review((select q.id from public.review_requests q where q.round_id = round1 and q.reviewer_id = home2), 'completed', null);
  perform set_config('request.jwt.claim.sub', other2::text, true);
  perform public.decline_review(other2_request.id, 'Busy');

  -- A declined other-department reviewer loses every version, and sees only their own closed request.
  assert (select count(*) from public.sops s where s.id = sop) = 0, 'Lost access hides the SOP';
  assert pg_temp.visible_versions(sop) = '{}', 'Lost access hides every version';
  assert not public.can_view_sop(sop), 'can_view_sop refuses after losing access';
  select * into closed from public.my_closed_review_requests();
  assert closed.request_id = other2_request.id and closed.sop_title = 'Other departments' and closed.version = 1 and closed.status = 'declined' and closed.reason = 'Busy', 'The closed request gives its title, version, status and reason';
  assert (select count(*) from public.my_closed_review_requests()) = 1, 'Only their own request';
  perform set_config('request.jwt.claim.sub', other1::text, true);
  assert (select count(*) from public.my_closed_review_requests()) = 0, 'Nothing for someone who kept access';
  perform set_config('request.jwt.claim.sub', home1::text, true);
  assert (select count(*) from public.my_closed_review_requests()) = 0, 'Nothing for a same-department reviewer';

  -- Asked again, the access returns.
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.add_reviewers(sop, array[other2], null, null, null);
  perform set_config('request.jwt.claim.sub', other2::text, true);
  assert pg_temp.visible_versions(sop) = array[1], 'A new request gives the access back';

  -- Removed: lost again, and a same-department reviewer who declined keeps today's access.
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.remove_reviewer((select q.id from public.review_requests q where q.round_id = round1 and q.reviewer_id = other2 order by q.seq desc limit 1), 'Not needed');
  perform set_config('request.jwt.claim.sub', other2::text, true);
  assert pg_temp.visible_versions(sop) = '{}', 'A removed other-department reviewer loses access';
  select * into closed from public.my_closed_review_requests();
  assert closed.status = 'removed' and closed.reason = 'Not needed', 'The closed request gives the removal reason';

  -- In the app each send is its own request, so the next round is always requested later. In this one
  -- test transaction now() never moves: date the earlier round back, or latest_round() would have to
  -- choose between two rounds requested "at the same time" (it orders by requested_at, then id).
  reset role;
  update public.review_rounds set requested_at = requested_at - interval '1 minute' where sop_id = sop;
  set local role authenticated;

  -- The first send of the next version is same-department only again.
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform public.upload_sop_version(sop, author || '/b1000000-0000-4000-8000-000000000002.pdf', 'Procedure.pdf');
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, array[%L,%L]::uuid[], null, null, null)', sop, home1, other1), 'home-reviewers-first');
  perform public.submit_for_review(sop, array[home1], null, null, null);

  -- Latest request decides: other1 finished v1 and keeps it, but can't read v2.
  perform set_config('request.jwt.claim.sub', other1::text, true);
  assert pg_temp.visible_versions(sop) = array[1], 'A finished reviewer keeps only the versions sent to them';

  -- Send Again to an other-department reviewer needs a same-department reviewer who finished v2.
  perform set_config('request.jwt.claim.sub', author::text, true);
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, array[%L]::uuid[], null, null, null)', sop, other1), 'home-reviewer-must-finish');
  reset role;
  update public.review_requests q set status = 'expired', expired_at = now()
  where q.reviewer_id = home1 and q.sop_id = sop and q.status = 'pending';
  insert into public.review_requests (round_id, sop_id, reviewer_id, status, expired_at)
  select r.id, sop, other1, 'expired', now() from public.review_rounds r where r.sop_id = sop and r.version = 2;
  set local role authenticated;
  perform pg_temp.expect_error(format('select public.resend_review_request(%L)',
    (select q.id from public.review_requests q where q.reviewer_id = other1 and q.status = 'expired' and q.sop_id = sop)), 'home-reviewer-must-finish');
  perform public.resend_review_request((select q.id from public.review_requests q where q.reviewer_id = home1 and q.status = 'expired' and q.sop_id = sop));
  perform set_config('request.jwt.claim.sub', other1::text, true);
  assert not public.can_view_sop(sop), 'Expired as their latest request: other1 loses access';
  assert pg_temp.visible_versions(sop) = '{}', 'Expired hides the versions they finished too';

  -- The helpers aren't for the browser.
  reset role;
  assert not has_function_privilege('authenticated', 'public.has_home_finished(uuid)', 'EXECUTE'), 'Internal helper';
  assert not has_function_privilege('authenticated', 'public.reviewer_lost_access(uuid,uuid)', 'EXECUTE'), 'Internal helper';
  assert not has_function_privilege('anon', 'public.my_closed_review_requests()', 'EXECUTE'), 'Anonymous access must stay unavailable';
end;
$$;

rollback;
