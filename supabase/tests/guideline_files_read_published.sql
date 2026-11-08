-- Tests for 20261108140000_guideline_files_read_published.sql. Only for a disposable LOCAL database
-- with every migration applied; never the shared project. Files are stand-in storage.objects rows.
-- Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text) returns void
language plpgsql as $$
declare v_rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise; end if;
    v_rejected := true;
  end;
  assert v_rejected, 'Expected ' || p_state || ' from ' || p_sql;
end;
$$;
create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end;
$$;
create function pg_temp.as_owner() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;
-- The test's guideline files this caller can see: '1.pdf' published, '2.pdf' an added version's, '3.pdf' unused.
create function pg_temp.visible() returns text language sql as $$
  select coalesce(string_agg(right(o.name, 5), ',' order by o.name), '')
  from storage.objects o where o.bucket_id = 'guideline-files' and o.name like 'files/9a100000-%';
$$;

-- People: 1 admin, 2 author, 3 author whose profile has ended (not active).
insert into public.departments (id, name, initials) values ('gf-home', 'GF Home', 'GF');
insert into auth.users (id) select ('9a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 3) n;
insert into public.profiles (id, full_name, email, initials, department_id, "position", deleted_at)
select ('9a000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'GF Person', 'gf-' || n || '@test.invalid', 'GP', 'gf-home', 'Title',
       case when n = 3 then now() end
from generate_series(1, 3) n;
insert into public.user_roles (user_id, role) values
  ('9a000000-0000-4000-8000-000000000001', 'admin'), ('9a000000-0000-4000-8000-000000000002', 'author'),
  ('9a000000-0000-4000-8000-000000000003', 'author');

insert into public.guideline_versions (name, version, issued_date, effective_date, file_name, storage_path, file_size)
values ('GF GVP', '98.0', '2026-01-01', '2026-01-02', 'gf98.pdf', 'files/9a100000-0000-4000-8000-000000000001.pdf', 2048);
insert into public.guideline_version_drafts (name, version, issued_date, source, file_name, storage_path, file_size, created_by)
values ('GF GVP', '99.0', '2026-01-01', 'https://www.sfda.gov.sa/gvp', 'gf99.pdf', 'files/9a100000-0000-4000-8000-000000000002.pdf', 2048,
        '9a000000-0000-4000-8000-000000000001');
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'guideline-files', 'files/9a100000-0000-4000-8000-00000000000' || n || '.pdf', '9a000000-0000-4000-8000-000000000001',
       '{"mimetype": "application/pdf", "size": 2048}'
from generate_series(1, 3) n;
-- The published file's path in another bucket (it has no policy for authors).
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('gf-other-bucket', 'files/9a100000-0000-4000-8000-000000000001.pdf', '9a000000-0000-4000-8000-000000000001', '{}');

do $$
begin
  -- An admin: every file, as before.
  perform pg_temp.act_as('9a000000-0000-4000-8000-000000000001');
  assert pg_temp.visible() = '1.pdf,2.pdf,3.pdf', 'admin: ' || pg_temp.visible();

  -- An author: only the published version's file; not the added version's, not an unused one.
  perform pg_temp.act_as('9a000000-0000-4000-8000-000000000002');
  assert pg_temp.visible() = '1.pdf', 'author: ' || pg_temp.visible();
  -- Only in the guideline-files bucket.
  assert not exists (select 1 from storage.objects where bucket_id = 'gf-other-bucket'), 'author: other bucket';
  -- Still can't upload or remove.
  perform pg_temp.expect_error($q$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('guideline-files', 'files/9a100000-0000-4000-8000-000000000009.pdf', '9a000000-0000-4000-8000-000000000002', '{}')$q$, '42501');
  delete from storage.objects where bucket_id = 'guideline-files' and name like 'files/9a100000-%';

  -- Not active (ended profile): nothing.
  perform pg_temp.act_as('9a000000-0000-4000-8000-000000000003');
  assert pg_temp.visible() = '', 'not active: ' || pg_temp.visible();

  -- Signed out: nothing.
  perform pg_temp.as_owner();
  perform set_config('role', 'anon', true);
  assert pg_temp.visible() = '', 'signed out: ' || pg_temp.visible();

  -- The author's delete removed nothing.
  perform pg_temp.as_owner();
  assert pg_temp.visible() = '1.pdf,2.pdf,3.pdf', 'files kept: ' || pg_temp.visible();

  -- Once an added version's file belongs to a published version, authors can read it too.
  update public.guideline_version_drafts set storage_path = 'files/9a100000-0000-4000-8000-000000000004.pdf' where version = '99.0';
  update public.guideline_versions set storage_path = 'files/9a100000-0000-4000-8000-000000000002.pdf', file_size = 2048 where version = '98.0';
  perform pg_temp.act_as('9a000000-0000-4000-8000-000000000002');
  assert pg_temp.visible() = '2.pdf', 'author after publishing: ' || pg_temp.visible();

  -- Definition: read-only, definer, fixed search_path, callable by signed-in users only.
  perform pg_temp.as_owner();
  assert (select p.provolatile = 's' and p.prosecdef and p.proconfig = array['search_path=""']
          from pg_proc p where p.oid = 'public.is_published_guideline_path(text)'::regprocedure), 'definition';
  assert has_function_privilege('authenticated', 'public.is_published_guideline_path(text)', 'execute'), 'authenticated';
  assert not has_function_privilege('anon', 'public.is_published_guideline_path(text)', 'execute'), 'anon';
end;
$$;

rollback;
