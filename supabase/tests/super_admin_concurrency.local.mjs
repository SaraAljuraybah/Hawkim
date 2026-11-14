// Concurrency and authorization test of the Super Admin (20261111120000_super_admin.sql) with REAL,
// separate database sessions at the same moment: things a single rolled-back SQL test can't show.
// Runs only against a LOCAL Supabase stack's database container (docker exec), never a hosted project.
//
//   supabase start            (then, from the repository root:)
//   HAWKIM_DB_CONTAINER=<the local stack's supabase_db_… container> node supabase/tests/super_admin_concurrency.local.mjs
//
// Each session acts as the API would: role authenticated, the caller's id in request.jwt.claim.sub.
// Fixtures: four new Admins with random ids and emails, committed (concurrent sessions need committed
// rows). Test-only setup and cleanup, as the database owner: the Super Admin designation is moved to
// the fixture before the test and given back afterwards (UPDATE, which its trigger allows for an active
// Admin). If the database had no Super Admin before, the designation row is removed at the end with
// session_replication_role = replica (owner only, this local database only). Every fixture row
// (audit, roles, profiles, sign-in accounts) is then deleted.
//
// Covers: two simultaneous transfers; a transfer versus a deletion; exactly one Super Admin after a
// transfer; authorization after a transfer (the former Super Admin loses, the new one gains); a regular
// Admin's transfer, deletion and edit of the Super Admin refused; the Super Admin's self-deletion refused;
// the audit records of transfers and deletions.
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const container = process.env.HAWKIM_DB_CONTAINER ?? ''
if (!/^supabase_db_[\w.-]+$/.test(container)) {
  console.error('Refusing to run: set HAWKIM_DB_CONTAINER to a LOCAL Supabase stack\'s supabase_db_… container.')
  process.exit(2)
}
const psqlArgs = ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt']
const dockerEnv = { ...process.env, MSYS_NO_PATHCONV: '1' }

/** As the database owner (setup, checks and cleanup only). */
const owner = (sql) => execFileSync('docker', psqlArgs, { input: sql, env: dockerEnv, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim()

/** One API-like session as `userId`, running `sql`; resolves when it ends (never rejects). */
function session(userId, sql) {
  const input = `select set_config('role', 'authenticated', false);
select set_config('request.jwt.claim.sub', '${userId}', false);
${sql}
`
  return new Promise((resolve) => {
    const child = spawn('docker', psqlArgs, { env: dockerEnv })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => {
      const hint = /HINT:\s+(\S+)/.exec(stderr)?.[1] ?? null
      resolve({ ok: code === 0, code, stdout: stdout.trim(), error: /ERROR:\s+(.*)/.exec(stderr)?.[1] ?? null, hint })
    })
    child.stdin.end(input)
  })
}

const LOCK = 'locktype = \'advisory\' and classid = 72441 and objid = 1'
/** Waits until `sql` (as the owner) returns 't'. */
async function until(sql, what, timeoutMs = 10000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (owner(sql) === 't') return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

const results = []
let failed = 0
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) { failed++; results.push(`FAIL  ${name}: ${error.message}`) }
}
function assert(condition, message) { if (!condition) throw new Error(message) }
function refused(result, hint, what) {
  assert(!result.ok, `${what} was allowed`)
  assert(result.hint === hint, `${what}: expected ${hint}, got ${result.hint} (${result.error})`)
}

const [A, B, C, D] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]
const ids = [A, B, C, D]
const idList = ids.map((id) => `'${id}'`).join(', ')
const holder = () => owner('select user_id from public.super_admin')
const rows = () => Number(owner('select count(*) from public.super_admin'))
const ended = (id) => owner(`select deleted_at is not null from public.profiles where id = '${id}'`) === 't'

// ---------- Setup ----------
const original = owner('select user_id from public.super_admin') || null
owner(`begin;
insert into auth.users (id, email, aud, role)
select u.id, 'cc-' || u.id || '@test.invalid', 'authenticated', 'authenticated' from unnest(array[${idList}]::uuid[]) u(id);
insert into public.profiles (id, full_name, email, initials, phone)
select u.id, 'CC Admin ' || left(u.id::text, 8), 'cc-' || u.id || '@test.invalid', 'CC', '+966511111111' from unnest(array[${idList}]::uuid[]) u(id);
insert into public.user_roles (user_id, role) select u.id, 'admin' from unnest(array[${idList}]::uuid[]) u(id);
commit;`)
if (original) owner(`update public.super_admin set user_id = '${A}' where singleton;`)
else owner(`select public.assign_initial_super_admin('${A}');`)

