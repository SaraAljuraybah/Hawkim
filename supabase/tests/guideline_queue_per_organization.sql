-- Tests for 20261116210000_guideline_queue_per_organization.sql: one GVP version in the queue per
-- organization (other organizations' versions don't block it), and the queue position, which tells an
-- organization's Admins only the place of their own waiting version.
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

insert into auth.users (id, email, aud, role)
select ('98700000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'queue-' || n || '@test.invalid', 'authenticated', 'authenticated'
from generate_series(1, 2) n;
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position")
values ('98700000-0000-4000-8000-000000000001', 'Queue Med Admin', 'queue-1@test.invalid', 'MA', null, '+966512345601', null);
insert into public.user_roles (user_id, role) values ('98700000-0000-4000-8000-000000000001', 'admin');
insert into public.organizations (id, name) values ('98700000-0000-4000-8000-0000000000aa', 'Queue Other');
insert into public.profiles (id, full_name, email, initials, department_id, phone, "position", organization_id)
values ('98700000-0000-4000-8000-000000000002', 'Queue Other Admin', 'queue-2@test.invalid', 'OA', null, '+966512345602', null,
  '98700000-0000-4000-8000-0000000000aa');
insert into public.user_roles (user_id, role) values ('98700000-0000-4000-8000-000000000002', 'admin');

-- Waiting: Other's 7.0 (added first), then MedCare's 8.0. Other also has a failed 6.0.
insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size,
  created_by, processing_status, created_at, organization_id) values
  ('98700000-0000-4000-8000-0000000000d1', 'GVP', '7.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp7.pdf',
   'files/98700000-0000-4000-8000-0000000000d1.pdf', 1, '98700000-0000-4000-8000-000000000002', 'waiting', now() - interval '10 minutes',
   '98700000-0000-4000-8000-0000000000aa'),
  ('98700000-0000-4000-8000-0000000000d3', 'GVP', '6.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp6.pdf',
   'files/98700000-0000-4000-8000-0000000000d3.pdf', 1, '98700000-0000-4000-8000-000000000002', 'failed', now() - interval '1 day',
   '98700000-0000-4000-8000-0000000000aa'),
  ('98700000-0000-4000-8000-0000000000d2', 'GVP', '8.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp8.pdf',
   'files/98700000-0000-4000-8000-0000000000d2.pdf', 1, '98700000-0000-4000-8000-000000000001', 'waiting', now() - interval '5 minutes',
   (select organization_id from public.profiles where id = '98700000-0000-4000-8000-000000000001'));
set constraints all immediate;
set constraints all deferred;

do $$
declare
  other constant uuid := '98700000-0000-4000-8000-0000000000aa';
  med_admin constant uuid := '98700000-0000-4000-8000-000000000001';
  other_admin constant uuid := '98700000-0000-4000-8000-000000000002';
  other_waiting constant uuid := '98700000-0000-4000-8000-0000000000d1';
  med_waiting constant uuid := '98700000-0000-4000-8000-0000000000d2';
  other_failed constant uuid := '98700000-0000-4000-8000-0000000000d3';
  sfda constant text := 'https://www.sfda.gov.sa/gvp';
begin
  -- ---------- One version in the queue per organization ----------
  -- Both organizations have one waiting at the same time.
  assert (select count(*) from public.guideline_version_drafts where processing_status = 'waiting') = 2;
  -- A second one in the same organization is refused, by the function and by the database.
  perform pg_temp.act_as(other_admin);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(%L, %L, %L, %L, %L, %L)',
    'GVP', '9.0', current_date, sfda, 'files/' || gen_random_uuid() || '.pdf', 'gvp9.pdf'), '55006', 'version-processing');
  perform pg_temp.expect_error(format('select public.retry_guideline_processing(%L)', other_failed), '55006', 'version-processing');
  perform pg_temp.as_owner();
  perform pg_temp.expect_error(format('update public.guideline_version_drafts set processing_status = %L where id = %L', 'waiting', other_failed), '23505');
  -- Another organization's waiting version doesn't block: with MedCare's 8.0 out of the queue, MedCare's Admin
  -- gets past the queue rule even though Other's 7.0 still waits (then stops at the missing file).
  update public.guideline_version_drafts set processing_status = 'failed' where id = med_waiting;
  perform pg_temp.act_as(med_admin);
  perform pg_temp.expect_error(format('select public.create_guideline_draft(%L, %L, %L, %L, %L, %L)',
    'GVP', '9.0', current_date, sfda, 'files/' || gen_random_uuid() || '.pdf', 'gvp9.pdf'), 'P0002', 'file-missing');
  -- And can't retry Other's failed version (not found for them).
  perform pg_temp.expect_error(format('select public.retry_guideline_processing(%L)', other_failed), 'P0001');
  perform pg_temp.as_owner();
  update public.guideline_version_drafts set processing_status = 'waiting' where id = med_waiting;

  -- ---------- The queue position ----------
  perform pg_temp.act_as(other_admin);
  assert public.guideline_queue_position(other_waiting) = 1, 'Other''s 7.0 was added first: processed next';
  assert public.guideline_queue_position(med_waiting) is null, 'MedCare''s version: nothing for Other';
  assert public.guideline_queue_position(other_failed) is null, 'not waiting: no position';
  perform pg_temp.act_as(med_admin);
  assert public.guideline_queue_position(med_waiting) = 2, 'MedCare''s 8.0 waits behind one version (of another organization)';
  assert public.guideline_queue_position(other_waiting) is null;
  -- Once Other's 7.0 is being processed, MedCare's is next.
  perform pg_temp.as_owner();
  update public.guideline_version_drafts set processing_status = 'processing', processing_started_at = now() where id = other_waiting;
  perform pg_temp.act_as(med_admin);
  assert public.guideline_queue_position(med_waiting) = 1, 'next once the other one is being processed';
  -- Only Admins.
  perform pg_temp.act_as(null, 'anon');
  perform pg_temp.expect_error(format('select public.guideline_queue_position(%L)', med_waiting), '42501');
end;
$$;

rollback;
