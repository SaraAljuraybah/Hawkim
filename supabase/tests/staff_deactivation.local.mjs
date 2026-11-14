// End-to-end test of Staff Deactivation (Delete Staff) and reactivation through Add Staff, against a REAL
// LOCAL Supabase stack (PostgreSQL, Auth, PostgREST, Edge Functions) with every migration applied,
// including 20261112120000_staff_deactivation.sql. Disposable data only; it refuses any URL that isn't
// localhost, so it can never touch the shared project, and no real email is sent: the add-user function
// must be served with SNDR_API_URL pointing at the stand-in email service this test starts.
//
//   supabase start
//   supabase functions serve --env-file <file with:
//     SNDR_API_KEY=local-test-only
//     SNDR_API_URL=http://host.docker.internal:56498/v1/send
//     SITE_URL=http://127.0.0.1:5179>
//   (from the repository root:)
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role key> [HAWKIM_DB_CONTAINER=supabase_db_Hawkim] \
//   [SNDR_MOCK_PORT=56498] node supabase/tests/staff_deactivation.local.mjs
//
// Covers the whole lifecycle: active staff → Delete (deactivated, persisted, no access, even with a token
// issued before) → Add Staff with the same email (same identity, new details, a new invitation) →
// invitation completed → active staff again. Also: who may do it, Admins never reactivated as staff, an
// invitation that can't be sent (no false success, retry safe), concurrent requests, and history kept.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient, FunctionsHttpError } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL ?? ''
const anonKey = process.env.SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const container = process.env.HAWKIM_DB_CONTAINER ?? 'supabase_db_Hawkim'
const mockPort = Number(process.env.SNDR_MOCK_PORT ?? 56498)
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !anonKey || !serviceKey) {
  console.error('Refusing to run: SUPABASE_URL must be a local http://127.0.0.1:<port> stack, with both keys set.')
  process.exit(2)
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, serviceKey, options)
const run = randomUUID().slice(0, 8)
const results = []
let failed = 0
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) { failed++; results.push(`FAIL  ${name}: ${error.message}`) }
}
function assert(condition, message) { if (!condition) throw new Error(message) }
async function ok(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message ?? JSON.stringify(error)}`)
  return data
}
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

// ---------- A stand-in for the SNDR email API (nothing leaves this machine) ----------
const mailbox = []
let emailMode = 'accept'
const mock = createServer((request, response) => {
  let body = ''
  request.on('data', (chunk) => { body += chunk })
  request.on('end', () => {
    if (request.method !== 'POST' || request.url !== '/v1/send') { response.writeHead(404).end(); return }
    if (emailMode === 'fail') { response.writeHead(500).end('{"error":"down"}'); return }
    const message = JSON.parse(body)
    mailbox.push({ to: message.to?.[0], subject: message.subject, html: message.html })
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"id":"local"}')
  })
})
await new Promise((resolve) => mock.listen(mockPort, '0.0.0.0', resolve))
const mailTo = (email) => mailbox.filter((message) => message.to === email)

/** The password-setup link of an email, as a person would click it. */
function linkIn(html) {
  const href = html.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]
  assert(href, 'the email has no set-password link')
  return href.replaceAll('&amp;', '&')
}

/** Follows the emailed link like a browser, then sets a password on the session it opens. */
async function completeInvitation(link, password) {
  const response = await fetch(link, { redirect: 'manual' })
  const location = response.headers.get('location') ?? ''
  const fragment = new URLSearchParams(location.split('#')[1] ?? '')
  const access_token = fragment.get('access_token')
  const refresh_token = fragment.get('refresh_token')
  assert(access_token && refresh_token, `the link did not open a session (status ${response.status}, ${location.split('#')[0]})`)
  const client = createClient(url, anonKey, options)
  await ok(client.auth.setSession({ access_token, refresh_token }), 'open the emailed session')
  await ok(client.auth.updateUser({ password }), 'set a password')
}

/** add-user as this client: { status, body }. */
async function addStaff(client, details) {
  const response = await client.functions.invoke('add-user', { body: details })
  if (!response.error) return { status: 200, body: response.data }
  if (response.error instanceof FunctionsHttpError) {
    const context = response.error.context
    return { status: context.status, body: await context.json().catch(() => ({})) }
  }
  throw new Error(`add-user: ${response.error.message}`)
}

async function signedIn(email, password) {
  const client = createClient(url, anonKey, options)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  return { client, session: data?.session ?? null, error }
}

/** What the app's sign-in reads after Auth (services/people.ts fetchProfile): an active profile, or nothing. */
async function activeProfileOf(client, id) {
  const { data, error } = await client.from('profiles').select('id, deleted_at').eq('id', id).maybeSingle()
  if (error) throw new Error(`read profile: ${error.message}`)
  return data && !data.deleted_at ? data : null
}

// ---------- People ----------
const HOME = 'regulatory-affairs'
async function person(key, roles, department = HOME) {
  const email = `e2e-deact-${key}-${run}@test.invalid`
  const password = `E2e-${randomUUID()}`
  const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`)
  // As the other local tests make them: a profile (with a department, which every profile needs before its roles), then roles.
  await ok(service.from('profiles').insert({ id: user.id, full_name: `E2E ${key}`, email, initials: 'EE',
    department_id: department, position: 'Specialist', phone: '+966500000000' }), `profile ${key}`)
  if (roles.length) await ok(service.from('user_roles').insert(roles.map((role) => ({ user_id: user.id, role }))), `roles ${key}`)
  const { client, error } = await signedIn(email, password)
  if (error) throw new Error(`sign in ${key}: ${error.message}`)
  return { id: user.id, email, password, client }
}

