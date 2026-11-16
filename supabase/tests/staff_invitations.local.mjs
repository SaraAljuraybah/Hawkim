// Staff → Sent Invitations end to end, against the LOCAL stack only, through the real Auth server and Edge
// Functions (add-user, resend-invitation, cancel-invitation, invitation-link-state):
//   supabase start
//   supabase functions serve --env-file <file with:
//     SNDR_API_KEY=local-test-only
//     SNDR_API_URL=http://host.docker.internal:56498/v1/send
//     SITE_URL=http://127.0.0.1:5179>
//   (from the repository root:)
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role key> [HAWKIM_DB_CONTAINER=supabase_db_Hawkim] \
//   [SNDR_MOCK_PORT=56498] node supabase/tests/staff_invitations.local.mjs
//
// Covers: Add Staff records a tracked invitation (Sent, not on Active Staff, its link carrying a reference);
// expiry after 24 hours; Resend refused while valid, refused twice at once, failing without changing
// anything, then succeeding (Sent again, a new link, the old one dead and "replaced"); activation moving the
// person off Sent Invitations; Cancel (refused for staff and another organization; the link dead and
// "cancelled", no sign-in, no Forgot-password way in, the profile kept and not deactivated, Resend refused,
// repeat safe); an already-activated invitation can't be cancelled.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { localPeople, owner, lit } from './local_people.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient, FunctionsHttpError } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL ?? ''
const anonKey = process.env.SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const mockPort = Number(process.env.SNDR_MOCK_PORT ?? 56498)
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url) || !anonKey || !serviceKey) {
  console.error('Refusing to run: SUPABASE_URL must be a local http://127.0.0.1:<port> stack, with both keys set.')
  process.exit(2)
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(url, serviceKey, options)
const anon = createClient(url, anonKey, options)
const run = randomUUID().slice(0, 8)
const db = owner()
const people = localPeople({ url, anonKey, service, options, run, prefix: 'e2e-inv' })
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

function linkIn(html) {
  const href = html.match(/href="([^"]*\/auth\/v1\/verify[^"]*)"/)?.[1]
  assert(href, 'the email has no set-password link')
  return href.replaceAll('&amp;', '&')
}
/** The reference the link's address carries (?invitation=), as Set New Password reads it. */
const refIn = (link) => new URL(new URL(link).searchParams.get('redirect_to') ?? 'http://x/').searchParams.get('invitation')

/** Follows the emailed link like a browser: the session it opens, or null (and where it went). */
async function openLink(link) {
  const response = await fetch(link, { redirect: 'manual' })
  const location = response.headers.get('location') ?? ''
  const fragment = new URLSearchParams(location.split('#')[1] ?? '')
  const access_token = fragment.get('access_token'), refresh_token = fragment.get('refresh_token')
  return { location, session: access_token && refresh_token ? { access_token, refresh_token } : null }
}
/** What the app does after the password is saved: set it, then mark the invitation used (confirmAccountActivated). */
async function activate(session, password) {
  const client = createClient(url, anonKey, options)
  await ok(client.auth.setSession(session), 'open the emailed session')
  await ok(client.auth.updateUser({ password }), 'set a password')
  await ok(client.rpc('mark_account_activated'), 'mark_account_activated')
  return client
}

async function invoke(client, name, body) {
  const response = await client.functions.invoke(name, { body })
  if (!response.error) return { status: 200, body: response.data }
  if (response.error instanceof FunctionsHttpError) {
    const context = response.error.context
    return { status: context.status, body: await context.json().catch(() => ({})) }
  }
  throw new Error(`${name}: ${response.error.message}`)
}
const linkState = async (ref) => (await invoke(anon, 'invitation-link-state', { linkRef: ref })).body.state
async function listed(client, id) {
  const rows = await ok(client.rpc('get_staff_invitations'), 'get_staff_invitations')
  return rows.find((row) => row.user_id === id)
}
const age = (id) => db.run(`update public.user_invitations set sent_at = now() - interval '25 hours' where user_id = ${lit(id)};`)

// ---------- People ----------
const HOME = 'regulatory-affairs'
const admin = await people.person('admin', 'quality-assurance', ['admin'])
const peer = await people.person('peer', HOME, ['reviewer'])
const other = await people.newOrganization('other')
const staff = (key) => ({ name: `E2E Invited ${key}`, email: `e2e-inv-${key}-${run}@test.invalid`, phone: '+966512340011', position: 'Officer', departmentId: HOME, permissions: ['author', 'reviewer'] })
const rana = staff('rana')
const omar = staff('omar')
let ranaId = '', omarId = '', ranaRef = '', newRef = ''

await check('1. Add Staff sends a tracked invitation: Sent, not activated, its link carrying a reference', async () => {
  const added = await invoke(admin.client, 'add-user', rana)
  assert(added.status === 200 && added.body.emailSent === true, `add-user ${added.status} ${JSON.stringify(added.body)}`)
  ranaId = added.body.user.id
  const link = linkIn(mailTo(rana.email)[0].html)
  ranaRef = refIn(link)
  assert(/^[0-9a-f-]{36}$/.test(ranaRef ?? ''), `the link's address carries ?invitation= (${new URL(link).searchParams.get('redirect_to')})`)
  const row = await listed(admin.client, ranaId)
  assert(row && row.expired === false && row.cancelled === false, `listed as Sent: ${JSON.stringify(row)}`)
  assert(await linkState(ranaRef) === 'valid', 'the link is valid')
  const added2 = await invoke(admin.client, 'add-user', omar)
  assert(added2.status === 200, 'second invitee')
  omarId = added2.body.user.id
})

await check('2. Adding the same email again is refused: no second account or invitation', async () => {
  const again = await invoke(admin.client, 'add-user', { ...rana, name: 'Someone Else' })
  assert(again.status === 409 && again.body.errorCode === 'email-taken', `${again.status} ${JSON.stringify(again.body)}`)
  assert(mailTo(rana.email).length === 1, 'one invitation')
})

await check('3. Only Admins of the same organization see or act on the invitation', async () => {
  const byStaff = await peer.client.rpc('get_staff_invitations')
  assert(byStaff.error?.code === '42501', `staff read: ${byStaff.error?.code}`)
  assert(!(await listed(other.admin.client, ranaId)), 'not listed for another organization')
  const cancelByStaff = await invoke(peer.client, 'cancel-invitation', { userId: ranaId })
  assert(cancelByStaff.status === 403, `staff cancel: ${cancelByStaff.status}`)
  const cancelByOther = await invoke(other.admin.client, 'cancel-invitation', { userId: ranaId })
  assert(cancelByOther.status === 404 && cancelByOther.body.errorCode === 'not-found', `other organization: ${cancelByOther.status} ${JSON.stringify(cancelByOther.body)}`)
  const resendByOther = await invoke(other.admin.client, 'resend-invitation', { userId: ranaId })
  assert(resendByOther.status === 404, `other organization resend: ${resendByOther.status}`)
  assert((await listed(admin.client, ranaId))?.cancelled === false, 'unchanged')
})

await check('4. Resend is refused while the link is valid; after 24 hours the invitation is Expired', async () => {
  const early = await invoke(admin.client, 'resend-invitation', { userId: ranaId })
  assert(early.status === 409 && early.body.errorCode === 'still-valid', `${early.status} ${JSON.stringify(early.body)}`)
  await age(ranaId)
  assert((await listed(admin.client, ranaId))?.expired === true, 'Expired')
  assert(await linkState(ranaRef) === 'expired', 'the link says expired')
})

await check('5. A resend whose email fails changes nothing, and can be tried again', async () => {
  const before = await listed(admin.client, ranaId)
  emailMode = 'fail'
  const failedSend = await invoke(admin.client, 'resend-invitation', { userId: ranaId })
  emailMode = 'accept'
  assert(failedSend.status === 502 && failedSend.body.errorCode === 'email-failed', `${failedSend.status} ${JSON.stringify(failedSend.body)}`)
  const after = await listed(admin.client, ranaId)
  assert(after.sent_at === before.sent_at && after.expired === true, 'the Sent Date and Expired status are kept')
  assert(await linkState(ranaRef) === 'expired', 'the previous reference is back')
})

await check('6. Two resends at once: exactly one sends; Sent again with a new link, the old one replaced', async () => {
  const before = await listed(admin.client, ranaId)
  const [a, b] = await Promise.all([1, 2].map(() => invoke(admin.client, 'resend-invitation', { userId: ranaId })))
  const statuses = [a.status, b.status].sort()
  assert(statuses[0] === 200 && statuses[1] === 409, `statuses ${statuses}`)
  const sent = a.status === 200 ? a : b
  assert(typeof sent.body.sentAt === 'string', 'the new Sent Date is returned')
  const after = await listed(admin.client, ranaId)
  assert(after.expired === false && Date.parse(after.sent_at) > Date.parse(before.sent_at), 'Sent again, from now')
  assert(Date.parse(after.expires_at) - Date.parse(after.sent_at) === 24 * 3600 * 1000, '24 hours from the new sending')
  const links = mailTo(rana.email)
  assert(links.length === 2, `two invitations in all (${links.length})`)
  newRef = refIn(linkIn(links[1].html))
  assert(newRef && newRef !== ranaRef, 'a new reference')
  assert(await linkState(ranaRef) === 'replaced' && await linkState(newRef) === 'valid', 'the old link is replaced')
  const oldLink = await openLink(linkIn(links[0].html))
  assert(!oldLink.session, 'the first link no longer opens a session')
  const profile = await db.row(`select full_name, phone, deleted_at from public.profiles where id = ${lit(ranaId)}`)
  assert(profile.full_name === rana.name && profile.phone === rana.phone && !profile.deleted_at, 'the staff information is unchanged')
  assert(Number((await db.row(`select count(*) n from auth.users where lower(email) = ${lit(rana.email)}`)).n) === 1, 'still one account')
})

await check('7. Cancel invalidates the link and blocks access, keeping the staff profile (not deactivated)', async () => {
  const cancelled = await invoke(admin.client, 'cancel-invitation', { userId: ranaId })
  assert(cancelled.status === 200 && typeof cancelled.body.cancelledAt === 'string', `${cancelled.status} ${JSON.stringify(cancelled.body)}`)
  assert((await listed(admin.client, ranaId))?.cancelled === true, 'listed as cancelled (on no Staff tab)')
  const opened = await openLink(linkIn(mailTo(rana.email)[1].html))
  assert(!opened.session, `the cancelled link opens no session (${opened.location.split('#')[0]})`)
  assert(await linkState(newRef) === 'cancelled' && await linkState(ranaRef) === 'cancelled', 'Set New Password is told it was cancelled')
  const profile = await db.row(`select deleted_at, full_name from public.profiles where id = ${lit(ranaId)}`)
  assert(profile && !profile.deleted_at && profile.full_name === rana.name, 'the profile is kept and not deactivated')
  const roles = await db.rows(`select role from public.user_roles where user_id = ${lit(ranaId)} order by role`)
  assert(roles.map((row) => row.role).join() === 'author,reviewer', 'the permissions are kept')
  // No way in: a recovery (Forgot password) link opens no session either.
  const recovery = await ok(service.auth.admin.generateLink({ type: 'recovery', email: rana.email }), 'recovery link')
  assert(!(await openLink(recovery.properties.action_link)).session, 'a Forgot-password link opens no session')
  const audit = await db.row(`select count(*) n from public.organization_management_audit where action = 'invitation-cancelled' and entity_id = ${lit(ranaId)} and actor_id = ${lit(admin.id)}`)
  assert(Number(audit.n) === 1, 'the cancellation is audited')
})

await check('8. A cancelled invitation can\'t be resent, and cancelling again is safe', async () => {
  await age(ranaId)
  const resent = await invoke(admin.client, 'resend-invitation', { userId: ranaId })
  assert(resent.status === 409 && resent.body.errorCode === 'cancelled', `${resent.status} ${JSON.stringify(resent.body)}`)
  const again = await invoke(admin.client, 'cancel-invitation', { userId: ranaId })
  assert(again.status === 200, `repeat: ${again.status}`)
  assert(mailTo(rana.email).length === 2, 'no new email')
})

await check('9. Accepting the invitation and setting a password moves the person to Active Staff', async () => {
  const opened = await openLink(linkIn(mailTo(omar.email)[0].html))
  assert(opened.session, 'the link opens a session')
  assert(opened.location.includes('/reset-password?invitation='), `Set New Password with the reference (${opened.location.split('#')[0]})`)
  assert(await listed(admin.client, omarId), 'still listed after only opening the link')
  const password = `E2e-${randomUUID()}`
  await activate(opened.session, password)
  assert(!(await listed(admin.client, omarId)), 'no longer on Sent Invitations')
  const client = createClient(url, anonKey, options)
  await ok(client.auth.signInWithPassword({ email: omar.email, password }), 'signs in')
  const own = await ok(client.from('profiles').select('id').eq('id', omarId).maybeSingle(), 'reads their profile')
  assert(own?.id === omarId, 'and uses Hawkim')
  const cancel = await invoke(admin.client, 'cancel-invitation', { userId: omarId })
  assert(cancel.status === 409 && cancel.body.errorCode === 'already-activated', `cancel activated: ${cancel.status} ${JSON.stringify(cancel.body)}`)
})

mock.close()
console.log(results.join('\n'))
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
