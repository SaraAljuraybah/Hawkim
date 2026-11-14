// End-to-end test of Staff Management (Tasks 7–16) against a REAL LOCAL Supabase stack (PostgreSQL,
// Auth, PostgREST) with every migration applied. Disposable data only; it refuses any URL that isn't
// localhost, so it can never touch the shared project.
//
//   supabase start            (then, from the repository root:)
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role key> [HAWKIM_DB_CONTAINER=supabase_db_Hawkim] \
//   node supabase/tests/staff_management.local.mjs
//
// Covers: System Admin accounts without a department or position; required fields and the +9665
// phone format in the database; the department transfer restriction for Authors, Co-authors,
// Reviewers and Approvers (single, multiple roles, multiple SOPs, completed work, no SOPs);
// authorization bypass attempts; two concurrent transactions; and set_user_email.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { localPeople, owner, lit } from './local_people.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL ?? ''
const anonKey = process.env.SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const container = process.env.HAWKIM_DB_CONTAINER ?? 'supabase_db_Hawkim'
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !anonKey || !serviceKey) {
  console.error('Refusing to run: SUPABASE_URL must be a local http://127.0.0.1:<port> stack, with both keys set.')
  process.exit(2)
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, serviceKey, options)
const run = randomUUID().slice(0, 8)
const db = owner(container)
const people = localPeople({ url, anonKey, service, options, run, prefix: 'e2e-staff' })
const results = []
let failed = 0
class Skip extends Error {}
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) {
    if (error instanceof Skip) { results.push(`SKIP  ${name}: ${error.message}`); return }
    failed++; results.push(`FAIL  ${name}: ${error.message}`)
  }
}
function assert(condition, message) { if (!condition) throw new Error(message) }
async function ok(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message ?? JSON.stringify(error)}`)
  return data
}
async function refusedWith(promise, expected, what) {
  const { error } = await promise
  assert(error, `${what} should have been refused`)
  for (const [key, value] of Object.entries(expected)) {
    assert(error[key] === value, `${what}: expected ${key} ${value}, got ${error[key]} (${error.message})`)
  }
  return error
}

/** psql inside the local database container (no network port is used). */
function psql(sql) {
  return new Promise((resolve) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (data) => { stdout += data })
    child.stderr.on('data', (data) => { stderr += data })
    child.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr }))
    child.stdin.end(sql)
  })
}

// ---------- disposable people ----------
// Added through add_user by the first Admin, as Add Staff and Add Admin do (local_people.mjs).
const person = (key, department, roles, position = 'Specialist') => people.person(key, department, roles, position)
const pdf = () => new Blob([`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`], { type: 'application/pdf' })
async function createSop(user, title) {
  const path = `${user.id}/${randomUUID()}.pdf`
  await ok(user.client.storage.from('sop-files').upload(path, pdf(), { contentType: 'application/pdf', upsert: false }), 'upload file')
  return ok(user.client.rpc('create_sop', { p_title: title, p_description: '', p_department_id: user.department, p_storage_path: path, p_file_name: 'Procedure.pdf' }), 'create_sop')
}
// A fixture shortcut, as the database owner (the API has no direct table access).
const setStatus = (sopId, status) => db.run(`update public.sops set status = ${lit(status)} where id = ${lit(sopId)};`)

/** save_user as `actor`, keeping everything about `target` but the department. */
function transfer(actor, target, departmentId) {
  return actor.client.rpc('save_user', {
    p_user_id: target.id, p_full_name: `E2E ${target.email.split('-')[2]}`, p_phone: '+966500000000', p_position: 'Specialist',
    p_department_id: departmentId, p_roles: target.roles, p_expected_department_id: target.department, p_expected_roles: [...target.roles].sort(),
  })
}
async function departmentOf(id) {
  return (await db.row(`select department_id from public.profiles where id = ${lit(id)}`)).department_id
}
async function blocked(actor, target, total) {
  const error = await refusedWith(transfer(actor, target, 'research-development'), { code: '23514', hint: 'department-transfer-blocked' }, 'transfer')
  assert(error.details?.startsWith(`total:${total}`), `expected total:${total}, got ${error.details}`)
  assert(await departmentOf(target.id) === target.department, 'the department changed anyway')
  return error.details
}

// ---------- setup ----------
const RA = 'regulatory-affairs'
const admin = await person('admin', 'quality-assurance', ['admin'])
const author = await person('author', RA, ['author'])
const coauthor = await person('coauthor', RA, ['author'])
const reviewer = await person('reviewer', RA, ['reviewer'])
const multi = await person('multi', RA, ['author', 'reviewer'])
const approver = await person('approver', 'quality-assurance', ['approver'])
const idle = await person('idle', RA, ['author', 'reviewer'])
const finished = await person('finished', RA, ['author'])

// ---------- System Admin accounts ----------
await check('1. A System Admin is created without a department or position', async () => {
  const email = `e2e-staff-sysadmin-${run}@test.invalid`
  const { user } = await ok(service.auth.admin.createUser({ email, email_confirm: true, password: `E2e-${randomUUID()}` }), 'create account')
  const saved = await ok(admin.client.rpc('add_user', { p_user_id: user.id, p_email: email, p_full_name: 'E2E System Admin', p_phone: '+966511111111',
    p_position: null, p_department_id: null, p_roles: ['admin'] }), 'add_user')
  assert(saved.departmentId === null && saved.position === null, `saved ${JSON.stringify(saved)}`)
  const row = await db.row(`select department_id, position from public.profiles where id = ${lit(user.id)}`)
  assert(row.department_id === null && row.position === null, 'stored with organizational fields')
  // Editing them keeps it that way, whatever department or position is sent.
  const edited = await ok(admin.client.rpc('save_user', { p_user_id: user.id, p_full_name: 'E2E System Admin Two', p_phone: '+966522222222', p_position: 'Ignored',
    p_department_id: RA, p_roles: ['admin'], p_expected_department_id: null, p_expected_roles: ['admin'] }), 'save_user admin')
  assert(edited.name === 'E2E System Admin Two' && edited.departmentId === null && edited.position === null, `edited ${JSON.stringify(edited)}`)
})

await check('2. Staff still need a department and a position, and a +9665 phone (database)', async () => {
  const base = { p_email: `e2e-staff-x-${run}@test.invalid`, p_full_name: 'X', p_phone: '+966512345678', p_position: 'P', p_department_id: RA, p_roles: ['author'] }
  await ok(admin.client.rpc('check_new_user', base), 'valid staff')
  await refusedWith(admin.client.rpc('check_new_user', { ...base, p_department_id: null }), { hint: 'invalid' }, 'no department')
  await refusedWith(admin.client.rpc('check_new_user', { ...base, p_position: ' ' }), { hint: 'invalid' }, 'no position')
  for (const phone of ['0512345678', '+966 512345678', '+96651234567', '', null]) {
    await refusedWith(admin.client.rpc('check_new_user', { ...base, p_phone: phone }), { hint: 'invalid' }, `phone ${phone}`)
  }
  await refusedWith(admin.client.rpc('check_new_user', { ...base, p_email: 'not-an-email' }), { hint: 'invalid' }, 'email format')
  await refusedWith(admin.client.rpc('check_new_user', { ...base, p_email: author.email }), { hint: 'email-taken' }, 'email taken')
})

await check('3. Staff can never be left without a department (commit-time rule)', async () => {
  const result = await psql(`update public.profiles set department_id = null where id = '${idle.id}';`)
  assert(result.code !== 0 && /A department is required for staff/.test(result.stderr), `got ${result.code} ${result.stderr}`)
  assert(await departmentOf(idle.id) === RA, 'department removed')
})

// ---------- Department transfer restriction ----------
let draftSop
await check('4. Author of a draft SOP: transfer blocked', async () => {
  draftSop = await createSop(author, `E2E draft ${run}`)
  assert((await blocked(admin, author, 1)).includes('author:1'), 'author not counted')
})

await check('5. Co-author of an unfinished SOP: transfer blocked', async () => {
  await ok(author.client.rpc('add_co_authors', { p_sop_id: draftSop, p_user_ids: [coauthor.id] }), 'add_co_authors')
  assert((await blocked(admin, coauthor, 1)).includes('co-author:1'), 'co-author not counted')
})

let reviewSop
await check('6. Reviewer with a pending review request: transfer blocked', async () => {
  reviewSop = await createSop(multi, `E2E review ${run}`)
  await ok(multi.client.rpc('submit_for_review', { p_sop_id: reviewSop, p_reviewer_ids: [reviewer.id], p_response_due_date: null, p_review_duration_days: null, p_note: '' }), 'submit_for_review')
  assert((await blocked(admin, reviewer, 1)).includes('reviewer:1'), 'reviewer not counted')
})

await check('7. Approver while an SOP awaits approval: transfer blocked (Approver kept or removed in the same save)', async () => {
  const approvalSop = await createSop(finished, `E2E approval ${run}`)
  await setStatus(approvalSop, 'in-approval')
  // Approvers must stay in Quality; moving needs Approver removed in the same save, which is also refused.
  const error = await refusedWith(admin.client.rpc('save_user', { p_user_id: approver.id, p_full_name: 'E2E approver', p_phone: '+966500000000', p_position: 'Specialist',
    p_department_id: RA, p_roles: [], p_expected_department_id: 'quality-assurance', p_expected_roles: ['approver'] }), { hint: 'department-transfer-blocked' }, 'approver transfer')
  assert(/approver:\d+/.test(error.details), `approver not counted: ${error.details}`)
  await setStatus(approvalSop, 'published')
})

await check('8. Multiple roles and multiple SOPs: every one counted, each SOP once', async () => {
  // multi (Author and Reviewer) authors reviewSop (in review) and a second draft, and reviews a third SOP.
  await createSop(multi, `E2E second ${run}`)
  const third = await createSop(idle, `E2E third ${run}`)
  await ok(idle.client.rpc('submit_for_review', { p_sop_id: third, p_reviewer_ids: [multi.id], p_response_due_date: null, p_review_duration_days: null, p_note: '' }), 'submit third')
  const details = await blocked(admin, multi, 3)
  assert(details.includes('author:2') && details.includes('reviewer:1'), details)
  // idle authored it, so it isn't idle any more: publish it before the "no SOPs" check.
  await setStatus(third, 'published')
})

await check('9. Completed responsibilities: the transfer is allowed', async () => {
  const sop = await createSop(finished, `E2E done ${run}`)
  await setStatus(sop, 'published')
  const saved = await ok(transfer(admin, finished, 'research-development'), 'transfer')
  assert(saved.departmentId === 'research-development' && await departmentOf(finished.id) === 'research-development', 'not moved')
})

await check('10. No assigned SOPs: the transfer is allowed', async () => {
  await ok(transfer(admin, idle, 'research-development'), 'transfer')
  assert(await departmentOf(idle.id) === 'research-development', 'not moved')
})

await check('11. Finishing the work allows the transfer (nothing is completed automatically)', async () => {
  // The blocked transfers above changed nothing in the SOPs.
  const sop = await db.row(`select status from public.sops where id = ${lit(draftSop)}`)
  assert(sop.status === 'draft', `SOP status changed to ${sop.status}`)
  await setStatus(draftSop, 'published')
  await ok(transfer(admin, author, 'research-development'), 'author transfer after publishing')
  await ok(transfer(admin, coauthor, 'research-development'), 'co-author transfer after publishing')
})

// ---------- Authorization bypass attempts ----------
await check('12. Non-admins can\'t save staff, move themselves, or call the internal helpers', async () => {
  await refusedWith(transfer(reviewer, reviewer, 'research-development'), { code: '42501' }, 'non-admin save_user')
  const direct = await reviewer.client.from('profiles').update({ department_id: 'research-development' }).eq('id', reviewer.id).select()
  assert(direct.error || (direct.data ?? []).length === 0, 'a direct profile update went through')
  for (const fn of ['sop_responsibilities_in_progress', 'guard_department_transfer']) {
    const { error } = await admin.client.rpc(fn, fn === 'sop_responsibilities_in_progress' ? { p_user_id: reviewer.id } : {})
    assert(error, `${fn} is callable`)
  }
  assert(await departmentOf(reviewer.id) === RA, 'moved')
})

await check('13. Even a direct database update (service role / SQL) can\'t move staff with SOP work', async () => {
  // The service role has no direct table access at all; the owner's update is refused by the transfer guard.
  const viaService = await service.from('profiles').update({ department_id: 'research-development' }).eq('id', reviewer.id)
  assert(viaService.error?.hint === 'department-transfer-blocked' || viaService.error?.code === '42501', `service update: ${viaService.error?.message ?? 'went through'}`)
  const viaSql = await psql(`update public.profiles set department_id = 'research-development' where id = '${reviewer.id}';`)
  assert(viaSql.code !== 0 && /Department transfer not allowed/.test(viaSql.stderr), `SQL update: ${viaSql.stderr}`)
  assert(await departmentOf(reviewer.id) === RA, 'moved')
})

// ---------- Concurrency ----------
await check('14. A new SOP assignment and a transfer at the same moment: the transfer sees it and is refused', async () => {
  const target = await person('race', RA, ['author'])
  const sop = await createSop(multi, `E2E race ${run}`)
  // A: the author adds the target as co-author and holds the transaction open for 2 s.
  const assignment = psql(`begin;
    select set_config('request.jwt.claims', '{"sub":"${multi.id}","role":"authenticated"}', true);
    select set_config('request.jwt.claim.sub', '${multi.id}', true);
    set local role authenticated;
    select public.add_co_authors('${sop}', array['${target.id}']::uuid[]);
    select pg_sleep(2);
    commit;`)
  await new Promise((resolve) => setTimeout(resolve, 700))
  // B: the admin moves the target while A is still open.
  const started = Date.now()
  const moved = await transfer(admin, target, 'research-development')
  const waited = Date.now() - started
  const a = await assignment
  assert(a.code === 0, `assignment failed: ${a.stderr}`)
  assert(moved.error?.hint === 'department-transfer-blocked', `transfer was not refused: ${JSON.stringify(moved.error ?? moved.data)}`)
  assert(waited > 800, `the transfer didn't wait for the assignment (${waited} ms)`)
  assert(await departmentOf(target.id) === RA, 'moved')
})