const admin = await person('admin', ['admin'], 'quality-assurance')
const peer = await person('peer', ['reviewer'])
const formerAdmin = await person('former-admin', ['admin'], 'quality-assurance')

// The staff member of the lifecycle, added through Add Staff like any new staff member.
const staffEmail = `e2e-deact-staff-${run}@test.invalid`
const decoy = await ok(service.auth.admin.createUser({ email: `x${staffEmail}`, password: `E2e-${randomUUID()}`, email_confirm: true }), 'create look-alike')
let staffId = ''
let staffPassword = `E2e-${randomUUID()}`
let oldSession = null
let historySnapshot = ''
const details = { name: 'E2E Lifecycle Staff', email: staffEmail, phone: '+966512340001', position: 'Officer', departmentId: HOME, permissions: ['author', 'reviewer'] }

/** The staff member's SOP, its version and timeline, and every audit row about them, as one string. */
async function history() {
  const { stdout } = await psql(`select coalesce(json_agg(x order by x::text), '[]') from (
    select to_jsonb(s) - 'updated_at' as x from public.sops s where s.author_id = '${staffId}'
    union all select to_jsonb(v) from public.sop_versions v where v.uploaded_by = '${staffId}'
    union all select to_jsonb(t) from public.timeline_events t where t.actor_id = '${staffId}') q;`)
  return stdout
}
const auditCount = async (action) => Number((await psql(`select count(*) from public.organization_management_audit where action = '${action}' and entity_id = '${staffId}';`)).stdout)
const authAccounts = async () => Number((await psql(`select count(*) from auth.users where lower(email) = '${staffEmail}';`)).stdout)
const profiles = async () => Number((await psql(`select count(*) from public.profiles where email = '${staffEmail}';`)).stdout)

