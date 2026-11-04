// Local-only integration runner. Starts its own disposable database, publishes no
// ports, accepts no external database URL, and removes only its owned container.
// Run: node supabase/tests/organization_migrations.mjs
// Optional HAWKIM_ORG_TEST_IMAGE=postgres:16-alpine for compatibility testing.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path) => readFileSync(resolve(root, path), 'utf8')
const files = readdirSync(resolve(root, 'supabase/migrations')).filter((name) => name.endsWith('.sql'))
const versions = files.map((name) => name.split('_')[0])
assert.equal(new Set(versions).size, versions.length, 'Migration versions must be unique')
const name = `hawkim-org-test-${process.pid}-${Date.now()}`
const image = process.env.HAWKIM_ORG_TEST_IMAGE || 'postgres:17-alpine'
assert.match(image, /^postgres:(16|17)(?:-alpine)?$/, 'Only supported local PostgreSQL images are allowed')
const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 })
const sql = (database, input) => docker(['exec', '-i', name, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '--single-transaction'], input)
const catalogSnapshot = `select row_to_json(state) from (select
  (select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c where c.relnamespace = 'public'::regnamespace) relations,
  (select jsonb_agg(to_jsonb(a) order by a.attrelid, a.attnum) from pg_attribute a join pg_class c on c.oid = a.attrelid where c.relnamespace = 'public'::regnamespace) attributes,
  (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace) functions,
  (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'public'::regnamespace) policies,
  (select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c where c.connamespace = 'public'::regnamespace) constraints
) state;`
const migration = read('supabase/migrations/20261104130000_reconcile_organizational_structure.sql')
const prerequisites = `
create schema auth;
create table auth.users(id uuid primary key, banned_until timestamptz, deleted_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated;
${read('supabase/migrations/20261025120000_people_and_roles.sql')}
${read('supabase/migrations/20261103130000_profile_phone_and_position.sql')}
`
const manual = `
create table public.divisions(id text primary key, name text not null, description text, is_active boolean, created_at timestamptz, updated_at timestamptz);
alter table public.divisions enable row level security;
alter table public.departments add column division_id text;
alter table public.departments add constraint manual_division_fk foreign key(division_id) references public.divisions(id) on delete restrict;
create index manual_division_index on public.departments(division_id);
-- A pre-existing permissive directory policy must not bypass the new guard.
create policy "Existing directory policy" on public.divisions for select to authenticated using (public.is_active_user());
grant select(id), insert(name), update(description), references(id) on public.divisions to public;
grant select(id), insert(name), update(description), references(id) on public.divisions to anon, authenticated with grant option;
-- Simulate a pre-existing helper with unsafe ownership and surplus EXECUTE.
create function public.can_read_organizational_structure() returns boolean language sql as $$ select false $$;
alter function public.can_read_organizational_structure() owner to authenticated;
grant execute on function public.can_read_organizational_structure() to organization_extra_executor;
create function public.get_organizational_structure() returns jsonb language sql as $$ select '{}'::jsonb $$;
insert into public.divisions(id, name, description, is_active, created_at, updated_at) values ('regulatory_drug_safety', 'Preserved organization record', 'Preserved metadata', true, '2026-11-01', '2026-11-02');
insert into public.departments(id, name, initials, division_id) values ('preserved-department', 'Preserved department', 'PD', 'regulatory_drug_safety');
insert into auth.users(id) values ('f5000000-0000-4000-8000-000000000001');
insert into public.profiles(id, full_name, email, initials, department_id, position) values ('f5000000-0000-4000-8000-000000000001', 'Preservation fixture', 'preserve@test.invalid', 'PF', 'preserved-department', 'Unchanged position');
insert into public.user_roles(user_id, role) values ('f5000000-0000-4000-8000-000000000001', 'reviewer');
create table preservation_snapshot as select
  (select jsonb_agg(to_jsonb(d) order by id) from public.divisions d) divisions,
  (select jsonb_agg(to_jsonb(d) order by id) from public.departments d) departments,
  (select jsonb_agg(to_jsonb(p) order by id) from public.profiles p) profiles,
  (select jsonb_agg(to_jsonb(r) order by user_id, role) from public.user_roles r) roles,
  (select oid from pg_constraint where conrelid = 'public.departments'::regclass and conname = 'manual_division_fk') fk_oid,
  'public.divisions'::regclass::oid table_oid,
  'public.get_organizational_structure()'::regprocedure::oid rpc_oid;
`
const compatibilityChecks = `
do $$
declare existing record; att smallint;
begin
  assert (select count(*) = 1 from pg_constraint where conrelid = 'public.divisions'::regclass and contype = 'p');
  assert (select count(*) = 1 and bool_and(confdeltype = 'r') from pg_constraint where conrelid = 'public.departments'::regclass and contype = 'f' and confrelid = 'public.divisions'::regclass);
  select attnum into att from pg_attribute where attrelid = 'public.departments'::regclass and attname = 'division_id';
  assert (select count(*) = 1 from pg_index where indrelid = 'public.departments'::regclass and indkey[0] = att and indpred is null);
  assert (select count(*) = 2 from pg_policy where polrelid = 'public.divisions'::regclass and polname in ('Admins can read divisions', 'Organizational structure admin guard'));
  assert (select count(*) = 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'get_organizational_structure');
  assert (select prosecdef and proowner = 'postgres'::regrole and proconfig @> array['search_path=""']
    from pg_proc where oid = 'public.can_read_organizational_structure()'::regprocedure), 'Helper must have trusted ownership and a fixed search path';
  assert has_function_privilege('authenticated', 'public.can_read_organizational_structure()', 'EXECUTE');
  assert not has_function_privilege('anon', 'public.can_read_organizational_structure()', 'EXECUTE');
  assert not has_function_privilege('organization_extra_executor', 'public.can_read_organizational_structure()', 'EXECUTE');
  assert not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
    where p.oid = 'public.can_read_organizational_structure()'::regprocedure and acl.grantee <> p.proowner
      and (acl.grantee <> 'authenticated'::regrole or acl.is_grantable)), 'Helper grants must be EXECUTE to authenticated without grant option only';
  assert not exists(select 1 from pg_attribute a cross join lateral aclexplode(a.attacl) acl
    where a.attrelid = 'public.divisions'::regclass and a.attnum > 0 and not a.attisdropped
      and acl.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)), 'Direct column ACLs must be removed';
  assert not has_any_column_privilege('anon', 'public.divisions', 'SELECT, INSERT, UPDATE, REFERENCES');
  assert not has_any_column_privilege('authenticated', 'public.divisions', 'INSERT, UPDATE, REFERENCES');
  if to_regclass('public.preservation_snapshot') is not null then
    select * into existing from preservation_snapshot;
    assert existing.divisions = (select jsonb_agg(to_jsonb(d) order by id) from public.divisions d), 'Division data/metadata changed';
    assert existing.departments = (select jsonb_agg(to_jsonb(d) order by id) from public.departments d), 'Department assignments changed';
    assert existing.profiles = (select jsonb_agg(to_jsonb(p) order by id) from public.profiles p), 'Profiles changed';
    assert existing.roles = (select jsonb_agg(to_jsonb(r) order by user_id, role) from public.user_roles r), 'Roles changed';
    assert existing.fk_oid = (select oid from pg_constraint where conrelid = 'public.departments'::regclass and conname = 'manual_division_fk'), 'Live RESTRICT FK was replaced';
    assert existing.table_oid = 'public.divisions'::regclass::oid;
    assert existing.rpc_oid = 'public.get_organizational_structure()'::regprocedure::oid;
  end if;
end;
$$;
`

