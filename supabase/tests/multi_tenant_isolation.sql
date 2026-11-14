-- The multi-tenant isolation test: two organizations, A (MedCare) and B, and proof that B can't read,
-- count, change or learn anything of A's through any table, any function the API exposes, storage, or the
-- compliance service's jobs (GVP versions and compliance checks included).
--
-- How it decides, for every function a signed-in user can call (found in the catalog: a function without a
-- case here fails the test):
--   - A function that takes an id or a path is called by B's Admin and by B's author, once with A's real
--     id(s) and once with id(s) that don't exist. The answers (result, or SQLSTATE + hint + message) must be
--     the same: then the call reveals nothing about A and changes nothing of A's. Every call is undone.
--   - A function without such an argument (lists, the caller's own organization) must return nothing of
--     A's: none of A's ids or names appear in what it returns.
-- Tables are checked with the broadest grants the API roles could have (as with Supabase's default grants):
-- B sees and counts no row of A's and changes none. Storage: B sees no file in A's folder and can't upload
-- into it. The compliance service finishing B's jobs changes nothing of A's (a fingerprint of all of A's
-- rows, before and after).
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

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
-- What a statement answers, as the current caller, always undone: its result as text, or
-- 'error <SQLSTATE> <hint> <message>'.
create function pg_temp.answer(p_sql text) returns text
language plpgsql as $$
declare v_result text; v_state text; v_hint text; v_message text;
begin
  begin
    execute 'select (' || p_sql || ')::text' into v_result;
    v_result := coalesce(v_result, '<null>');
    raise exception 'undo' using errcode = 'P0099';
  exception
    when sqlstate 'P0099' then return v_result;
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint, v_message = message_text;
      return 'error ' || v_state || ' ' || coalesce(v_hint, '') || ' ' || v_message;
  end;
end;
$$;
-- The rows of every organization table that belong to this organization, as one fingerprint (as the owner).
create function pg_temp.fingerprint(p_org uuid) returns text
language plpgsql as $$
declare t text; part text; whole text := '';
begin
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
    order by 1
  loop
    execute format('select coalesce(md5(string_agg(md5(to_jsonb(x)::text), '''' order by md5(to_jsonb(x)::text))), '''') from public.%I x where x.organization_id = %L', t, p_org)
      into part;
    whole := whole || t || ':' || part || ';';
  end loop;
  return md5(whole || coalesce((select to_jsonb(o)::text from public.organizations o where o.id = p_org), ''));
end;
$$;
grant execute on function pg_temp.act_as(uuid, text), pg_temp.as_owner(), pg_temp.answer(text), pg_temp.fingerprint(uuid) to public;

-- The broadest grants the API roles could have.
grant select, insert, update, delete on all tables in schema public to anon, authenticated;

-- ---------- A: MedCare (the seed's organization) ----------
insert into auth.users (id, email, aud, role)
select ('99000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'iso-a-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 4) n;
insert into auth.users (id, email, aud, role)
select ('99000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'iso-b-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(11, 14) n;
insert into public.divisions (id, name, description) values ('iso-a-division', 'Iso A Division', '');
update public.departments set division_id = 'iso-a-division' where id = 'regulatory-affairs';
insert into public.departments (id, name, initials) values ('iso-a-doomed', 'Iso A Doomed', 'IAD');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position") values
  ('99000000-0000-4000-8000-000000000001', 'Iso A Admin', 'iso-a-1@test.invalid', 'AA', null, '+966512345601', null),
  ('99000000-0000-4000-8000-000000000002', 'Iso A Author', 'iso-a-2@test.invalid', 'AU', 'regulatory-affairs', '+966512345602', 'Iso A Officer'),
  ('99000000-0000-4000-8000-000000000003', 'Iso A Reviewer', 'iso-a-3@test.invalid', 'AR', 'regulatory-affairs', '+966512345603', 'Iso A Officer'),
  ('99000000-0000-4000-8000-000000000004', 'Iso A Approver', 'iso-a-4@test.invalid', 'AP', 'quality-assurance', '+966512345604', 'Iso A Officer');
insert into public.user_roles (user_id, role) values
  ('99000000-0000-4000-8000-000000000001', 'admin'), ('99000000-0000-4000-8000-000000000002', 'author'),
  ('99000000-0000-4000-8000-000000000003', 'reviewer'), ('99000000-0000-4000-8000-000000000004', 'approver');
update public.organizations set super_admin_id = '99000000-0000-4000-8000-000000000001', super_admin_assigned_at = now();
insert into public.user_invitations (user_id, sent_at, sent_by)
values ('99000000-0000-4000-8000-000000000002', now() - interval '3 days', '99000000-0000-4000-8000-000000000001');

create temporary table iso on commit drop as
select o.id as a_org,
  o.id::text || '/99000000-0000-4000-8000-000000000002/99000000-0000-4000-8000-0000000000f1.pdf' as a_file,
  o.id::text || '/files/99000000-0000-4000-8000-0000000000f2.pdf' as a_gfile,
  o.id::text || '/files/99000000-0000-4000-8000-0000000000f3.pdf' as a_draft_file,
  '99000000-0000-4000-8000-0000000000aa'::uuid as b_org
from public.organizations o;
grant select on iso to public;

insert into public.sops (id, title, department_id, author_id, current_version, status) values
  ('99000000-0000-4000-8000-0000000000b1', 'Iso A Published SOP', 'regulatory-affairs', '99000000-0000-4000-8000-000000000002', 1, 'published'),
  ('99000000-0000-4000-8000-0000000000b2', 'Iso A Review SOP', 'regulatory-affairs', '99000000-0000-4000-8000-000000000002', 1, 'draft');
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
select '99000000-0000-4000-8000-0000000000b1', 1, 'iso-a.pdf', 'pdf', i.a_file, 1, '99000000-0000-4000-8000-000000000002' from iso i;
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('99000000-0000-4000-8000-0000000000b2', 1, 'iso-a-review.pdf', 'pdf', 'iso-a/review.pdf', 1, '99000000-0000-4000-8000-000000000002');
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'sop-files', i.a_file, '99000000-0000-4000-8000-000000000002', '{"mimetype": "application/pdf", "size": 1}' from iso i;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'guideline-files', i.a_gfile, '99000000-0000-4000-8000-000000000001', '{"mimetype": "application/pdf", "size": 1}' from iso i;
-- A's current GVP version (the seed's) gets a file; an added version waits in the queue.
update public.guideline_versions g set storage_path = i.a_gfile, file_size = 1 from iso i
where g.id = public.current_guideline_version(i.a_org);
insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size, created_by, processing_status)
select '99000000-0000-4000-8000-0000000000d1', 'Iso A GVP', '97.0', current_date, 'https://www.sfda.gov.sa/gvp', 'iso-a-gvp.pdf',
  i.a_draft_file, 1, '99000000-0000-4000-8000-000000000001', 'waiting' from iso i;
-- A completed compliance check with a finding, and a department deletion job.
insert into public.compliance_checks (id, sop_id, sop_version, guideline_version_id, status, engine, triggered_by, completed_at, metadata)
select '99000000-0000-4000-8000-0000000000c1', '99000000-0000-4000-8000-0000000000b1', 1, public.current_guideline_version(i.a_org),
  'completed', 'hawkim', '99000000-0000-4000-8000-000000000002', now(),
  '{"raw_results": [{"valid": true, "label": "COMPLIANT", "chunk_id": "iso-a-chunk", "text": "Iso A step", "requirement": {"id": "iso-a-req"}}]}'
from iso i;
insert into public.compliance_findings (check_id, requirement_id, result, justification, position)
select '99000000-0000-4000-8000-0000000000c1', r.id, 'compliant', 'Iso A justification', 1
from public.guideline_requirements r join iso i on r.guideline_version_id = public.current_guideline_version(i.a_org) limit 1;
insert into public.department_file_deletions (id, department_id, requested_by, sop_ids)
values ('99000000-0000-4000-8000-0000000000e1', 'iso-a-doomed', '99000000-0000-4000-8000-000000000001', '{}');

-- ---------- B: a second organization ----------
insert into public.organizations (id, name) values ('99000000-0000-4000-8000-0000000000aa', 'Iso B');
insert into public.departments (id, name, initials, requires_compliance_check, organization_id)
values ('iso-b-pv', 'Pharmacovigilance', 'PV', true, '99000000-0000-4000-8000-0000000000aa');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id) values
  ('99000000-0000-4000-8000-000000000011', 'Iso B Admin', 'iso-b-11@test.invalid', 'BA', null, '+966512345611', null, '99000000-0000-4000-8000-0000000000aa'),
  ('99000000-0000-4000-8000-000000000012', 'Iso B Author', 'iso-b-12@test.invalid', 'BU', 'iso-b-pv', '+966512345612', 'Officer', '99000000-0000-4000-8000-0000000000aa'),
  ('99000000-0000-4000-8000-000000000013', 'Iso B Reviewer', 'iso-b-13@test.invalid', 'BR', 'iso-b-pv', '+966512345613', 'Officer', '99000000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values
  ('99000000-0000-4000-8000-000000000011', 'admin'), ('99000000-0000-4000-8000-000000000012', 'author'), ('99000000-0000-4000-8000-000000000013', 'reviewer');
update public.organizations set super_admin_id = '99000000-0000-4000-8000-000000000011' where id = '99000000-0000-4000-8000-0000000000aa';
insert into public.sops (id, title, department_id, author_id, current_version)
values ('99000000-0000-4000-8000-0000000000b9', 'Iso B SOP', 'iso-b-pv', '99000000-0000-4000-8000-000000000012', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('99000000-0000-4000-8000-0000000000b9', 1, 'iso-b.pdf', 'pdf', '99000000-0000-4000-8000-0000000000aa/99000000-0000-4000-8000-000000000012/x.pdf', 1,
  '99000000-0000-4000-8000-000000000012');
insert into public.guideline_versions (id, name, version, effective_date, file_name, index_path, organization_id, added_at)
values ('99000000-0000-4000-8000-0000000000c9', 'Iso B GVP', '2.0', current_date, 'iso-b.pdf',
  '99000000-0000-4000-8000-0000000000aa/versions/99000000-0000-4000-8000-0000000000c9', '99000000-0000-4000-8000-0000000000aa', now() - interval '1 day');
insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size, created_by,
  processing_status, organization_id)
values ('99000000-0000-4000-8000-0000000000d9', 'Iso B GVP', '3.0', current_date, 'https://www.sfda.gov.sa/gvp', 'iso-b3.pdf',
  '99000000-0000-4000-8000-0000000000aa/files/99000000-0000-4000-8000-0000000000d9.pdf', 1, '99000000-0000-4000-8000-000000000011',
  'processing', '99000000-0000-4000-8000-0000000000aa');
set constraints all immediate;
set constraints all deferred;

-- A submits its review SOP to A's reviewer (a real review request of A's).
select pg_temp.act_as('99000000-0000-4000-8000-000000000002');
select public.submit_for_review('99000000-0000-4000-8000-0000000000b2', array['99000000-0000-4000-8000-000000000003'::uuid], null, null, null);
select pg_temp.as_owner();

-- ---------- The cases: every function a signed-in user can call ----------
-- {name} is replaced by A's value, or by a value that doesn't exist (same kind). targeted = false: a
-- function without such an argument, whose answer must contain nothing of A's.
-- accepted: a difference that is known and wanted, with the reason (listed, not a failure).
create temporary table iso_case (fn text, template text, targeted boolean, accepted text) on commit drop;
grant select on iso_case to public;
insert into iso_case (fn, template, targeted, accepted) values
  ('accept_review(uuid)', 'public.accept_review({request})', true, null),
  ('add_co_authors(uuid,uuid[])', 'public.add_co_authors({sop_review}, array[{author}]::uuid[])', true, null),
  ('add_co_authors(uuid,uuid[])', 'public.add_co_authors({b_sop}, array[{author}]::uuid[])', true, null),
  ('add_reviewers(uuid,uuid[],date,integer,text)', 'public.add_reviewers({sop_review}, array[{reviewer}]::uuid[], null, null, null)', true, null),
  ('add_user(uuid,text,text,text,text,text,text[])', 'public.add_user({author}, {author_email}, ''X'', ''+966512345699'', ''Officer'', {b_department}, array[''author''])', true,
   'An email that has an account is "taken" for every organization: sign-in accounts are shared by all organizations and one account belongs to one organization (decided). It tells only that the email has an account, not where.'),
  ('admin_can_read_published_sop(uuid)', 'public.admin_can_read_published_sop({sop_published})', true, null),
  ('admin_can_read_published_sop_file(text)', 'public.admin_can_read_published_sop_file({file})', true, null),
  ('admin_can_read_published_version(uuid,integer)', 'public.admin_can_read_published_version({sop_published}, 1)', true, null),
  ('attach_guideline_file(uuid,text)', 'public.attach_guideline_file({version}, {gfile})', true, null),
  ('begin_department_file_deletion(text,timestamp with time zone)', 'public.begin_department_file_deletion({department}, now())', true, null),
  ('can_manage_organization()', 'public.can_manage_organization()', false, null),
  ('can_read_organizational_structure()', 'public.can_read_organizational_structure()', false, null),
  ('can_read_review_note(uuid,uuid[])', 'public.can_read_review_note({sop_review}, array[]::uuid[])', true, null),
  ('can_read_sop_file(text)', 'public.can_read_sop_file({file})', true, null),
  ('can_view_sop(uuid)', 'public.can_view_sop({sop_published})', true, null),
  ('can_view_version(uuid,integer)', 'public.can_view_version({sop_published}, 1)', true, null),
  ('change_review_deadline(uuid,integer)', 'public.change_review_deadline({request}, 5)', true, null),
  ('check_new_user(text,text,text,text,text,text[])', 'public.check_new_user({author_email}, ''X'', ''+966512345699'', ''Officer'', {b_department}, array[''author''])', true,
   'As add_user: an email with an account is "taken" (shared sign-in accounts, one organization per account).'),
  ('check_new_user(text,text,text,text,text,text[])', 'public.check_new_user(''iso-new@test.invalid'', ''X'', ''+966512345699'', ''Officer'', {department}, array[''author''])', true, null),
  ('claim_invitation_resend(uuid)', 'public.claim_invitation_resend({author})', true, null),
  ('compliance_check_steps(uuid)', '(select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.compliance_check_steps({check}) x)', true, null),
  ('create_guideline_draft(text,text,date,text,text,text)', 'public.create_guideline_draft(''GVP'', ''99.0'', current_date, ''https://www.sfda.gov.sa/x'', {gfile}, ''x.pdf'')', true, null),
  ('create_sop(text,text,text,text,text)', 'public.create_sop(''T'', '''', {department}, {file}, ''a.pdf'')', true, null),
  ('current_organization_id()', 'public.current_organization_id()', false, null),
  ('deactivate_staff(uuid)', 'public.deactivate_staff({author})', true, null),
  ('decide_review(uuid,text,text)', 'public.decide_review({request}, ''completed'', null)', true, null),
  ('decline_review(uuid,text)', 'public.decline_review({request}, ''x'')', true, null),
  ('delete_admin(uuid)', 'public.delete_admin({admin})', true, null),
  ('delete_department(text,text,timestamp with time zone)', 'public.delete_department({department}, ''empty'', now())', true, null),
  ('delete_division(text,timestamp with time zone)', 'public.delete_division({division}, now())', true, null),
  ('delete_guideline_draft(uuid)', 'public.delete_guideline_draft({draft})', true, null),
  ('expire_due_requests(uuid)', 'public.expire_due_requests({sop_review})', true, null),
  ('finish_sample_check(uuid,text)', 'public.finish_sample_check({check}, ''completed'')', true, null),
  ('get_department_file_deletion(uuid)', 'public.get_department_file_deletion({job})', true, null),
  ('get_divisions_departments()', 'public.get_divisions_departments()', false, null),
  ('get_my_expired_invitations()', '(select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.get_my_expired_invitations() x)', false, null),
  ('get_organization_name()', 'public.get_organization_name()', false, null),
  ('get_organization_profile()', 'public.get_organization_profile()', false, null),
  ('get_organizational_structure()', 'public.get_organizational_structure()', false, null),
  ('get_super_admin_id()', 'public.get_super_admin_id()', false, null),
  ('guideline_queue_position(uuid)', 'public.guideline_queue_position({draft})', true, null),
  ('has_role(app_role)', 'public.has_role(''author'')', false, null),
  ('is_active_user()', 'public.is_active_user()', false, null),
  ('is_published_guideline_path(text)', 'public.is_published_guideline_path({gfile})', true, null),
  ('is_super_admin()', 'public.is_super_admin()', false, null),
  ('is_unused_guideline_path(text)', 'public.is_unused_guideline_path({gfile})', true, null),
  ('is_unused_sop_upload_path(text)', 'public.is_unused_sop_upload_path({file})', true, null),
  ('make_guideline_current(uuid)', 'public.make_guideline_current({draft})', true, null),
  ('mark_account_activated()', 'public.mark_account_activated()', false, null),
  ('my_closed_review_requests()', '(select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.my_closed_review_requests() x)', false, null),
  ('organizational_structure_emails()', '(select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.organizational_structure_emails() x)', false, null),
  ('reactivate_staff(uuid)', 'public.reactivate_staff({author})', true, null),
  ('record_invitation_sent(uuid)', 'public.record_invitation_sent({author})', true, null),
  ('remove_co_author(uuid,uuid)', 'public.remove_co_author({sop_review}, {author})', true, null),
  ('remove_reviewer(uuid,text)', 'public.remove_reviewer({request}, ''x'')', true, null),
  ('resend_review_request(uuid)', 'public.resend_review_request({request})', true, null),
  ('respond_to_comments(uuid,text,uuid)', 'public.respond_to_comments({sop_review}, ''x'', null)', true, null),
  ('retry_guideline_processing(uuid)', 'public.retry_guideline_processing({draft})', true, null),
  ('revert_invitation_resend(uuid,timestamp with time zone)', 'public.revert_invitation_resend({author}, now())', true, null),
  ('save_department(text,text,text,text,text,timestamp with time zone,text)', 'public.save_department({department}, ''X'', ''XY'', '''', null, now(), '''')', true, null),
  ('save_department(text,text,text,text,text,timestamp with time zone,text)', 'public.save_department(null, ''Iso New'', ''INW'', '''', {division}, null, '''')', true, null),
  ('save_division(text,text,text,text,timestamp with time zone)', 'public.save_division({division}, ''X'', '''', '''', now())', true, null),
  ('save_organization_profile(text,text,text,text,text,text)', 'public.save_organization_profile(''Iso B'', ''b@test.invalid'', ''B.'', ''Road'', null, null)', false, null),
  ('save_user(uuid,text,text,text,text,text[],text,text[])', 'public.save_user({author}, ''X'', ''+966512345699'', ''Officer'', {b_department}, array[''author''], {b_department}, array[''author''])', true, null),
  ('set_employee_positions(uuid,text[])', 'public.set_employee_positions({author}, array[''X''])', true, null),
  ('set_organization_name(text)', 'public.set_organization_name(''Iso B'')', false, null),
  ('set_user_email(uuid,text,boolean)', 'public.set_user_email({author}, ''iso-new@test.invalid'', false)', true, null),
  ('start_compliance_check(uuid)', 'public.start_compliance_check({sop_published})', true, null),
  ('submit_for_review(uuid,uuid[],date,integer,text)', 'public.submit_for_review({sop_review}, array[{reviewer}]::uuid[], null, null, null)', true, null),
  ('submit_for_review(uuid,uuid[],date,integer,text)', 'public.submit_for_review({b_sop}, array[{reviewer}]::uuid[], null, null, null)', true, null),
  ('transfer_super_admin(uuid)', 'public.transfer_super_admin({admin})', true, null),
  ('update_admin(uuid,text,text)', 'public.update_admin({admin}, ''X'', ''+966512345699'')', true, null),
  ('update_guideline_draft(uuid,text,text,date,text)', 'public.update_guideline_draft({draft}, ''X'', ''98.0'', current_date, ''https://www.sfda.gov.sa/x'')', true, null),
  ('update_guideline_version(uuid,text,date,text)', 'public.update_guideline_version({version}, ''X'', current_date, ''https://www.sfda.gov.sa/x'')', true, null),
  ('update_sop_description(uuid,text)', 'public.update_sop_description({sop_review}, ''x'')', true, null),
  ('update_sop_details(uuid,text,text)', 'public.update_sop_details({sop_review}, ''x'', '''')', true, null),
  ('update_user_details(uuid,text,text,text)', 'public.update_user_details({author}, ''X'', ''+966512345699'', ''Officer'')', true, null),
  ('upload_sop_version(uuid,text,text)', 'public.upload_sop_version({sop_review}, {file}, ''a.pdf'')', true, null),
  ('withdraw_due_requests(uuid)', 'public.withdraw_due_requests({sop_review})', true, null);

create temporary table iso_finding (role text, fn text, template text, finding text) on commit drop;
create temporary table iso_accepted (role text, fn text, reason text, difference text) on commit drop;
grant insert, select on iso_finding, iso_accepted to public;

do $$
declare
  i record;
  c record;
  caller record;
  a_values jsonb;
  b_values jsonb;
  unknown jsonb;
  sql_a text;
  sql_unknown text;
  answer_a text;
  answer_unknown text;
  missing text;
  markers text[];
  marker text;
  k text;
begin
  select * into i from iso;

  -- Every function a signed-in user can call has a case.
  select string_agg(p.oid::regprocedure::text, ', ') into missing
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', p.oid, 'execute')
    and replace(p.oid::regprocedure::text, 'public.', '') not in (select fn from iso_case);
  assert missing is null, 'Functions without an isolation case: ' || missing;
  -- Anonymous callers can call nothing but current_organization_id().
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and has_function_privilege('anon', p.oid, 'execute') and p.proname <> 'current_organization_id'), 'anon can call more than current_organization_id';

  a_values := jsonb_build_object(
    'request', (select q.id from public.review_requests q where q.sop_id = '99000000-0000-4000-8000-0000000000b2' limit 1),
    'sop_review', '99000000-0000-4000-8000-0000000000b2', 'sop_published', '99000000-0000-4000-8000-0000000000b1',
    'author', '99000000-0000-4000-8000-000000000002', 'reviewer', '99000000-0000-4000-8000-000000000003',
    'admin', '99000000-0000-4000-8000-000000000001', 'author_email', 'iso-a-2@test.invalid',
    'check', '99000000-0000-4000-8000-0000000000c1', 'version', public.current_guideline_version(i.a_org),
    'draft', '99000000-0000-4000-8000-0000000000d1', 'job', '99000000-0000-4000-8000-0000000000e1',
    'department', 'regulatory-affairs', 'division', 'iso-a-division', 'file', i.a_file, 'gfile', i.a_gfile);
  assert a_values->>'request' is not null, 'A has a review request';
  b_values := jsonb_build_object('b_sop', '99000000-0000-4000-8000-0000000000b9', 'b_department', 'iso-b-pv');
  -- A's ids and names: none may appear in what B is told.
  markers := array(select value from jsonb_each_text(a_values)) || array['Iso A', 'iso-a-', i.a_org::text,
    (select name from public.organizations where id = i.a_org)];

  for caller in select * from (values ('B Admin', '99000000-0000-4000-8000-000000000011'::uuid), ('B author', '99000000-0000-4000-8000-000000000012'::uuid)) v(role, id) loop
    for c in select * from iso_case loop
      -- What doesn't exist, of the same kind (new for every call).
      unknown := jsonb_build_object(
        'request', gen_random_uuid(), 'sop_review', gen_random_uuid(), 'sop_published', gen_random_uuid(), 'author', gen_random_uuid(),
        'reviewer', gen_random_uuid(), 'admin', gen_random_uuid(), 'author_email', 'iso-nobody-' || gen_random_uuid() || '@test.invalid',
        'check', gen_random_uuid(), 'version', gen_random_uuid(), 'draft', gen_random_uuid(), 'job', gen_random_uuid(),
        'department', 'department-' || gen_random_uuid(), 'division', 'division-' || gen_random_uuid(),
        'file', i.a_org::text || '/99000000-0000-4000-8000-000000000002/' || gen_random_uuid() || '.pdf',
        'gfile', i.a_org::text || '/files/' || gen_random_uuid() || '.pdf');
      sql_a := c.template;
      sql_unknown := c.template;
      for k in select jsonb_object_keys(b_values) loop
        sql_a := replace(sql_a, '{' || k || '}', quote_literal(b_values->>k));
        sql_unknown := replace(sql_unknown, '{' || k || '}', quote_literal(b_values->>k));
      end loop;
      for k in select jsonb_object_keys(a_values) loop
        sql_a := replace(sql_a, '{' || k || '}', quote_literal(a_values->>k));
        sql_unknown := replace(sql_unknown, '{' || k || '}', quote_literal(unknown->>k));
      end loop;

      perform pg_temp.act_as(caller.id);
      answer_a := pg_temp.answer(sql_a);
      if c.targeted then
        answer_unknown := pg_temp.answer(sql_unknown);
      end if;
      perform pg_temp.as_owner();

      if c.targeted and answer_a is distinct from answer_unknown then
        if c.accepted is not null then
          insert into iso_accepted values (caller.role, c.fn, c.accepted,
            'A''s id: ' || left(answer_a, 120) || ' | unknown id: ' || left(answer_unknown, 120));
        else
          insert into iso_finding values (caller.role, c.fn, c.template,
            'A''s id: ' || left(answer_a, 200) || ' | unknown id: ' || left(answer_unknown, 200));
        end if;
      end if;
      foreach marker in array markers loop
        if marker is not null and position(lower(marker) in lower(answer_a)) > 0 then
          insert into iso_finding values (caller.role, c.fn, c.template, 'answer contains A''s ' || marker || ': ' || left(answer_a, 200));
        end if;
      end loop;
    end loop;
  end loop;