await check('1. Add Staff with a new email creates a new staff account and sends an invitation', async () => {
  const result = await addStaff(admin.client, details)
  assert(result.status === 200 && result.body.emailSent === true, `status ${result.status} ${JSON.stringify(result.body)}`)
  assert(result.body.user.reactivated === false, 'a new account is not a reactivation')
  staffId = result.body.user.id
  assert(mailTo(staffEmail).length === 1, 'one invitation')
  await completeInvitation(linkIn(mailTo(staffEmail)[0].html), staffPassword)
  const { client, session, error } = await signedIn(staffEmail, staffPassword)
  assert(!error && session, 'the new staff member signs in')
  assert(await activeProfileOf(client, staffId), 'and can use Hawkim')
  oldSession = { client, session }
  // Some history of theirs: a published SOP with its file and timeline (as the owner writes them).
  const sop = randomUUID()
  const insert = await psql(`begin; insert into public.sops (id, title, department_id, author_id, status, current_version) values ('${sop}', 'E2E History ${run}', '${HOME}', '${staffId}', 'published', 1);
    insert into public.sop_versions (sop_id, version, file_name, file_type, storage_path, file_size, uploaded_by) values ('${sop}', 1, 'a.pdf', 'pdf', '${staffId}/${sop}.pdf', 1, '${staffId}');
    insert into public.timeline_events (sop_id, type, actor_id, version) values ('${sop}', 'version-uploaded', '${staffId}', 1); commit;`)
  assert(insert.code === 0, insert.stderr)
  historySnapshot = await history()
  assert(historySnapshot.includes(sop), 'history recorded')
})

await check('2. Adding an already-active email is refused, with no second account', async () => {
  const result = await addStaff(admin.client, { ...details, name: 'Someone Else' })
  assert(result.status === 409 && result.body.errorCode === 'email-taken', `status ${result.status} ${JSON.stringify(result.body)}`)
  assert(await authAccounts() === 1 && await profiles() === 1, 'no second account or profile')
  assert(mailTo(staffEmail).length === 1, 'no second invitation')
})

await check('3. Staff can\'t deactivate anyone, and can\'t call add-user', async () => {
  const { error } = await peer.client.rpc('deactivate_staff', { p_user_id: staffId })
  assert(error?.code === '42501', `expected 42501, got ${error?.code}`)
  const anon = createClient(url, anonKey, options)
  const anonymous = await anon.rpc('deactivate_staff', { p_user_id: staffId })
  assert(anonymous.error, 'not signed in: refused')
  const added = await addStaff(peer.client, { ...details, email: `e2e-deact-nobody-${run}@test.invalid` })
  assert(added.status === 403, `add-user by staff: ${added.status}`)
  assert(await activeProfileOf(service, staffId), 'still active')
})

await check('4. An Admin can\'t deactivate themselves or another Admin through Delete Staff', async () => {
  const self = await admin.client.rpc('deactivate_staff', { p_user_id: admin.id })
  assert(self.error?.hint === 'self-delete', `self: ${self.error?.hint}`)
  const other = await admin.client.rpc('deactivate_staff', { p_user_id: formerAdmin.id })
  assert(other.error?.hint === 'admin-managed-separately', `admin: ${other.error?.hint}`)
})

await check('5. Delete Staff deactivates them in the database, and it persists after reconnecting', async () => {
  // Two admins pressing Delete at the same moment: both succeed, it happens once.
  const [first, second] = await Promise.all([
    admin.client.rpc('deactivate_staff', { p_user_id: staffId }),
    admin.client.rpc('deactivate_staff', { p_user_id: staffId }),
  ])
  assert(!first.error && !second.error, `${first.error?.message} ${second.error?.message}`)
  assert([first.data.alreadyDeactivated, second.data.alreadyDeactivated].sort().join() === 'false,true', 'exactly one of them deactivated')
  assert(await auditCount('deactivate-staff') === 1, 'one audit row')
  // A fresh admin session ("after a refresh") reads them as deactivated, so the Staff list leaves them out.
  const reloaded = (await signedIn(admin.email, admin.password)).client
  const row = await ok(reloaded.from('profiles').select('id, full_name, deleted_at').eq('id', staffId).single(), 'read')
  assert(row.deleted_at && row.full_name === details.name, 'deactivated, with their name kept for history')
  // Nothing removed: account, profile and history.
  assert(await authAccounts() === 1 && await profiles() === 1, 'account and profile kept')
  assert(await history() === historySnapshot, 'history unchanged')
})