let started = false
try {
  // Uses an already-installed image; never downloads dependencies implicitly.
  docker(['run', '--detach', '--rm', '--pull=never', '--name', name, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', image])
  started = true
  let ready = false
  for (let attempt = 0; attempt < 50; attempt++) {
    try { docker(['exec', name, 'pg_isready', '-U', 'postgres']); ready = true; break } catch { await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
  assert(ready, 'Disposable PostgreSQL did not become ready')
  sql('postgres', 'create role anon; create role authenticated; create role organization_extra_executor;')
  console.log(`Testing ${image}; every migration/replay uses psql --single-transaction with ON_ERROR_STOP`)
  sql('postgres', `create temporary table revoke_syntax_probe(id text);
    grant select(id) on revoke_syntax_probe to anon;
    revoke all (id) on revoke_syntax_probe from anon;
    do $$ begin assert not has_any_column_privilege('anon', 'revoke_syntax_probe', 'SELECT'); end $$;`)
  console.log('PASS PostgreSQL syntax: REVOKE ALL (column) is valid; simplified migration needs no column list')
  for (const scenario of ['fresh', 'manual', 'legacy']) {
    docker(['exec', name, 'createdb', '-U', 'postgres', scenario])
    sql(scenario, prerequisites)
    if (scenario === 'manual') sql(scenario, manual)
    if (scenario === 'legacy') sql(scenario, read('supabase/proposals/organizational_structure_original.sql'))
    // A failure after the final statement must roll back the complete migration,
    // including ACLs, owners, RLS policies and the original manual records.
    if (scenario !== 'legacy') {
      const before = sql(scenario, catalogSnapshot)
      assert.throws(() => sql(scenario, migration + "\ndo $$ begin raise exception 'Intentional transaction rollback test'; end $$;"), /Intentional transaction rollback test/)
      const after = sql(scenario, catalogSnapshot)
      assert.equal(after, before, `${scenario}: catalog/ACL/owner changes must roll back together`)
      console.log(`PASS ${scenario}: complete migration rolls back after a final-statement failure`)
    }
    sql(scenario, migration)
    sql(scenario, migration) // Replay must not duplicate schema objects or data.
    sql(scenario, compatibilityChecks)
    // Native tests manage their own transaction and roll fixtures back.
    docker(['exec', '-i', name, 'psql', '-X', '-U', 'postgres', '-d', scenario, '-v', 'ON_ERROR_STOP=1'], read('supabase/tests/organizational_structure.sql'))
    if (scenario === 'legacy') sql(scenario, "insert into public.divisions(id, name) values ('underscore_id', 'Compatible ID');")
    console.log(`PASS ${scenario}: reconciliation, replay, constraints, authorization and hierarchy`)
  }
  // Unknown FK semantics must fail atomically instead of being silently changed.
  docker(['exec', name, 'createdb', '-U', 'postgres', 'incompatible'])
  sql('incompatible', prerequisites + manual.replace('on delete restrict', 'on delete cascade'))
  assert.throws(() => sql('incompatible', migration), /Unexpected department division FK/)
  sql('incompatible', "do $$ begin assert (select confdeltype = 'c' from pg_constraint where conname = 'manual_division_fk'); assert (select proowner = 'authenticated'::regrole and not prosecdef from pg_proc where oid = 'public.can_read_organizational_structure()'::regprocedure); end $$;")
  console.log('PASS incompatible: unexpected FK rejected without partial changes')
  docker(['exec', name, 'createdb', '-U', 'postgres', 'overloaded'])
  sql('overloaded', prerequisites + manual + "create function public.get_organizational_structure(ignored text) returns jsonb language sql as $$ select '{}'::jsonb $$;")
  assert.throws(() => sql('overloaded', migration), /Unexpected organizational function signature or overload/)
  console.log('PASS overloaded: unexpected RPC overload refused')
  // Tests the operator verification script with isolated fixtures shaped like
  // the supplied snapshot. This is not evidence about shared-project records.
  docker(['exec', name, 'createdb', '-U', 'postgres', 'snapshot_contract'])
  sql('snapshot_contract', prerequisites + migration + `
    insert into public.divisions(id, name) values ('rnd', 'Fixture division 1'), ('regulatory_drug_safety', 'Fixture division 2'),
      ('governance_quality_compliance', 'Fixture division 3'), ('corporate_services_operations', 'Fixture division 4');
    insert into public.departments(id, name, initials, division_id)
    select department, 'Fixture department ' || n, 'FD', division from unnest(
      array['research-development', 'clinical-operations', 'regulatory-affairs', 'pharmacovigilance', 'quality-assurance', 'legal-governance', 'human-resources', 'finance-administration', 'information-technology'],
      array['rnd', 'rnd', 'regulatory_drug_safety', 'regulatory_drug_safety', 'governance_quality_compliance', 'governance_quality_compliance', 'corporate_services_operations', 'corporate_services_operations', 'corporate_services_operations']
    ) with ordinality as fixture(department, division, n);
    insert into auth.users(id) select ('f6000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 9) n;
    insert into public.profiles(id, full_name, email, initials, department_id, position)
    select ('f6000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'Snapshot fixture ' || n, 'snapshot-' || n || '@test.invalid', 'SF', id,
      case when n % 2 = 0 then 'Stored fixture position' end
    from (select id, row_number() over(order by id) n from public.departments) d;
    insert into public.user_roles(user_id, role) values ('f6000000-0000-4000-8000-000000000001', 'admin'),
      ('f6000000-0000-4000-8000-000000000002', 'author'), ('f6000000-0000-4000-8000-000000000002', 'reviewer');
  `)
  docker(['exec', '-i', name, 'psql', '-X', '-U', 'postgres', '-d', 'snapshot_contract', '-v', 'ON_ERROR_STOP=1'],
    "select set_config('request.jwt.claim.sub', 'f6000000-0000-4000-8000-000000000001', false); set role authenticated;\n" + read('supabase/scripts/verify_organizational_snapshot.sql'))
  console.log('PASS snapshot_contract: read-only 4/9/9 verification script on local fixtures (not live records)')
  docker(['exec', name, 'createdb', '-U', 'postgres', 'unsafe_owner_membership'])
  sql('unsafe_owner_membership', prerequisites + manual)
  const beforeUnsafeOwner = sql('unsafe_owner_membership', catalogSnapshot)
  // This deliberately unsafe membership exists only in the disposable cluster.
  sql('postgres', 'grant postgres to authenticated;')
  try {
    assert.throws(() => sql('unsafe_owner_membership', migration), /API roles must not be members of the organizational helper owner/)
    assert.equal(sql('unsafe_owner_membership', catalogSnapshot), beforeUnsafeOwner)
  } finally {
    sql('postgres', 'revoke postgres from authenticated;')
  }
  console.log('PASS unsafe_owner_membership: migration fails atomically if an API role can assume the helper owner')
} finally {
  if (started) docker(['stop', name])
}
