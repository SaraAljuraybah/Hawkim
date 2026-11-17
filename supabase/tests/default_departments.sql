-- Tests for 20261120120000_default_departments.sql: every organization's Pharmacovigilance and Quality Assurance
-- departments are created with the organization, marked with their system keys, and can't be deleted or renamed by
-- any path; their description, email and division can still change. Also: a new organization starts with no
-- regulatory guideline (Task 2), and ordinary departments keep their behaviour.
-- Only for a disposable LOCAL database with every migration and the seed applied. Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text, p_hint text default null) returns void
language plpgsql as $$
declare v_state text; v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    assert v_state = p_state, format('Expected %s from %s, got %s (%s)', p_state, p_sql, v_state, sqlerrm);
    assert p_hint is null or v_hint = p_hint, format('Expected hint %s from %s, got %s', p_hint, p_sql, v_hint);
    return;
  end;
  assert false, 'Expected ' || p_state || ' from ' || p_sql;
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

-- Two Request Hawkim applications, accepted as the access-requests Edge Function does (service_role).
insert into public.access_requests (id, organization, contact_name, email, phone, approx_users, review_token_hash, review_expires_at)
values
  ('9d000000-0000-4000-8000-0000000000a1', 'DD One Pharma', 'One Admin', 'dd-one@test.invalid', '+966500000001', 10, repeat('1', 64), now() + interval '1 day'),
  ('9d000000-0000-4000-8000-0000000000a2', 'DD Two Pharma', 'Two Admin', 'dd-two@test.invalid', '+966500000002', 10, repeat('2', 64), now() + interval '1 day');
insert into auth.users (id, email, aud, role) values
  ('9d000000-0000-4000-8000-000000000001', 'dd-one@test.invalid', 'authenticated', 'authenticated'),
  ('9d000000-0000-4000-8000-000000000002', 'dd-two@test.invalid', 'authenticated', 'authenticated');

-- MedCare's state before the new organizations exist, to compare afterwards.
create temporary table dd_before on commit drop as
select (select count(*) from public.departments) as departments,
       (select count(*) from public.guideline_versions) as versions,
       (select count(*) from public.guideline_requirements) as requirements,
       (select count(*) from public.guideline_version_drafts) as drafts,
       (select count(*) from public.compliance_checks) as checks,
       (select count(*) from public.profiles where department_id is not null) as assigned;

do $$
declare
  medcare uuid := (select o.id from public.organizations o where o.access_request_id is null order by o.created_at, o.id limit 1);
  one_admin constant uuid := '9d000000-0000-4000-8000-000000000001';
  two_admin constant uuid := '9d000000-0000-4000-8000-000000000002';
  one_org uuid; two_org uuid;
  one_pv public.departments; one_qa public.departments; two_pv public.departments;
  v_division_a text; v_division_b text; v_stamp timestamptz; v_ordinary text; v_before public.departments;