await check('6. Their token issued before reaches nothing, and their session can no longer be refreshed', async () => {
  const { client, session } = oldSession
  assert(await activeProfileOf(client, staffId) === null, 'no active profile through the old token')
  const sops = await ok(client.from('sops').select('id'), 'read SOPs')
  assert(sops.length === 0, `read ${sops.length} SOPs`)
  const departments = await ok(client.from('departments').select('id'), 'read departments')
  assert(departments.length === 0, 'reads no departments')
  const write = await client.rpc('create_sop', { p_title: 'After', p_description: '', p_department_id: HOME, p_storage_path: `${staffId}/x.pdf`, p_file_name: 'x.pdf' })
  assert(write.error, 'a write RPC is refused')
  const role = await ok(client.rpc('has_role', { wanted: 'author' }), 'has_role')
  assert(role === false, 'their permissions no longer count')
  const refreshed = await createClient(url, anonKey, options).auth.refreshSession({ refresh_token: session.refresh_token })
  assert(refreshed.error, 'the old refresh token is revoked')
  // Auth itself no longer accepts the token (its session is gone), so Edge Functions refuse it too.
  const authUser = await createClient(url, anonKey, options).auth.getUser(session.access_token)
  assert(authUser.error, 'Auth still accepts the old access token')
  // Storage (row level security on storage.objects) refuses their own file.
  const file = await client.storage.from('sop-files').download(`${staffId}/any.pdf`)
  assert(file.error, 'Storage served a file to a deactivated token')
})

await check('7. A deactivated staff member can\'t start a usable session (the app signs them out: no active profile)', async () => {
  const { client, session } = await signedIn(staffEmail, staffPassword)
  if (session) assert(await activeProfileOf(client, staffId) === null, 'signed in to Auth, but no active profile: no access')
})

await check('8. Edit Staff can\'t bring them back', async () => {
  const saved = await admin.client.rpc('save_user', { p_user_id: staffId, p_full_name: details.name, p_phone: details.phone, p_position: 'Officer',
    p_department_id: HOME, p_roles: ['author'], p_expected_department_id: HOME, p_expected_roles: ['author', 'reviewer'] })
  assert(saved.error?.code === 'P0002', `save_user: ${saved.error?.code}`)
  const email = await admin.client.functions.invoke('update-user-email', { body: { userId: staffId, email: `e2e-deact-moved-${run}@test.invalid` } })
  assert(email.error, 'update-user-email refused')
  assert(!(await activeProfileOf(service, staffId)), 'still deactivated')
})

await check('9. If the new invitation can\'t be sent, Add Staff fails and they stay deactivated (retry is safe)', async () => {
  emailMode = 'fail'
  const result = await addStaff(admin.client, { ...details, name: 'E2E Back Again' })
  emailMode = 'accept'
  assert(result.status === 502 && result.body.errorCode === 'invitation-failed', `status ${result.status} ${JSON.stringify(result.body)}`)
  assert(!(await activeProfileOf(service, staffId)), 'not left active')
  assert(await authAccounts() === 1 && await profiles() === 1, 'no second account or profile')
})

const newDetails = { name: 'E2E Back Again', email: staffEmail.toUpperCase(), phone: '+966512340002', position: 'Senior Officer', departmentId: 'quality-assurance', permissions: ['reviewer'] }

await check('10. Add Staff with their email (any letter case) reactivates the same person once, even when sent four times at once', async () => {
  const before = mailTo(staffEmail).length
  // Four admins pressing Add Staff at the same moment.
  const results = await Promise.all([1, 2, 3, 4].map(() => addStaff(admin.client, newDetails)))
  const statuses = results.map((result) => result.status).sort().join()
  assert(statuses === '200,409,409,409', `statuses ${statuses}: ${JSON.stringify(results.map((result) => result.body))}`)
  assert(results.filter((result) => result.status === 409).every((result) => result.body.errorCode === 'email-taken'), 'the others are duplicates')
  const success = results.find((result) => result.status === 200).body
  assert(success.user.id === staffId && success.user.reactivated === true && success.emailSent === true, JSON.stringify(success))
  assert(success.user.id !== decoy.user.id, 'picked the look-alike account')
  const decoyProfile = await service.from('profiles').select('id').eq('id', decoy.user.id).maybeSingle()
  assert(!decoyProfile.data, 'the look-alike account got a profile')
  assert(await authAccounts() === 1 && await profiles() === 1, 'no duplicate account or profile')
  assert(mailTo(staffEmail).length === before + 1, `${mailTo(staffEmail).length - before} invitations sent`)
  const row = await ok(service.from('profiles').select('full_name, phone, position, department_id, deleted_at, user_roles(role)').eq('id', staffId).single(), 'read')
  assert(!row.deleted_at && row.full_name === newDetails.name && row.phone === newDetails.phone && row.position === newDetails.position
    && row.department_id === newDetails.departmentId, `details ${JSON.stringify(row)}`)
  assert(row.user_roles.map((role) => role.role).join() === 'reviewer', 'only the submitted permissions')
  // Audited: the attempt undone in step 9 (reactivated, then deactivated again) and this one.
  assert(await auditCount('reactivate-user') === 2, `reactivation audit rows: ${await auditCount('reactivate-user')}`)
  assert(await auditCount('deactivate-staff') === 2, 'Delete Staff and the undone attempt')
  assert(await history() === historySnapshot, 'history unchanged')
})