try {
  await check('the fixture starts with A as the only Super Admin', () => {
    assert(holder() === A && rows() === 1, `holder ${holder()}, rows ${rows()}`)
  })

  await check('two simultaneous transfers by the Super Admin: the second waits for the first, then is refused; exactly one Super Admin', async () => {
    const first = session(A, `begin; select public.transfer_super_admin('${B}'); select pg_sleep(2); commit;`)
    await until(`select exists (select 1 from pg_locks where ${LOCK} and granted)`, 'the first transfer to hold the lock')
    const second = session(A, `select public.transfer_super_admin('${C}');`)
    await until(`select exists (select 1 from pg_locks where ${LOCK} and not granted)`, 'the second transfer to wait')
    const [one, two] = await Promise.all([first, second])
    assert(one.ok, `first transfer failed: ${one.error}`)
    refused(two, 'super-admin-required', 'second transfer')
    assert(holder() === B && rows() === 1, `holder ${holder()}, rows ${rows()}`)
  })

  await check('transfer versus deletion: the deletion waits, then is refused (the caller is no longer Super Admin); nothing is deleted', async () => {
    const transfer = session(B, `begin; select public.transfer_super_admin('${C}'); select pg_sleep(2); commit;`)
    await until(`select exists (select 1 from pg_locks where ${LOCK} and granted)`, 'the transfer to hold the lock')
    const deletion = session(B, `select public.delete_admin('${D}');`)
    await until(`select exists (select 1 from pg_locks where ${LOCK} and not granted)`, 'the deletion to wait')
    const [moved, removed] = await Promise.all([transfer, deletion])
    assert(moved.ok, `transfer failed: ${moved.error}`)
    refused(removed, 'super-admin-required', 'deletion during the transfer')
    assert(!ended(D), 'D was deleted')
    assert(holder() === C && rows() === 1, `holder ${holder()}, rows ${rows()}`)
  })

  await check('authorization follows the transfer: is_super_admin is true only for the new Super Admin', async () => {
    const [former, current] = await Promise.all([session(B, 'select public.is_super_admin();'), session(C, 'select public.is_super_admin();')])
    assert(former.stdout.endsWith('f') && current.stdout.endsWith('t'), `former ${former.stdout}, current ${current.stdout}`)
  })

  await check('a regular Admin can\'t transfer the Super Admin role', async () => {
    refused(await session(A, `select public.transfer_super_admin('${D}');`), 'super-admin-required', 'transfer by a regular Admin')
    assert(holder() === C, `holder ${holder()}`)
  })

  await check('a regular Admin can\'t delete an Admin', async () => {
    refused(await session(A, `select public.delete_admin('${D}');`), 'super-admin-required', 'deletion by a regular Admin')
    assert(!ended(D), 'D was deleted')
  })

  await check('a regular Admin can\'t edit the Super Admin', async () => {
    const before = owner(`select full_name from public.profiles where id = '${C}'`)
    refused(await session(A, `select public.update_admin('${C}', 'Changed', '+966522222222');`), 'super-admin-protected', 'edit of the Super Admin')
    assert(owner(`select full_name from public.profiles where id = '${C}'`) === before, 'the Super Admin\'s name changed')
  })

  await check('the Super Admin can\'t delete themselves', async () => {
    refused(await session(C, `select public.delete_admin('${C}');`), 'super-admin-protected', 'self-deletion')
    assert(!ended(C) && holder() === C, 'the Super Admin was deleted')
  })

  await check('the new Super Admin deletes the former one, now a regular Admin', async () => {
    const result = await session(C, `select public.delete_admin('${B}');`)
    assert(result.ok, `deletion failed: ${result.error}`)
    assert(ended(B), 'B is still active')
  })

  await check('the audit records both transfers (who, from whom, to whom) and the deletion', () => {
    const transfers = owner(`select string_agg(actor_id || '>' || entity_id || ':' || (details->>'previousSuperAdminId') || '>' || (details->>'newSuperAdminId'), ',' order by created_at)
      from public.organization_management_audit where action = 'transfer-super-admin' and entity_id in (${idList})`)
    assert(transfers === `${A}>${B}:${A}>${B},${B}>${C}:${B}>${C}`, `transfers: ${transfers}`)
    const deletions = owner(`select string_agg(actor_id || '>' || entity_id, ',') from public.organization_management_audit where action = 'delete-admin' and entity_id in (${idList})`)
    assert(deletions === `${C}>${B}`, `deletions: ${deletions}`)
  })
} finally {
  // ---------- Cleanup (owner, this local database only) ----------
  try {
    if (original && owner(`select public.is_active_admin('${original}')`) === 't') {
      owner(`update public.super_admin set user_id = '${original}' where singleton;`)
    } else {
      owner(`begin; set local session_replication_role = replica; delete from public.super_admin where user_id in (${idList}); commit;`)
      if (original) results.push(`NOTE  the previous Super Admin ${original} is no longer an active Admin; none was restored`)
    }
    owner(`begin;
delete from public.organization_management_audit where entity_id in (${ids.map((id) => `'${id}'`).join(', ')}) or actor_id in (${idList});
delete from public.user_roles where user_id in (${idList});
delete from public.profiles where id in (${idList});
delete from auth.users where id in (${idList});
commit;`)
  } catch (error) {
    failed++
    results.push(`FAIL  cleanup: ${error.message.split('\n').find((line) => line.includes('ERROR')) ?? error.message}`)
  }
}

console.log(results.join('\n'))
console.log(failed ? `\n${failed} failed` : `\nAll ${results.filter((line) => line.startsWith('PASS')).length} passed`)
process.exit(failed ? 1 : 0)
