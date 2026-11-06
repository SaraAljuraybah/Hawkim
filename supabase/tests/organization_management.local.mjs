// End-to-end test of Divisions & Departments against a REAL LOCAL Supabase stack (PostgreSQL, Auth,
// Storage, Edge Functions) with every migration applied. Disposable data only; it refuses any URL
// that isn't localhost, so it can never touch the shared project.
//
//   supabase start            (then, from the repository root:)
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role key> node supabase/tests/organization_management.local.mjs
//
// Uses @supabase/supabase-js from frontend/node_modules.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

const url = process.env.SUPABASE_URL ?? ''
const anonKey = process.env.SUPABASE_ANON_KEY ?? ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
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
async function refused(promise, code, what) {
  const { error } = await promise
  assert(error, `${what} should have been refused`)
  if (code) assert(error.code === code, `${what}: expected ${code}, got ${error.code} ${error.message}`)
}
// Initials are 2-3 letters and unique among active departments: random per run.
const initials = () => Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('')
const pdf = () => new Blob([`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`], { type: 'application/pdf' })

// ---------- disposable people ----------
async function person(key, department, roles, position = 'Specialist') {
  const email = `e2e-${key}-${run}@test.invalid`
  const password = `E2e-${randomUUID()}`
  const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`)
  await ok(service.from('profiles').insert({ id: user.id, full_name: `E2E ${key}`, email, initials: 'EE', department_id: department, position }), `profile ${key}`)
  if (roles.length) await ok(service.from('user_roles').insert(roles.map((role) => ({ user_id: user.id, role }))), `roles ${key}`)
  const client = createClient(url, anonKey, options)
  await ok(client.auth.signInWithPassword({ email, password }), `sign in ${key}`)
  return { id: user.id, email, client }
}
async function upload(user, sopId) {
  const path = `${user.id}/${randomUUID()}.pdf`
  await ok(user.client.storage.from('sop-files').upload(path, pdf(), { contentType: 'application/pdf', upsert: false }), 'upload file')
  if (sopId) await ok(user.client.rpc('upload_sop_version', { p_sop_id: sopId, p_storage_path: path, p_file_name: 'Next.pdf' }), 'upload_sop_version')
  return path
}
async function createSop(user, department, title) {
  const path = await upload(user)
  const id = await ok(user.client.rpc('create_sop', { p_title: title, p_description: '', p_department_id: department, p_storage_path: path, p_file_name: 'Procedure.pdf' }), 'create_sop')
  return { id, path }
}
async function stored(path) {
  const folder = path.split('/')[0]
  const files = await ok(service.storage.from('sop-files').list(folder, { limit: 1000 }), 'list files')
  return files.some((file) => `${folder}/${file.name}` === path)
}
const snapshot = (client) => ok(client.rpc('get_divisions_departments'), 'get_divisions_departments')
const department = async (client, id) => (await snapshot(client)).departments.find((row) => row.id === id)
const division = async (client, id) => (await snapshot(client)).divisions.find((row) => row.id === id)

// ---------- setup ----------
const home = 'quality-assurance'
const admin = await person('admin', home, ['admin'])
const author = await person('author', 'regulatory-affairs', ['author'])
const reviewer = await person('reviewer', 'regulatory-affairs', ['reviewer'])
const otherReviewer = await person('other-reviewer', 'pharmacovigilance', ['reviewer'])
const anonymous = createClient(url, anonKey, options)
let divisionA, divisionB, created
const createdInitials = initials()

await check('1. Create a division (email optional)', async () => {
  divisionA = await ok(admin.client.rpc('save_division', { p_id: null, p_name: `E2E Division A ${run}`, p_description: 'First', p_email: '' }), 'save_division')
  const row = await division(admin.client, divisionA)
  assert(row && row.email === null, 'created without email')
  divisionB = await ok(admin.client.rpc('save_division', { p_id: null, p_name: `E2E Division B ${run}`, p_description: '', p_email: null }), 'save_division B')
})
await check('2. Edit a division (and refuse a stale edit)', async () => {
  const row = await division(admin.client, divisionA)
  await ok(admin.client.rpc('save_division', { p_id: divisionA, p_name: row.name, p_description: 'Edited', p_email: 'team@hawkim.test', p_expected_updated_at: row.updated_at }), 'edit')
  assert((await division(admin.client, divisionA)).email === 'team@hawkim.test', 'email saved')
  await refused(admin.client.rpc('save_division', { p_id: divisionA, p_name: row.name, p_description: 'Stale', p_email: '', p_expected_updated_at: row.updated_at }), '40001', 'stale division edit')
})
await check('5. Create a department in its division', async () => {
  created = await ok(admin.client.rpc('save_department', { p_id: null, p_name: `E2E Dept ${run}`, p_initials: createdInitials, p_description: 'Disposable', p_division_id: divisionA }), 'save_department')
  const row = await department(admin.client, created)
  assert(row.division_id === divisionA && row.initials === createdInitials, 'stored in division A')
  const totals = await division(admin.client, divisionA)
  assert(totals.department_count === 1, 'server-computed totals count it')
  await refused(admin.client.rpc('save_department', { p_id: null, p_name: `e2e dept ${run}`, p_initials: initials(), p_description: '', p_division_id: divisionA }), '23505', 'duplicate name')
  await refused(admin.client.rpc('save_department', { p_id: null, p_name: `E2E none ${run}`, p_initials: initials(), p_description: '', p_division_id: null }), '23514', 'department without division')
})
await check('4. Refuse deleting a division that still has departments', async () => {
  const row = await division(admin.client, divisionA)
  await refused(admin.client.rpc('delete_division', { p_id: divisionA, p_expected_updated_at: row.updated_at }), '23503', 'non-empty division delete')
})
await check('6./7. Edit a department and move it to another division', async () => {
  const row = await department(admin.client, created)
  await ok(admin.client.rpc('save_department', { p_id: created, p_name: `E2E Dept ${run} edited`, p_initials: createdInitials, p_description: '', p_division_id: divisionB, p_expected_updated_at: row.updated_at }), 'edit department')
  const after = await department(admin.client, created)
  assert(after.division_id === divisionB && after.name.endsWith('edited'), 'moved to division B')
  await refused(admin.client.rpc('save_department', { p_id: created, p_name: 'Stale', p_initials: createdInitials, p_description: '', p_division_id: divisionA, p_expected_updated_at: row.updated_at }), '40001', 'stale department edit')
  // Every active user's department list now carries the division name (PostgREST embedding).
  const listed = await ok(author.client.from('departments').select('id, division_id, division:divisions(name)').eq('id', created).single(), 'department list')
  assert(listed.division_id === divisionB && listed.division?.name === `E2E Division B ${run}`, 'division name embedded for employees')
})
await check('3. Delete an empty division', async () => {
  const empty = await ok(admin.client.rpc('save_division', { p_id: null, p_name: `E2E Empty ${run}`, p_description: '', p_email: '' }), 'create empty')
  const row = await division(admin.client, empty)
  await ok(admin.client.rpc('delete_division', { p_id: empty, p_expected_updated_at: row.updated_at }), 'delete empty division')
  assert(!(await division(admin.client, empty)), 'gone from the snapshot')
})
await check('8./9. Add and update employee positions', async () => {
  await ok(admin.client.rpc('set_employee_positions', { p_profile_id: author.id, p_titles: ['Lead Author', 'Trainer'] }), 'add positions')
  let row = (await department(admin.client, 'regulatory-affairs')).people.find((p) => p.id === author.id)
  assert(JSON.stringify(row.positions) === JSON.stringify(['Lead Author', 'Trainer']), `positions ${JSON.stringify(row.positions)}`)
  await ok(admin.client.rpc('set_employee_positions', { p_profile_id: author.id, p_titles: ['Trainer'] }), 'update positions')
  row = (await department(admin.client, 'regulatory-affairs')).people.find((p) => p.id === author.id)
  assert(JSON.stringify(row.positions) === '["Trainer"]', 'replaced')
  const profile = await ok(service.from('profiles').select('position').eq('id', author.id).single(), 'profile')
  assert(profile.position === 'Trainer', 'primary position synced to profiles.position')
  await refused(admin.client.rpc('set_employee_positions', { p_profile_id: author.id, p_titles: [] }), '23514', 'no positions')
})
await check('10./11. Admin-only management; employees and anonymous callers are refused', async () => {
  assert((await ok(admin.client.rpc('can_manage_organization'), 'admin check')) === true, 'admin allowed')
  assert((await ok(author.client.rpc('can_manage_organization'), 'author check')) === false, 'author not allowed')
  await refused(author.client.rpc('get_divisions_departments'), '42501', 'author snapshot')
  await refused(author.client.rpc('save_division', { p_id: null, p_name: 'x', p_description: '', p_email: '' }), '42501', 'author save_division')
  await refused(author.client.rpc('set_employee_positions', { p_profile_id: author.id, p_titles: ['x'] }), '42501', 'author positions')
  await refused(anonymous.rpc('get_divisions_departments'), null, 'anonymous snapshot')
  const fn = await author.client.functions.invoke('delete-department', { body: { departmentId: created, expectedUpdatedAt: 'x', confirmDeleteSops: true } })
  assert(fn.error, 'author refused by delete-department')
  // The organizational chart stays readable for every active employee (develop's behaviour), email column excluded.
  const chart = await ok(author.client.rpc('get_organizational_structure'), 'chart')
  assert(chart.divisions.some((d) => d.id === divisionB), 'chart lists divisions')
  await refused(author.client.from('divisions').select('email'), '42501', 'direct division email read')
})
let sop
await check('12./13./14. Create an SOP with an uploaded file, then delete it (develop delete-sop)', async () => {
  sop = await createSop(author, 'regulatory-affairs', `E2E SOP ${run}`)
  assert(await stored(sop.path), 'file stored')
  const { error } = await author.client.functions.invoke('delete-sop', { body: { action: 'delete-sop', sopId: sop.id, reason: 'E2E cleanup' } })
  assert(!error, `delete-sop: ${error?.message}`)
  assert(!(await ok(service.from('sops').select('id').eq('id', sop.id), 'sop')).length, 'SOP rows deleted')
  assert(!(await stored(sop.path)), 'file removed')
})
await check('15.-18. Delete a department with its SOPs: files removed, job completed, audit kept', async () => {
  const doomed = await ok(admin.client.rpc('save_department', { p_id: null, p_name: `E2E Doomed ${run}`, p_initials: initials(), p_description: '', p_division_id: divisionB }), 'doomed department')
  const temp = await person('temp-author', doomed, ['author'])
  const first = await createSop(temp, doomed, `E2E doomed ${run}`)
  const second = await upload(temp, first.id)
  const blocked = await admin.client.functions.invoke('delete-department', { body: { departmentId: doomed, expectedUpdatedAt: (await department(admin.client, doomed)).updated_at, confirmDeleteSops: true } })
  assert(blocked.error, 'employees still assigned: refused')
  await ok(service.from('profiles').update({ department_id: home }).eq('id', temp.id), 'move employee out')
  const row = await department(admin.client, doomed)
  const { data, error } = await admin.client.functions.invoke('delete-department', { body: { departmentId: doomed, expectedUpdatedAt: row.updated_at, confirmDeleteSops: true } })
  assert(!error && data?.state === 'completed', `delete-department: ${error?.message ?? JSON.stringify(data)}`)
  assert(!(await stored(first.path)) && !(await stored(second)), 'both files removed from Storage')
  const removed = await ok(service.from('departments').select('removed_at, division_id').eq('id', doomed).single(), 'department')
  assert(removed.removed_at && removed.division_id === null, 'department removed')
  // The outbox tables are not readable by any API role; admins read a job through this RPC.
  const job = await ok(admin.client.rpc('get_department_file_deletion', { p_job_id: data.jobId }), 'job')
  assert((await ok(service.from('departments').select('deletion_job_id').eq('id', doomed).single(), 'job id')).deletion_job_id === data.jobId, 'job linked')
  assert(job.state === 'completed' && job.deletedFiles === 2 && job.totalFiles === 2, `job ${JSON.stringify(job)}`)
  await refused(service.from('department_file_deletions').select('id'), null, 'service role reads the outbox directly')
  const audit = await ok(service.from('organization_management_audit').select('action').eq('entity_id', doomed), 'audit')
  const actions = audit.map((entry) => entry.action)
  assert(actions.includes('department-file-deletion-requested') && actions.includes('department-file-deletion-completed'), `audit ${actions}`)
  const kept = await ok(service.from('sops').select('deleted_at, title').eq('id', first.id).single(), 'retained SOP')
  assert(kept.deleted_at && kept.title === 'Deleted SOP', 'SOP row retained as deleted evidence')
  const { data: hidden } = await temp.client.from('sops').select('id').eq('id', first.id)
  assert(!hidden.length, 'retained SOP hidden from its author')
  const again = await temp.client.functions.invoke('delete-sop', { body: { action: 'delete-sop', sopId: first.id, reason: 'try' } })
  assert(again.error, 'old delete-sop path cannot erase the retained SOP')
})
await check('19./20. Move SOPs to Others: still available to their author only', async () => {
  const closing = await ok(admin.client.rpc('save_department', { p_id: null, p_name: `E2E Closing ${run}`, p_initials: initials(), p_description: '', p_division_id: divisionB }), 'closing department')
  const writer = await person('others-author', closing, ['author'])
  const colleague = await person('colleague', closing, ['author'])
  const moved = await createSop(writer, closing, `E2E others ${run}`)
  await ok(service.from('sops').update({ status: 'published' }).eq('id', moved.id), 'publish (fixture)')
  for (const user of [writer, colleague]) await ok(service.from('profiles').update({ department_id: home }).eq('id', user.id), 'move out')
  const row = await department(admin.client, closing)
  await refused(admin.client.rpc('delete_department', { p_id: closing, p_sop_action: 'empty', p_expected_updated_at: row.updated_at }), '23503', 'has SOPs')
  await ok(admin.client.rpc('delete_department', { p_id: closing, p_sop_action: 'others', p_expected_updated_at: row.updated_at }), 'move to Others')
  const own = await ok(writer.client.from('sops').select('id, directory_group').eq('id', moved.id), 'author reads')
  assert(own.length === 1 && own[0].directory_group === 'others', 'author still reads it, under Others')
  const signed = await ok(writer.client.storage.from('sop-files').createSignedUrl(moved.path, 60), 'signed url')
  assert(signed.signedUrl, 'author can still open the file')
  const other = await ok(colleague.client.from('sops').select('id').eq('id', moved.id), 'colleague reads')
  assert(!other.length, 'former colleague does not get access through the deleted department')
  assert(await stored(moved.path), 'file kept')
})
await check('21./22. Request Hawkim acceptance creates an Admin with their job title as position', async () => {
  const hash = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
  const email = `e2e-request-${run}@test.invalid`
  const id = await ok(service.rpc('submit_access_request', { p_organization: 'E2E Org', p_contact_name: 'Request Person', p_job_title: 'Quality Lead', p_email: email, p_phone: '+966500000000', p_approx_users: 5, p_message: null, p_token_hash: hash }), 'submit')
  const { user } = await ok(service.auth.admin.createUser({ email, email_confirm: true }), 'auth user')
  await ok(service.rpc('accept_access_request', { p_id: id, p_token_hash: hash, p_user_id: user.id, p_department: home }), 'accept')
  const positions = await ok(service.from('employee_positions').select('title').eq('profile_id', user.id), 'positions')
  assert(positions.length === 1 && positions[0].title === 'Quality Lead', 'position created')
  const roles = await ok(service.from('user_roles').select('role').eq('user_id', user.id), 'roles')
  assert(roles.map((r) => r.role).join() === 'admin', 'Admin role')
})
await check('23./24. Review routing and the SOP workflow are unchanged', async () => {
  const review = await createSop(author, 'regulatory-affairs', `E2E review ${run}`)
  await refused(author.client.rpc('submit_for_review', { p_sop_id: review.id, p_reviewer_ids: [otherReviewer.id], p_response_due_date: null, p_review_duration_days: null, p_note: null }), null, 'first send to another department')
  await ok(author.client.rpc('submit_for_review', { p_sop_id: review.id, p_reviewer_ids: [reviewer.id], p_response_due_date: null, p_review_duration_days: null, p_note: null }), 'submit to home reviewer')
  const request = await ok(service.from('review_requests').select('id').eq('sop_id', review.id).eq('reviewer_id', reviewer.id).single(), 'request')
  await ok(reviewer.client.rpc('accept_review', { p_request_id: request.id }), 'accept review')
  await ok(reviewer.client.rpc('decide_review', { p_request_id: request.id, p_decision: 'completed', p_text: null }), 'decide review')
  const status = await ok(service.from('review_requests').select('status').eq('id', request.id).single(), 'status')
  assert(status.status === 'completed', `request ${status.status}`)
  await ok(author.client.rpc('add_reviewers', { p_sop_id: review.id, p_reviewer_ids: [otherReviewer.id], p_response_due_date: null, p_review_duration_days: null, p_note: null }), 'other department after home finished')
})

console.log(results.join('\n'))
console.log(`\n${results.length - failed} passed, ${failed} failed (run ${run})`)
process.exit(failed ? 1 : 0)
