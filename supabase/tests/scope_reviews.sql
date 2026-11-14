-- Tests for 20261116190000_scope_reviews.sql: internal review stays within one organization. A reviewer
-- of another organization can't be asked, and nobody of another organization can accept, decline,
-- decide, remove, resend, re-time, submit, add to or answer another organization's review.
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

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
grant execute on function pg_temp.expect_error(text, text, text), pg_temp.act_as(uuid, text), pg_temp.as_owner() to public;

-- MedCare: an author and a reviewer in Regulatory Affairs (no compliance check needed), and a draft SOP.
-- Other: an author and a reviewer.
insert into auth.users (id, email, aud, role)
select ('98500000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'rev-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 4) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position") values
  ('98500000-0000-4000-8000-000000000001', 'Rev Med Author', 'rev-1@test.invalid', 'MA', 'regulatory-affairs', '+966512345601', 'Officer'),
  ('98500000-0000-4000-8000-000000000002', 'Rev Med Reviewer', 'rev-2@test.invalid', 'MR', 'regulatory-affairs', '+966512345602', 'Officer');
insert into public.user_roles (user_id, role) values
  ('98500000-0000-4000-8000-000000000001', 'author'), ('98500000-0000-4000-8000-000000000002', 'reviewer');
insert into public.sops (id, title, department_id, author_id, current_version)
values ('98500000-0000-4000-8000-0000000000b1', 'Rev Med SOP', 'regulatory-affairs', '98500000-0000-4000-8000-000000000001', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('98500000-0000-4000-8000-0000000000b1', 1, 'rev.pdf', 'pdf', 'rev-test/rev.pdf', 1, '98500000-0000-4000-8000-000000000001');

insert into public.organizations (id, name) values ('98500000-0000-4000-8000-0000000000aa', 'Rev Other');
insert into public.departments (id, name, initials, organization_id)
values ('rev-other-ra', 'Regulatory Affairs', 'RA', '98500000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('98500000-0000-4000-8000-000000000003', 'Rev Other Author', 'rev-3@test.invalid', 'OA', 'rev-other-ra', '+966512345603', 'Officer', '98500000-0000-4000-8000-0000000000aa'),
  ('98500000-0000-4000-8000-000000000004', 'Rev Other Reviewer', 'rev-4@test.invalid', 'OR', 'rev-other-ra', '+966512345604', 'Officer', '98500000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('98500000-0000-4000-8000-000000000003', 'author'), ('98500000-0000-4000-8000-000000000004', 'reviewer');
set constraints all immediate;
set constraints all deferred;

do $$
declare
  med_author constant uuid := '98500000-0000-4000-8000-000000000001';
  med_reviewer constant uuid := '98500000-0000-4000-8000-000000000002';
  other_author constant uuid := '98500000-0000-4000-8000-000000000003';
  other_reviewer constant uuid := '98500000-0000-4000-8000-000000000004';
  med_sop constant uuid := '98500000-0000-4000-8000-0000000000b1';
  v_request uuid;
begin
  -- ---------- A reviewer of another organization can't be asked ----------
  assert not public.is_eligible_reviewer(med_sop, other_reviewer), 'Other''s reviewer is not eligible for a MedCare SOP';
  assert public.is_eligible_reviewer(med_sop, med_reviewer), 'MedCare''s reviewer is';
  perform pg_temp.act_as(med_author);
  perform pg_temp.expect_error(format('select public.submit_for_review(%L, %L, null, null, null)', med_sop, array[other_reviewer]), '23514');
  perform public.submit_for_review(med_sop, array[med_reviewer], null, null, null);
  perform pg_temp.as_owner();
  select q.id into v_request from public.review_requests q where q.sop_id = med_sop and q.reviewer_id = med_reviewer;
  assert v_request is not null, 'the review was requested';

  -- ---------- Another organization's reviewer: the request "doesn't exist" ----------
  perform pg_temp.act_as(other_reviewer);
  perform pg_temp.expect_error(format('select public.accept_review(%L)', v_request), 'P0002');
  perform pg_temp.expect_error(format('select public.decline_review(%L, %L)', v_request, 'Taken'), 'P0002');
  perform pg_temp.expect_error(format('select public.decide_review(%L, %L, %L)', v_request, 'completed', null), 'P0002');

  -- ---------- Another organization's author: unknown request and SOP ----------
  perform pg_temp.act_as(other_author);
  perform pg_temp.expect_error(format('select public.remove_reviewer(%L, %L)', v_request, 'Taken'), '42501');
  perform pg_temp.expect_error(format('select public.resend_review_request(%L)', v_request), 'P0002');
  perform pg_temp.expect_error(format('select public.change_review_deadline(%L, 5)', v_request), 'P0002');
  perform pg_temp.expect_error(format('select public.add_reviewers(%L, %L, null, null, null)', med_sop, array[other_reviewer]), '42501');
  perform pg_temp.expect_error(format('select public.respond_to_comments(%L, %L, null)', med_sop, 'Taken'), '42501');
  assert not exists (select 1 from public.my_closed_review_requests() c where c.request_id = v_request), 'not in their closed requests';
  perform pg_temp.expect_error(format('select public.expire_due_requests(%L)', med_sop), '42501');

  -- ---------- Nothing of MedCare's review changed; MedCare's reviewer still can act ----------
  perform pg_temp.as_owner();
  assert (select status from public.review_requests where id = v_request) = 'pending', 'the request is untouched';
  assert (select status from public.sops where id = med_sop) = 'in-review';
  perform pg_temp.act_as(med_reviewer);
  perform public.accept_review(v_request);
  perform pg_temp.as_owner();
  assert (select status from public.review_requests where id = v_request) = 'accepted', 'MedCare''s reviewer accepts it';
end;
$$;

rollback;