await check('11. Neither the old password nor the old session comes back with the reactivation', async () => {
  const { session } = await signedIn(staffEmail, staffPassword)
  assert(!session, 'the old password no longer works')
  const refreshed = await createClient(url, anonKey, options).auth.refreshSession({ refresh_token: oldSession.session.refresh_token })
  assert(refreshed.error, 'the old session stays ended')
})

await check('12. The new invitation works: they set a password, sign in, and use Hawkim again', async () => {
  const messages = mailTo(staffEmail)
  staffPassword = `E2e-${randomUUID()}`
  await completeInvitation(linkIn(messages[messages.length - 1].html), staffPassword)
  const { client, session, error } = await signedIn(staffEmail, staffPassword)
  assert(!error && session, `sign in: ${error?.message}`)
  assert(await activeProfileOf(client, staffId), 'an active profile')
  assert(await ok(client.rpc('has_role', { wanted: 'reviewer' }), 'has_role') === true, 'with the new permission')
  assert(await ok(client.rpc('has_role', { wanted: 'author' }), 'has_role') === false, 'and not the old one')
})

await check('13. Add Staff never reactivates a former Admin', async () => {
  const ended = await psql(`update public.profiles set deleted_at = now() where id = '${formerAdmin.id}';`)
  assert(ended.code === 0, ended.stderr)
  const result = await addStaff(admin.client, { name: 'Former Admin', email: formerAdmin.email, phone: '+966512340003', position: 'Officer', departmentId: HOME, permissions: ['author'] })
  assert(result.status === 409 && result.body.errorCode === 'admin-managed-separately', `status ${result.status} ${JSON.stringify(result.body)}`)
  const row = await ok(service.from('profiles').select('deleted_at, user_roles(role)').eq('id', formerAdmin.id).single(), 'read')
  assert(row.deleted_at && row.user_roles.map((role) => role.role).join() === 'admin', 'still a deactivated Admin')
})

await check('15. A stale Edit Staff save is refused at once with the conflict (not retried by PostgREST until it times out)', async () => {
  const started = Date.now()
  // As if another Admin had moved them meanwhile: the expected department is not theirs.
  const { error } = await admin.client.rpc('save_user', { p_user_id: staffId, p_full_name: newDetails.name, p_phone: newDetails.phone,
    p_position: newDetails.position, p_department_id: newDetails.departmentId, p_roles: ['reviewer'],
    p_expected_department_id: HOME, p_expected_roles: ['reviewer'] })
  const took = Date.now() - started
  assert(error?.hint === 'conflict' && error?.code === 'P0001', `got ${error?.code} ${error?.hint} ${error?.message}`)
  assert(took < 10000, `took ${took} ms`)
})

await check('14. Admin functions still work for Admins (regression)', async () => {
  assert(await ok(admin.client.rpc('can_manage_organization'), 'can_manage_organization') === true, 'the admin still manages the organization')
  const people = await ok(admin.client.from('profiles').select('id'), 'read profiles')
  assert(people.length > 0, 'the admin reads profiles')
})

mock.close()
console.log(results.join('\n'))
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