await check('15. A transfer first: a new assignment waits for it, then sees the new department', async () => {
  const target = await person('race2', RA, ['author'])
  const sop = await createSop(multi, `E2E race two ${run}`)
  const move = psql(`begin;
    select set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true);
    select set_config('request.jwt.claim.sub', '${admin.id}', true);
    set local role authenticated;
    select public.save_user('${target.id}', 'E2E race2', '+966500000000', 'Specialist', 'research-development', array['author'], '${RA}', array['author']);
    select pg_sleep(2);
    commit;`)
  await new Promise((resolve) => setTimeout(resolve, 700))
  const started = Date.now()
  const added = await multi.client.rpc('add_co_authors', { p_sop_id: sop, p_user_ids: [target.id] })
  const waited = Date.now() - started
  const m = await move
  assert(m.code === 0, `transfer failed: ${m.stderr}`)
  assert(waited > 800, `the assignment didn't wait for the transfer (${waited} ms)`)
  // Co-authors must be in the SOP's department: once moved, they can't be added to the old one.
  const department = await departmentOf(target.id)
  assert(department === 'research-development', `department ${department}`)
  assert(added.error?.message === "A co-author must be from the SOP's department", `co-author added from another department: ${added.error?.message ?? 'no error'}`)
  const rows = await db.rows(`select user_id from public.sop_co_authors where sop_id = ${lit(sop)} and user_id = ${lit(target.id)}`)
  assert(rows.length === 0, 'a co-author from another department was stored')
})

