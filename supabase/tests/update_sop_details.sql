-- Tests for 20261113140000_update_sop_details.sql: the main author changes an SOP's title and description
-- (SOP Details) at any stage before publishing, and nothing else about the SOP changes: status, review rounds,
-- reviewer requests and decisions, versions and files, comments and the timeline stay as they were.
-- Every call is made as the API would make it (role authenticated, with the caller's id in the JWT claims).
-- Only for a disposable LOCAL database with every migration applied; never the shared project.
-- Everything is rolled back.
begin;
set local plpgsql.check_asserts = on;

create function pg_temp.expect_error(p_sql text, p_state text) returns void
language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise; end if;
    rejected := true;
  end;
  assert rejected, 'Expected ' || p_state || ' from ' || p_sql;
end;
$$;
create function pg_temp.act_as(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
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
-- Everything about an SOP except its title, description and updated_at, to compare before and after.
create function pg_temp.workflow_state(p_sop uuid) returns jsonb
language sql as $$
  select jsonb_build_object(
    'sop', (select to_jsonb(s) - 'title' - 'description' - 'updated_at' from public.sops s where s.id = p_sop),
    'versions', (select coalesce(jsonb_agg(to_jsonb(v) order by v.version), '[]') from public.sop_versions v where v.sop_id = p_sop),
    'rounds', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]') from public.review_rounds r where r.sop_id = p_sop),
    'requests', (select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]') from public.review_requests q
      join public.review_rounds r on r.id = q.round_id where r.sop_id = p_sop),
    'comments', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]') from public.sop_comments c where c.sop_id = p_sop),
    'timeline', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id), '[]') from public.timeline_events e where e.sop_id = p_sop),
    'coAuthors', (select coalesce(jsonb_agg(to_jsonb(a) order by a.user_id), '[]') from public.sop_co_authors a where a.sop_id = p_sop)
  )
$$;
grant execute on function pg_temp.expect_error(text, text), pg_temp.act_as(uuid), pg_temp.as_owner(), pg_temp.workflow_state(uuid) to public;

-- 1 main author, 2 co-author, 3 reviewer, 4 author in another department (no relation to the SOP).
insert into auth.users (id) select ('99000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 4) n;
insert into public.departments (id, name, initials) values ('usd-home', 'USD Home', 'UH');
insert into public.profiles (id, full_name, email, initials, department_id, "position")
select ('99000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'USD Person ' || n, 'usd-' || n || '@test.invalid', 'UP', 'usd-home', 'Officer'
from generate_series(1, 4) n;
insert into public.user_roles (user_id, role) values
  ('99000000-0000-4000-8000-000000000001', 'author'), ('99000000-0000-4000-8000-000000000002', 'author'),
  ('99000000-0000-4000-8000-000000000003', 'reviewer'), ('99000000-0000-4000-8000-000000000004', 'author');
insert into public.sops (id, title, description, department_id, author_id, status, current_version) values
  ('99000000-0000-4000-8000-0000000000a1', 'USD Draft', 'Old text', 'usd-home', '99000000-0000-4000-8000-000000000001', 'draft', 1),
  ('99000000-0000-4000-8000-0000000000a2', 'USD In Review', 'Under review', 'usd-home', '99000000-0000-4000-8000-000000000001', 'in-review', 1),
  ('99000000-0000-4000-8000-0000000000a3', 'USD Published', 'Final', 'usd-home', '99000000-0000-4000-8000-000000000001', 'published', 1);
insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by)
select s.id, 1, 'usd.pdf', 'pdf', '99000000-0000-4000-8000-000000000001/' || s.id || '.pdf', 1, '99000000-0000-4000-8000-000000000001'
from public.sops s where s.id::text like '99000000-0000-4000-8000-0000000000a%';
insert into public.sop_co_authors (sop_id, user_id, added_by) values ('99000000-0000-4000-8000-0000000000a2', '99000000-0000-4000-8000-000000000002', '99000000-0000-4000-8000-000000000001');

do $$
declare
  author constant uuid := '99000000-0000-4000-8000-000000000001';
  coauthor constant uuid := '99000000-0000-4000-8000-000000000002';
  reviewer constant uuid := '99000000-0000-4000-8000-000000000003';
  stranger constant uuid := '99000000-0000-4000-8000-000000000004';
  draft constant uuid := '99000000-0000-4000-8000-0000000000a1';
  reviewing constant uuid := '99000000-0000-4000-8000-0000000000a2';
  published constant uuid := '99000000-0000-4000-8000-0000000000a3';
  v_state jsonb;
begin
  assert has_function_privilege('authenticated', 'public.update_sop_details(uuid, text, text)', 'execute');
  assert not has_function_privilege('anon', 'public.update_sop_details(uuid, text, text)', 'execute');

  -- ---------- Only the main author ----------
  foreach v_state in array array[to_jsonb(coauthor), to_jsonb(reviewer), to_jsonb(stranger)] loop
    perform pg_temp.act_as((v_state #>> '{}')::uuid);
    perform pg_temp.expect_error(format('select public.update_sop_details(%L, ''Hijacked'', ''x'')', reviewing), '42501');
  end loop;
  perform pg_temp.as_owner();
  assert (select title from public.sops where id = reviewing) = 'USD In Review', 'Refused edits change nothing';

  -- ---------- While in review: only the title and description change ----------
  v_state := pg_temp.workflow_state(reviewing);
  perform pg_temp.act_as(author);
  perform public.update_sop_details(reviewing, '  Renamed In Review  ', '  New scope.  ');
  perform pg_temp.as_owner();
  assert (select title = 'Renamed In Review' and description = 'New scope.' from public.sops where id = reviewing), 'Saved, trimmed';
  assert pg_temp.workflow_state(reviewing) = v_state, 'Status, reviewers, versions, files, comments and timeline unchanged';

  -- ---------- Drafts too; an empty description is allowed ----------
  perform pg_temp.act_as(author);
  perform public.update_sop_details(draft, 'Renamed Draft', '');
  perform pg_temp.as_owner();
  assert (select title = 'Renamed Draft' and description = '' and status = 'draft' from public.sops where id = draft), 'Draft edited';

  -- ---------- What it refuses ----------
  perform pg_temp.act_as(author);
  perform pg_temp.expect_error(format('select public.update_sop_details(%L, ''Late'', ''x'')', published), '23514');
  perform pg_temp.expect_error(format('select public.update_sop_details(%L, ''   '', ''x'')', draft), '23514');
  perform pg_temp.expect_error(format('select public.update_sop_details(%L, repeat(''t'', 151), ''x'')', draft), '23514');
  perform pg_temp.expect_error(format('select public.update_sop_details(%L, ''T'', repeat(''d'', 1001))', draft), '23514');
  perform pg_temp.expect_error(format('select public.update_sop_details(%L, ''T'', ''x'')', gen_random_uuid()), '42501');
  perform pg_temp.as_owner();
  assert (select title from public.sops where id = published) = 'USD Published', 'Published SOPs keep their title';
end;
$$;

rollback;
