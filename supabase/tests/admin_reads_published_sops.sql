-- Tests for 20261110130000_admin_reads_published_sops.sql. Only for a disposable LOCAL database
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
-- What this caller can read of the test's SOPs, by letter (titles are 'AR A' … 'AR F').
create function pg_temp.sops() returns text language sql as $$
  select coalesce(string_agg(right(s.title, 1), ',' order by s.title), '')
  from public.sops s where s.title like 'AR _';
$$;
-- Their version rows, e.g. 'A3'.
create function pg_temp.versions() returns text language sql as $$
  select coalesce(string_agg(right(s.title, 1) || v.version, ',' order by s.title, v.version), '')
  from public.sop_versions v join public.sops s on s.id = v.sop_id where s.title like 'AR _';
$$;
-- Their files, e.g. 'A3.pdf'.
create function pg_temp.files() returns text language sql as $$
  select coalesce(string_agg(right(o.name, 6), ',' order by o.name), '')
  from storage.objects o where o.bucket_id = 'sop-files' and o.name like '9b000000-0000-4000-8000-000000000002/%';
$$;

-- People: 1 admin (home department), 2 author in the other department (writes every test SOP),
-- 3 employee of the home department, 4 admin whose profile has ended, 5 author in the other department (a co-author).
insert into public.departments (id, name, initials) values ('ar-home', 'AR Home', 'AH'), ('ar-other', 'AR Other', 'AO');
insert into auth.users (id) select ('9b000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 5) n;
insert into public.profiles (id, full_name, email, initials, department_id, "position", deleted_at)
select ('9b000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'AR Person', 'ar-' || n || '@test.invalid', 'AP',
       case when n in (2, 5) then 'ar-other' else 'ar-home' end, 'Title', case when n = 4 then now() end
from generate_series(1, 5) n;
insert into public.user_roles (user_id, role) values
  ('9b000000-0000-4000-8000-000000000001', 'admin'), ('9b000000-0000-4000-8000-000000000002', 'author'),
  ('9b000000-0000-4000-8000-000000000004', 'admin'), ('9b000000-0000-4000-8000-000000000005', 'author');

-- The other department's SOPs: A published (at version 3), B draft, C in review, D published but deleted,
-- E published but in Others, F approved (not yet published). All but A are at version 1.
insert into public.sops (id, title, department_id, author_id, status, current_version, directory_group)
select ('9b100000-0000-4000-8000-00000000000' || n)::uuid, 'AR ' || chr(64 + n), 'ar-other', '9b000000-0000-4000-8000-000000000002',
       (array['published', 'draft', 'in-review', 'published', 'published', 'approved'])[n]::public.sop_status,
       case when n = 1 then 3 else 1 end, case when n = 5 then 'others' else 'department' end
from generate_series(1, 6) n;
-- Version 1 of each ('A1.pdf' … 'F1.pdf'); for A also a deleted version 2 ('A2.pdf') and the published
-- version 3 ('A3.pdf'). A1 is an older version of a published SOP: not deleted, but not the published one.
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
select ('9b100000-0000-4000-8000-00000000000' || n)::uuid, 1, 'ar.pdf', 'pdf',
       '9b000000-0000-4000-8000-000000000002/' || chr(64 + n) || '1.pdf', 2048, '9b000000-0000-4000-8000-000000000002'
from generate_series(1, 6) n;
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by, deleted_at, deleted_by)
values ('9b100000-0000-4000-8000-000000000001', 2, 'ar.pdf', 'pdf', '9b000000-0000-4000-8000-000000000002/A2.pdf', 2048,
        '9b000000-0000-4000-8000-000000000002', now(), '9b000000-0000-4000-8000-000000000002');
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
values ('9b100000-0000-4000-8000-000000000001', 3, 'ar.pdf', 'pdf', '9b000000-0000-4000-8000-000000000002/A3.pdf', 2048,
        '9b000000-0000-4000-8000-000000000002');
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'sop-files', v.storage_path, '9b000000-0000-4000-8000-000000000002', '{"mimetype": "application/pdf", "size": 2048}'
from public.sop_versions v where v.storage_path like '9b000000-0000-4000-8000-000000000002/%';
-- A's published file's path in another bucket.
insert into storage.buckets (id, name) values ('ar-other-bucket', 'ar-other-bucket') on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('ar-other-bucket', '9b000000-0000-4000-8000-000000000002/A3.pdf', '9b000000-0000-4000-8000-000000000002', '{}');
-- What stays private to A's department and its people: the timeline, a co-author and a comment.
insert into public.timeline_events (sop_id, type, actor_id, version)
values ('9b100000-0000-4000-8000-000000000001', 'version-uploaded', '9b000000-0000-4000-8000-000000000002', 3);
insert into public.sop_co_authors (sop_id, user_id, added_by)
values ('9b100000-0000-4000-8000-000000000001', '9b000000-0000-4000-8000-000000000005', '9b000000-0000-4000-8000-000000000002');
insert into public.sop_comments (sop_id, version, author_id, role, text)
values ('9b100000-0000-4000-8000-000000000001', 3, '9b000000-0000-4000-8000-000000000002', 'approver', 'AR comment');
-- D is deleted last: nothing can be added to a deleted SOP.
update public.sops set deleted_at = now() where id = '9b100000-0000-4000-8000-000000000004';

do $$
begin
  -- The admin: the published directory SOP only, and only its published version: neither the older
  -- version 1 nor the deleted version 2, as a row or as a file.
  perform pg_temp.act_as('9b000000-0000-4000-8000-000000000001');
  assert pg_temp.sops() = 'A', 'admin sops: ' || pg_temp.sops();
  assert pg_temp.versions() = 'A3', 'admin versions: ' || pg_temp.versions();
  assert pg_temp.files() = 'A3.pdf', 'admin files: ' || pg_temp.files();
  assert not exists (select 1 from storage.objects where bucket_id = 'ar-other-bucket'), 'admin: other bucket';
  -- Nothing else about the SOP.
  assert not exists (select 1 from public.timeline_events where sop_id = '9b100000-0000-4000-8000-000000000001'), 'admin: timeline';
  assert not exists (select 1 from public.sop_co_authors where sop_id = '9b100000-0000-4000-8000-000000000001'), 'admin: co-authors';
  assert not exists (select 1 from public.sop_comments where sop_id = '9b100000-0000-4000-8000-000000000001'), 'admin: comments';
  -- Read-only: no new way to change anything.
  perform pg_temp.expect_error($q$update public.sops set title = 'AR Z' where id = '9b100000-0000-4000-8000-000000000001'$q$, '42501');
  delete from storage.objects where bucket_id = 'sop-files' and name like '9b000000-0000-4000-8000-000000000002/%';

  -- An employee of another department: none of them, as before.
  perform pg_temp.act_as('9b000000-0000-4000-8000-000000000003');
  assert pg_temp.sops() = '', 'employee sops: ' || pg_temp.sops();
  assert pg_temp.versions() = '', 'employee versions: ' || pg_temp.versions();
  assert pg_temp.files() = '', 'employee files: ' || pg_temp.files();

  -- The author: their own SOPs that aren't deleted, every version row, and the files of versions that
  -- aren't deleted (older ones too), as before.
  perform pg_temp.act_as('9b000000-0000-4000-8000-000000000002');
  assert pg_temp.sops() = 'A,B,C,E,F', 'author sops: ' || pg_temp.sops();
  assert pg_temp.versions() = 'A1,A2,A3,B1,C1,E1,F1', 'author versions: ' || pg_temp.versions();
  assert pg_temp.files() = 'A1.pdf,A3.pdf,B1.pdf,C1.pdf,E1.pdf,F1.pdf', 'author files: ' || pg_temp.files();
  assert exists (select 1 from public.timeline_events where sop_id = '9b100000-0000-4000-8000-000000000001'), 'author: timeline';
  -- A published SOP keeps its published version: no new version can be added and none deleted, so
  -- its status stays 'published' and current_version stays 3.
  perform pg_temp.expect_error($q$select public.upload_sop_version('9b100000-0000-4000-8000-000000000001',
    '9b000000-0000-4000-8000-000000000002/A4.pdf', 'ar.pdf')$q$, '23514');
  -- Deleting runs through the delete-sop-version Edge Function (service role), for the author.
  perform pg_temp.as_owner();
  perform pg_temp.expect_error($q$select public.delete_sop_version('9b000000-0000-4000-8000-000000000002',
    '9b100000-0000-4000-8000-000000000001', 3)$q$, '23514');

  -- An admin whose profile has ended: nothing.
  perform pg_temp.act_as('9b000000-0000-4000-8000-000000000004');
  assert pg_temp.sops() = '', 'ended admin sops: ' || pg_temp.sops();
  assert pg_temp.versions() = '', 'ended admin versions: ' || pg_temp.versions();
  assert pg_temp.files() = '', 'ended admin files: ' || pg_temp.files();

  -- Signed out: no access to SOPs at all (no grant), and no files.
  perform pg_temp.as_owner();
  perform set_config('role', 'anon', true);
  perform pg_temp.expect_error('select pg_temp.sops()', '42501');
  assert pg_temp.files() = '', 'signed out files: ' || pg_temp.files();

  -- Nothing was changed: the admin's update and delete and the author's upload and delete.
  perform pg_temp.as_owner();
  assert pg_temp.sops() = 'A,B,C,D,E,F', 'sops kept: ' || pg_temp.sops();
  assert (select status = 'published' and current_version = 3 from public.sops where id = '9b100000-0000-4000-8000-000000000001'), 'A kept';
  assert pg_temp.files() = 'A1.pdf,A2.pdf,A3.pdf,B1.pdf,C1.pdf,D1.pdf,E1.pdf,F1.pdf', 'files kept: ' || pg_temp.files();

  -- Whichever version is current is the only one the admin reads (should that ever change).
  update public.sops set current_version = 1 where id = '9b100000-0000-4000-8000-000000000001';
  perform pg_temp.act_as('9b000000-0000-4000-8000-000000000001');
  assert pg_temp.versions() = 'A1', 'admin versions, current 1: ' || pg_temp.versions();
  assert pg_temp.files() = 'A1.pdf', 'admin files, current 1: ' || pg_temp.files();
  -- A deleted current version: nothing.
  perform pg_temp.as_owner();
  update public.sops set current_version = 2 where id = '9b100000-0000-4000-8000-000000000001';
  perform pg_temp.act_as('9b000000-0000-4000-8000-000000000001');
  assert pg_temp.versions() = '', 'admin versions, deleted current: ' || pg_temp.versions();
  assert pg_temp.files() = '', 'admin files, deleted current: ' || pg_temp.files();

  -- Once B is published, the admin can read it too; once A is deleted, no longer.
  perform pg_temp.as_owner();
  update public.sops set current_version = 3 where id = '9b100000-0000-4000-8000-000000000001';
  update public.sops set status = 'published' where id = '9b100000-0000-4000-8000-000000000002';
  update public.sops set deleted_at = now() where id = '9b100000-0000-4000-8000-000000000001';
  perform pg_temp.act_as('9b000000-0000-4000-8000-000000000001');
  assert pg_temp.sops() = 'B', 'admin after changes: ' || pg_temp.sops();
  assert pg_temp.versions() = 'B1', 'admin versions after changes: ' || pg_temp.versions();
  assert pg_temp.files() = 'B1.pdf', 'admin files after changes: ' || pg_temp.files();

  -- Definitions: read-only, definer, fixed search_path, callable by signed-in users only.
  perform pg_temp.as_owner();
  assert (select bool_and(p.provolatile = 's' and p.prosecdef and p.proconfig = array['search_path=""'])
          from pg_proc p where p.oid in ('public.admin_can_read_published_sop(uuid)'::regprocedure,
            'public.admin_can_read_published_version(uuid, integer)'::regprocedure,
            'public.admin_can_read_published_sop_file(text)'::regprocedure)), 'definitions';
  assert has_function_privilege('authenticated', 'public.admin_can_read_published_sop(uuid)', 'execute'), 'authenticated: sop';
  assert has_function_privilege('authenticated', 'public.admin_can_read_published_version(uuid, integer)', 'execute'), 'authenticated: version';
  assert has_function_privilege('authenticated', 'public.admin_can_read_published_sop_file(text)', 'execute'), 'authenticated: file';
  assert not has_function_privilege('anon', 'public.admin_can_read_published_sop(uuid)', 'execute'), 'anon: sop';
  assert not has_function_privilege('anon', 'public.admin_can_read_published_version(uuid, integer)', 'execute'), 'anon: version';
  assert not has_function_privilege('anon', 'public.admin_can_read_published_sop_file(text)', 'execute'), 'anon: file';
  -- The three policies: permissive, SELECT, signed-in users only.
  assert (select count(*) from pg_policies
          where policyname in ('System admins can read published SOPs', 'System admins can read the published version of published SOPs',
                               'System admins can read the files of published SOPs')
            and permissive = 'PERMISSIVE' and cmd = 'SELECT' and roles = array['authenticated']::name[]) = 3, 'policies';
end;
$$;

rollback;