// ---------- Email ----------
await check('16. set_user_email: admin only, unique, and only once the sign-in account has it', async () => {
  const target = await person('email', RA, ['author'])
  const next = `e2e-staff-email-new-${run}@test.invalid`
  await refusedWith(reviewer.client.rpc('set_user_email', { p_user_id: target.id, p_email: next, p_apply: false }), { code: '42501' }, 'non-admin')
  await refusedWith(admin.client.rpc('set_user_email', { p_user_id: target.id, p_email: author.email, p_apply: false }), { hint: 'email-taken' }, 'taken')
  await refusedWith(admin.client.rpc('set_user_email', { p_user_id: target.id, p_email: 'Bad@X', p_apply: false }), { hint: 'invalid' }, 'invalid')
  await ok(admin.client.rpc('set_user_email', { p_user_id: target.id, p_email: next, p_apply: false }), 'dry run')
  await refusedWith(admin.client.rpc('set_user_email', { p_user_id: target.id, p_email: next, p_apply: true }), { hint: 'invalid' }, 'apply before the account changed')
  await ok(service.auth.admin.updateUserById(target.id, { email: next, email_confirm: true }), 'account email')
  await ok(admin.client.rpc('set_user_email', { p_user_id: target.id, p_email: next, p_apply: true }), 'apply')
  const row = await db.row(`select email from public.profiles where id = ${lit(target.id)}`)
  assert(row.email === next, `profile email ${row.email}`)
})

