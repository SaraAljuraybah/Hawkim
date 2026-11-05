// Full migration chain and real PostgreSQL RPC/RLS tests in an owned disposable container.
// No external URL, production connection, published ports, or database reset.
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = new URL('../../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const name = `hawkim-management-test-${process.pid}-${Date.now()}`
const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', stdio: ['pipe','pipe','pipe'], timeout: 60000, maxBuffer: 8*1024*1024 })
const args = ['exec','-i',name,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1']
const sql = (input) => docker(args, input)
const regressions = ['other_department_reviewers.sql','internal_review_rpc.sql']
const baseline = new Map()
const regressionError = (file) => {
  try { sql(read('supabase/tests/'+file)); return null }
  catch (error) { return String(error.stderr || error.message).split('\n').find((line) => line.startsWith('ERROR:')) ?? String(error) }
}
let started = false
try {
  docker(['run','--rm','-d','--network','none','--name',name,'-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'])
  started = true
  for (let attempt=0; ; attempt++) {
    // The image's initialization server accepts Unix sockets before it restarts.
    // TCP becomes available only when the final server is ready.
    try { docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres']); break }
    catch (error) { if (attempt > 40) throw error; await new Promise((resolve) => setTimeout(resolve,250)) }
  }
  sql(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,storage to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb);
    alter table storage.objects enable row level security;
    grant select,insert on storage.objects to authenticated;`)
  const files = readdirSync(fileURLToPath(new URL('supabase/migrations/',root))).filter((file) => file.endsWith('.sql')).sort()
  assert.equal(new Set(files.map((file) => file.split('_')[0])).size,files.length)
  for (const file of files) {
    try {
      // Later management migrations are applied below, each followed by its own tests.
      if (file >= '20261105130000') continue
      if (file.startsWith('20261105120000')) {
        for (const regression of regressions) baseline.set(regression,regressionError(regression))
        sql(`insert into public.divisions(id,name) values('legacy','Existing division');
        insert into public.departments(id,name,initials,division_id) values('preserved','Preserved mapping','PM','legacy');`)
      }
      sql(read('supabase/migrations/'+file))
    }
    catch (error) { console.error('Migration failed:',file); throw error }
  }
  const later = files.filter((file) => file >= '20261105130000')
  console.log(`PASS: initial ${files.length-later.length} migrations applied to a fresh disposable PostgreSQL database`)
  for (const regression of regressions) {
    const error = regressionError(regression)
    if (regression === 'other_department_reviewers.sql') {
      // Before 20261105160000, latest_round() broke requested_at ties (rounds created in one
      // transaction) by random uuid, so this result is a coin flip here. It is informational only;
      // the same test is REQUIRED to pass, repeatedly, on the final schema below.
      console.log(`INFO (tie-break not applied yet) ${regression}: before=${baseline.get(regression) ?? 'pass'} after=${error ?? 'pass'}`)
    } else if (baseline.get(regression)) {
      assert.equal(error,baseline.get(regression),'Review regression changed after the management migration')
      console.log('KNOWN BASELINE FAILURE before and after migration: '+regression+': '+error)
    } else {
      assert.equal(error,null,'New review regression: '+regression+' '+error)
      console.log('PASS: existing review regression '+regression)
    }
  }
  sql(read('supabase/tests/divisions_departments.sql'))
  console.log('PASS: persisted CRUD, legacy email preservation, validation, roles, counts, stale edits, employee/SOP restrictions, both SOP dispositions, retention, access and rollback')
  // A department removal and simultaneous employee assignment must never both succeed.
  sql(`insert into public.departments(id,name,initials) values('race','Race','RC');`)
  const concurrent = (input) => new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['pipe','pipe','pipe'] }); let stderr=''
    child.stderr.on('data',(data) => { stderr += data }); child.on('close',(code) => resolve({ code,stderr })); child.stdin.end(input)
  })
  const admin = `select set_config('request.jwt.claim.sub','a1000000-0000-4000-8000-000000000001',false); set role authenticated;`
  const removal = concurrent(`begin; ${admin} select public.delete_department('race','empty',(select updated_at from public.departments where id='race')); select pg_sleep(1); commit;`)
  await new Promise((resolve) => setTimeout(resolve,250))
  const assignment = concurrent(`insert into public.profiles(id,full_name,email,initials,department_id) values('a1000000-0000-4000-8000-000000000004','Race Employee','race@test.invalid','RE','race');`)
  const results = await Promise.all([removal, assignment])
  assert.equal(results.filter((result) => result.code === 0).length,1,JSON.stringify(results))
  console.log('PASS: concurrent employee assignment and department removal cannot both commit')
  sql(read('supabase/migrations/20261105130000_department_storage_cleanup.sql'))
  sql(read('supabase/tests/department_storage_cleanup.sql'))
  console.log('PASS: Storage deletion job authorization, complete path manifests, failure recovery, leases, pending-assignment guards, finalization and RPC bypass protection')
  // An existing single job title must be backfilled into employee_positions.
  sql(`update public.profiles set position='Administrator' where id='a1000000-0000-4000-8000-000000000001';`)
  for (const file of later.filter((file) => file > '20261105130000_department_storage_cleanup.sql' && file < '20261105160000')) sql(read('supabase/migrations/'+file))
  sql(read('supabase/tests/employee_positions_and_storage.sql'))
  console.log('PASS: multiple employee positions (backfill, admin-only RPC, required position, home-department rule), server division totals, database-verified Storage absence')
  for (const file of later.filter((file) => file >= '20261105160000')) sql(read('supabase/migrations/'+file))
  sql(read('supabase/tests/user_management_and_consistency.sql'))
  console.log('PASS: position sync keeps secondary titles, read-only missing-position audit, optional division email, persisted user create/permissions/delete with every database rule')
  // Deterministic latest round: the previously flaky regression must now pass every time.
  for (let run = 1; run <= 5; run++) {
    assert.equal(regressionError('other_department_reviewers.sql'),null,`other_department_reviewers.sql failed on run ${run} of the final schema`)
  }
  console.log('PASS: existing review regression other_department_reviewers.sql on the final schema (5 of 5 runs)')
  // Every later migration must replay-safely coexist with the existing review regressions.
  assert.equal(regressionError('internal_review_rpc.sql'),null,'internal_review_rpc.sql regressed on the final schema')
  console.log('PASS: existing review regression internal_review_rpc.sql on the final schema')
} finally {
  if (started) docker(['stop',name])
}