begin
  -- ---------- Existing organizations: MedCare's defaults are marked, nothing else changed ----------
  assert (select system_key from public.departments where id = 'pharmacovigilance') = 'pharmacovigilance', 'MedCare PV is marked';
  assert (select system_key from public.departments where id = 'quality-assurance') = 'quality-assurance', 'MedCare QA is marked';
  assert (select count(*) from public.departments where organization_id = medcare and system_key is not null) = 2, 'only two in MedCare';
  assert (select requires_compliance_check and not is_quality and initials = 'PV' from public.departments where id = 'pharmacovigilance');
  assert (select is_quality and not requires_compliance_check and initials = 'QA' from public.departments where id = 'quality-assurance');
  assert not exists (select 1 from public.profiles p left join public.departments d on d.id = p.department_id
    where p.department_id is not null and d.id is null), 'every employee''s department still exists';

  -- ---------- New organizations get their own two default departments ----------
  perform pg_temp.act_as(null, 'service_role');
  perform public.accept_access_request('9d000000-0000-4000-8000-0000000000a1', repeat('1', 64), one_admin, null);
  perform public.accept_access_request('9d000000-0000-4000-8000-0000000000a2', repeat('2', 64), two_admin, null);
  perform pg_temp.as_owner();
  one_org := (select organization_id from public.profiles where id = one_admin);
  two_org := (select organization_id from public.profiles where id = two_admin);
  assert one_org is not null and two_org is not null and one_org <> two_org and one_org <> medcare, 'two new organizations';
  select * into one_pv from public.departments where organization_id = one_org and system_key = 'pharmacovigilance';
  select * into one_qa from public.departments where organization_id = one_org and system_key = 'quality-assurance';
  select * into two_pv from public.departments where organization_id = two_org and system_key = 'pharmacovigilance';
  assert (select count(*) from public.departments where organization_id = one_org) = 2, 'exactly two departments';
  assert (select count(*) from public.departments where organization_id = two_org and system_key is not null) = 2;
  assert one_pv.name = 'Pharmacovigilance' and one_pv.initials = 'PV' and one_pv.requires_compliance_check and not one_pv.is_quality
    and one_pv.removed_at is null, 'PV configuration';
  assert one_qa.name = 'Quality Assurance' and one_qa.initials = 'QA' and one_qa.is_quality and not one_qa.requires_compliance_check
    and one_qa.removed_at is null, 'QA configuration';
  -- 20261124120000: each is in one of the organization's two default divisions (MedCare's names and descriptions, no email).
  assert (select v.name = 'Regulatory and Drug Safety' and v.description = 'Regulatory Affairs and Drug Safety Division' and v.email is null
    and v.is_active and v.organization_id = one_org from public.divisions v where v.id = one_pv.division_id), 'PV in Regulatory and Drug Safety';
  assert (select v.name = 'Quality and Compliance' and v.description = 'Governance, Quality Assurance and Compliance Division' and v.email is null
    and v.is_active and v.organization_id = one_org from public.divisions v where v.id = one_qa.division_id), 'QA in Quality and Compliance';
  assert (select count(*) from public.divisions where organization_id = one_org) = 2, 'exactly two divisions';
  assert two_pv.name = one_pv.name and two_pv.id <> one_pv.id and two_pv.id <> 'pharmacovigilance', 'same name, own row per organization';
  assert (select count(*) from public.departments) = (select departments from dd_before) + 4, 'only the four new departments were added';

  -- ---------- A new organization starts without any regulatory guideline ----------
  assert not exists (select 1 from public.guideline_versions where organization_id in (one_org, two_org)), 'no guideline versions';
  assert not exists (select 1 from public.guideline_version_drafts where organization_id in (one_org, two_org)), 'no added versions';
  assert not exists (select 1 from public.guideline_requirements where organization_id in (one_org, two_org)), 'no requirements';
  assert public.current_guideline_version(one_org) is null and public.current_guideline_version(medcare) is not null;
  assert (select count(*) from public.guideline_versions) = (select versions from dd_before)
    and (select count(*) from public.guideline_requirements) = (select requirements from dd_before)
    and (select count(*) from public.guideline_version_drafts) = (select drafts from dd_before)
    and (select count(*) from public.compliance_checks) = (select checks from dd_before), 'MedCare''s guidelines and checks are unchanged';

  -- ---------- Permitted edits: description, email, division (moved between divisions) ----------
  perform pg_temp.act_as(one_admin);
  v_division_a := public.save_division(null, 'DD Division A', 'First division', 'a@dd.test', null);
  v_division_b := public.save_division(null, 'DD Division B', 'Second division', 'b@dd.test', null);
  perform public.save_department(one_pv.id, 'Pharmacovigilance', 'PV', 'Drug safety', v_division_a, one_pv.updated_at, 'pv@dd.test');
  perform pg_temp.as_owner();
  select * into one_pv from public.departments where id = one_pv.id;
  assert one_pv.division_id = v_division_a and one_pv.description = 'Drug safety' and one_pv.email = 'pv@dd.test', 'details saved';
  assert one_pv.system_key = 'pharmacovigilance' and one_pv.name = 'Pharmacovigilance', 'still the default department';
  perform pg_temp.act_as(one_admin);
  perform public.save_department(one_pv.id, 'Pharmacovigilance', 'PV', 'Drug safety team', v_division_b, one_pv.updated_at, 'safety@dd.test');
  perform pg_temp.as_owner();
  select * into one_pv from public.departments where id = one_pv.id;
  assert one_pv.division_id = v_division_b and one_pv.email = 'safety@dd.test', 'moved to another division';

  -- ---------- Refused: renaming (and the generated initials) through save_department ----------
  perform pg_temp.act_as(one_admin);
  perform pg_temp.expect_error(format('select public.save_department(%L, %L, %L, %L, %L, %L, %L)', one_pv.id, 'Drug Safety', 'DS',
    'x', v_division_b, one_pv.updated_at, 'pv@dd.test'), '23514', 'default-department');
  perform pg_temp.expect_error(format('select public.save_department(%L, %L, %L, %L, %L, %L, %L)', one_pv.id, 'pharmacovigilance', 'PV',
    'x', v_division_b, one_pv.updated_at, 'pv@dd.test'), '23514', 'default-department');
  perform pg_temp.expect_error(format('select public.save_department(%L, %L, %L, %L, %L, %L, %L)', one_qa.id, 'Quality Assurance', 'QX',
    'x', one_qa.division_id, one_qa.updated_at, 'qa@dd.test'), '23514', 'default-department');
  -- A stale form still gets "refresh and try again" first.
  perform pg_temp.expect_error(format('select public.save_department(%L, %L, %L, %L, %L, %L, %L)', one_pv.id, 'Drug Safety', 'DS',
    'x', v_division_b, now() - interval '1 day', 'pv@dd.test'), 'P0001', 'conflict');

  -- ---------- Refused: deleting, by the RPC and by the Edge Function's function ----------
  perform pg_temp.expect_error(format('select public.delete_department(%L, %L, %L)', one_qa.id, 'empty', one_qa.updated_at), 'P0001', 'default-department');
  perform pg_temp.expect_error(format('select public.delete_department(%L, %L, %L)', one_qa.id, 'others', one_qa.updated_at), 'P0001', 'default-department');
  perform pg_temp.expect_error(format('select public.begin_department_file_deletion(%L, %L)', one_qa.id, one_qa.updated_at), 'P0001', 'default-department');
  -- Direct writes by a signed-in user: no grant.
  perform pg_temp.expect_error(format('update public.departments set name = %L where id = %L', 'X', one_pv.id), '42501');
  perform pg_temp.expect_error(format('delete from public.departments where id = %L', one_pv.id), '42501');
  perform pg_temp.as_owner();
  assert (select removed_at is null and deletion_job_id is null from public.departments where id = one_qa.id), 'QA still there';
  assert not exists (select 1 from public.department_file_deletions where department_id = one_qa.id), 'no cleanup job';

  -- ---------- Refused on every path, the database owner included ----------
  perform pg_temp.expect_error(format('update public.departments set name = %L where id = %L', 'Renamed', one_pv.id), '23514', 'default-department');
  perform pg_temp.expect_error(format('update public.departments set initials = %L where id = %L', 'XX', one_pv.id), '23514', 'default-department');
  perform pg_temp.expect_error(format('update public.departments set removed_at = now() where id = %L', one_pv.id), 'P0001', 'default-department');
  perform pg_temp.expect_error(format('update public.departments set requires_compliance_check = false where id = %L', one_pv.id), '23514', 'default-department');
  perform pg_temp.expect_error(format('update public.departments set is_quality = false where id = %L', one_qa.id), '23514', 'default-department');
  perform pg_temp.expect_error(format('update public.departments set system_key = null where id = %L', one_pv.id), '42501', 'default-department');
  perform pg_temp.expect_error(format('update public.departments set system_key = %L where id = %L', 'quality-assurance', one_pv.id), '42501', 'default-department');
  perform pg_temp.expect_error(format('delete from public.departments where id = %L', one_qa.id), 'P0001', 'default-department');
  perform pg_temp.expect_error(format('delete from public.departments where id = %L', 'pharmacovigilance'), 'P0001', 'default-department');
  perform pg_temp.expect_error($q$update public.departments set removed_at = now() where id = 'quality-assurance'$q$, 'P0001', 'default-department');
  -- One of each per organization; another organization may have its own.
  -- In a division (20261124120000), so only the key is refused.
  perform pg_temp.expect_error(format('insert into public.departments (id, name, initials, organization_id, system_key, division_id) values (%L, %L, %L, %L, %L, %L)',
    'dd-second-pv', 'Second PV', 'SPV', one_org, 'pharmacovigilance', one_pv.division_id), '23505');
  perform pg_temp.expect_error(format('insert into public.departments (id, name, initials, organization_id, system_key, division_id) values (%L, %L, %L, %L, %L, %L)',
    'dd-unknown-key', 'Unknown Key', 'UK', one_org, 'regulatory-affairs', one_pv.division_id), '23514');

  -- ---------- Ordinary departments keep their behaviour ----------
  perform pg_temp.act_as(one_admin);
  v_ordinary := public.save_department(null, 'DD Ordinary', 'DO', 'Ordinary work', v_division_a, null, 'ordinary@dd.test');
  perform pg_temp.as_owner();
  select * into v_before from public.departments where id = v_ordinary;
  assert v_before.system_key is null and v_before.organization_id = one_org, 'a new department is never a default one';
  -- Not even by the owner, after it was created.
  perform pg_temp.expect_error(format('update public.departments set system_key = %L where id = %L', 'pharmacovigilance', v_ordinary), '42501', 'default-department');
  perform pg_temp.act_as(one_admin);
  perform public.save_department(v_ordinary, 'DD Renamed', 'DR', 'Ordinary work', v_division_b, v_before.updated_at, 'ordinary@dd.test');
  perform pg_temp.as_owner();
  select * into v_before from public.departments where id = v_ordinary;
  assert v_before.name = 'DD Renamed' and v_before.division_id = v_division_b, 'an ordinary department can be renamed and moved';
  perform pg_temp.act_as(one_admin);
  perform public.delete_department(v_ordinary, 'empty', v_before.updated_at);
  perform pg_temp.as_owner();
  assert (select removed_at is not null from public.departments where id = v_ordinary), 'an ordinary department can be deleted';

  -- ---------- Another organization can't touch them ----------
  perform pg_temp.act_as(two_admin);
  perform pg_temp.expect_error(format('select public.save_department(%L, %L, %L, %L, %L, %L, %L)', one_pv.id, 'DD Takeover', 'DT',
    'Taken over', two_pv.division_id, one_pv.updated_at, 'x@dd.test'), 'P0001', 'conflict');
  perform pg_temp.expect_error(format('select public.delete_department(%L, %L, %L)', one_qa.id, 'empty', one_qa.updated_at), 'P0001', 'conflict');
  perform pg_temp.expect_error(format('select public.begin_department_file_deletion(%L, %L)', one_qa.id, one_qa.updated_at), 'P0001', 'conflict');
  -- Organization two's own default departments are protected on their own.
  select updated_at into v_stamp from public.departments where id = two_pv.id;
  perform pg_temp.expect_error(format('select public.delete_department(%L, %L, %L)', two_pv.id, 'empty', v_stamp), 'P0001', 'default-department');
  assert (select count(*) from public.departments) = 2, 'organization two sees only its own two departments';
  perform pg_temp.as_owner();
  assert (select description from public.departments where id = one_pv.id) = 'Drug safety team', 'organization one''s PV unchanged';

  -- ---------- Employees, SOPs and workflows still use them ----------
  assert (select count(*) from public.profiles where department_id is not null) = (select assigned from dd_before), 'assignments unchanged';
  assert (select count(*) from public.sops where department_id = 'pharmacovigilance') =
         (select count(*) from public.sops s join public.departments d on d.id = s.department_id where d.system_key = 'pharmacovigilance' and d.organization_id = medcare),
    'MedCare''s PV SOPs keep their department';
end;
$$;

rollback;