// ---------- Edge Functions ----------
await check('17. update-user-email changes the sign-in account and the profile together', async () => {
  const password = `E2e-${randomUUID()}`
  const target = await person('fn-email', RA, ['author'])
  await ok(service.auth.admin.updateUserById(target.id, { password }), 'set password')
  const next = `e2e-staff-fn-new-${run}@test.invalid`
  const { data, error } = await admin.client.functions.invoke('update-user-email', { body: { userId: target.id, email: ` ${next.toUpperCase()} ` } })
  assert(!error, `update-user-email: ${error?.message}`)
  assert(data.email === next, `returned ${JSON.stringify(data)}`)
  const account = await ok(service.auth.admin.getUserById(target.id), 'read account')
  assert(account.user.email === next, `account email ${account.user.email}`)
  const row = await db.row(`select email from public.profiles where id = ${lit(target.id)}`)
  assert(row.email === next, `profile email ${row.email}`)
  // They sign in with the new email, not the old one.
  const fresh = createClient(url, anonKey, options)
  await ok(fresh.auth.signInWithPassword({ email: next, password }), 'sign in with the new email')
  const old = await createClient(url, anonKey, options).auth.signInWithPassword({ email: target.email, password })
  assert(old.error, 'the old email still signs in')
})

await check('18. update-user-email refuses: taken email (nothing changes), non-admins, bad requests', async () => {
  const target = await person('fn-refused', RA, ['author'])
  const status = async (client, body) => {
    const { error } = await client.functions.invoke('update-user-email', { body })
    if (!error) return { status: 200 }
    const response = error.context
    return { status: response?.status, body: await response?.json?.().catch(() => ({})) }
  }
  const taken = await status(admin.client, { userId: target.id, email: author.email })
  assert(taken.status === 409 && taken.body.errorCode === 'email-taken', `taken: ${JSON.stringify(taken)}`)
  const account = await ok(service.auth.admin.getUserById(target.id), 'read account')
  assert(account.user.email === target.email, 'the account changed anyway')
  const forbidden = await status(reviewer.client, { userId: target.id, email: `x-${run}@test.invalid` })
  assert(forbidden.status === 403, `non-admin: ${JSON.stringify(forbidden)}`)
  const invalid = await status(admin.client, { userId: target.id, email: 'not-an-email' })
  assert(invalid.status === 400 && invalid.body.errorCode === 'invalid', `invalid: ${JSON.stringify(invalid)}`)
  const anonymous = await status(createClient(url, anonKey, options), { userId: target.id, email: `y-${run}@test.invalid` })
  assert(anonymous.status === 401, `anonymous: ${JSON.stringify(anonymous)}`)
})

await check('19. add-user creates a System Admin without a department or position, and refuses staff without them', async () => {
  const email = `e2e-staff-fn-admin-${run}@test.invalid`
  const added = await admin.client.functions.invoke('add-user', { body: { name: 'E2E Function Admin', email, phone: '+966533333333', permissions: ['admin'] } })
  if (added.error?.context?.status === 503) throw new Skip('add-user is not configured here (SNDR_API_KEY); serve the functions with --env-file')
  assert(!added.error, `add-user: ${added.error?.message}`)
  assert(added.data.user.departmentId === null && added.data.user.position === null, `saved ${JSON.stringify(added.data.user)}`)
  const staff = await admin.client.functions.invoke('add-user', { body: { name: 'E2E Staff', email: `e2e-staff-fn-staff-${run}@test.invalid`, phone: '+966533333334', permissions: ['author'] } })
  assert(staff.error?.context?.status === 400, `staff without a department: ${staff.error?.context?.status}`)
})

console.log(results.join('\n'))
console.log(failed ? `\n${failed} failed` : `\nAll ${results.filter((line) => line.startsWith('PASS')).length} checks passed`)
process.exit(failed ? 1 : 0)