end;
$$;

-- The accepted differences (known and wanted), then every finding at once; fail if there is any finding.
select distinct fn, reason from iso_accepted order by fn;
select role, fn, finding from iso_finding order by fn, role;
do $$
begin
  assert not exists (select 1 from iso_finding), (select count(*) || ' isolation finding(s), listed above' from iso_finding);
end;
$$;

-- ---------- Tables, storage and the compliance service ----------
do $$
declare
  i record;
  t text;
  n bigint;
  before_a text;
begin
  select * into i from iso;
  -- B (each role) sees and counts no row of A's in any table, and changes none.
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'organization_id' and not a.attisdropped)
  loop
    foreach n in array array[1] loop
      perform pg_temp.act_as('99000000-0000-4000-8000-000000000011');
      execute format('select count(*) from public.%I where organization_id is distinct from %L', t, i.b_org) into n;
      assert n = 0, 'B''s Admin counts ' || n || ' rows of another organization in ' || t;
      execute format('update public.%I set organization_id = organization_id where organization_id = %L', t, i.a_org);
      get diagnostics n = row_count;
      assert n = 0, 'B''s Admin updated ' || n || ' of A''s rows in ' || t;
      execute format('delete from public.%I where organization_id = %L', t, i.a_org);
      get diagnostics n = row_count;
      assert n = 0, 'B''s Admin deleted ' || n || ' of A''s rows in ' || t;
      perform pg_temp.act_as('99000000-0000-4000-8000-000000000012');
      execute format('select count(*) from public.%I where organization_id is distinct from %L', t, i.b_org) into n;
      assert n = 0, 'B''s author counts ' || n || ' rows of another organization in ' || t;
      perform pg_temp.act_as(null, 'anon');
      execute format('select count(*) from public.%I', t) into n;
      assert n = 0, 'anon counts ' || n || ' rows in ' || t;
      perform pg_temp.as_owner();
    end loop;
  end loop;
  perform pg_temp.act_as('99000000-0000-4000-8000-000000000011');
  assert (select count(*) from public.organizations) = 0, 'organizations is read only through functions';
  -- Storage: none of A's files, and no upload into A's folder.
  assert not exists (select 1 from storage.objects where name like i.a_org::text || '/%'), 'B sees a file of A''s folder';
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('guideline-files', i.a_org::text || '/files/' || gen_random_uuid() || '.pdf',
      '99000000-0000-4000-8000-000000000011');
    assert false, 'B uploaded into A''s folder';
  exception when insufficient_privilege then null;
  end;
  perform pg_temp.as_owner();

  -- The compliance service finishing B's jobs changes nothing of A's.
  before_a := pg_temp.fingerprint(i.a_org);
  perform pg_temp.act_as(null, 'service_role');
  perform public.complete_guideline_processing('99000000-0000-4000-8000-0000000000d9',
    i.b_org::text || '/versions/99000000-0000-4000-8000-0000000000d9', '{}'::jsonb);
  perform pg_temp.as_owner();
  assert public.current_guideline_version(i.b_org) = (select id from public.guideline_versions where draft_id = '99000000-0000-4000-8000-0000000000d9'),
    'B''s new version is B''s current one';
  insert into public.compliance_checks (id, sop_id, sop_version, guideline_version_id, status, engine, triggered_by)
  values ('99000000-0000-4000-8000-0000000000c8', '99000000-0000-4000-8000-0000000000b9', 1, public.current_guideline_version(i.b_org),
    'running', 'hawkim', '99000000-0000-4000-8000-000000000012');
  perform pg_temp.act_as(null, 'service_role');
  perform public.complete_compliance_check('99000000-0000-4000-8000-0000000000c8',
    '[{"requirement_code": "R1", "module": "I", "section": "1", "section_title": "S", "short_title": "T", "page": 1,
       "requirement_text": "Iso B requirement", "result": "compliant", "justification": "Iso B"}]'::jsonb, 'test', '{}'::jsonb);
  perform pg_temp.as_owner();
  assert (select status from public.compliance_checks where id = '99000000-0000-4000-8000-0000000000c8') = 'completed';
  assert (select count(*) from public.guideline_requirements r join public.compliance_findings f on f.requirement_id = r.id
          where f.check_id = '99000000-0000-4000-8000-0000000000c8' and r.organization_id = i.b_org) = 1, 'B''s requirement, in B';
  assert pg_temp.fingerprint(i.a_org) = before_a, 'B''s jobs changed something of A''s';
end;
$$;

rollback;
