// End-to-end test, through the real LOCAL API (Auth, PostgREST, Storage, Edge Functions), of the 2026-11-20 changes:
//   - the default departments (20261120120000), including the delete-department Edge Function's clear refusal;
//   - guideline availability and Check Compliance without a guideline (20261120130000);
//   - Regulatory Guideline Addition requests saved in the database (20261120140000), from an Author to an Admin,
//     across new sessions, and never visible to another organization.
// Disposable data only; it refuses any URL that isn't localhost.
//
//   supabase start; supabase functions serve --env-file <file>   (see README.md in this folder), then:
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role key> node supabase/tests/default_departments_requests.local.mjs
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { localPeople, owner, lit } from './local_people.mjs'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient, FunctionsHttpError } = require('@supabase/supabase-js')

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
const people = localPeople({ url, anonKey, service, options, run, prefix: 'e2e-ddr' })
const db = owner()
const results = []
let failed = 0
function assert(condition, message) { if (!condition) throw new Error(message) }
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) { failed++; results.push(`FAIL  ${name}: ${error.message}`) }
}
async function ok(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message ?? JSON.stringify(error)}`)
  return data
}
async function refused(promise, code, what, hint) {
  const { error } = await promise
  assert(error, `${what} should have been refused`)
  if (code) assert(error.code === code, `${what}: expected ${code}, got ${error.code} ${error.message}`)
  if (hint) assert(error.hint === hint, `${what}: expected hint ${hint}, got ${error.hint}`)
}
async function invoke(client, name, body) {
  const response = await client.functions.invoke(name, { body })
  if (!response.error) return { status: 200, body: response.data }
  if (response.error instanceof FunctionsHttpError) {
    return { status: response.error.context.status, body: await response.error.context.json().catch(() => ({})) }
  }
  throw new Error(`${name}: ${response.error.message}`)
}
async function signIn(email, password) {
  const client = createClient(url, anonKey, options)
  await ok(client.auth.signInWithPassword({ email, password }), `sign in ${email}`)
  return client
}
/** A staff member of a new organization, added by its Super Admin (as Add Staff does). */
async function staff(organization, key, department, roles) {
  const email = `e2e-ddr-${key}-${run}@test.invalid`
  const password = `E2e-${randomUUID()}`
  const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`)
  await ok(organization.admin.client.rpc('add_user', { p_user_id: user.id, p_email: email, p_full_name: `E2E ${key}`, p_phone: '+966500000000',
    p_position: 'Officer', p_department_id: department, p_roles: roles }), `add ${key}`)
  return { id: user.id, email, password, client: await signIn(email, password) }
}
const department = (id) => db.row(`select id, name, initials, description, email, division_id, updated_at, removed_at, deletion_job_id, system_key,
  is_quality, requires_compliance_check from public.departments where id = ${lit(id)}`)
const pdf = () => new Blob([`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`], { type: 'application/pdf' })

// Two new organizations, as Request Hawkim makes them; A has an author in its Pharmacovigilance department.
const a = await people.newOrganization('a')
const b = await people.newOrganization('b')
const aAuthor = await staff(a, 'a-author', a.departments.PV, ['author'])

try {
  // ---------- Default departments ----------
  await check('a new organization has its own Pharmacovigilance and Quality Assurance, marked and configured', async () => {
    const pv = await department(a.departments.PV)
    const qa = await department(a.departments.QA)
    assert(pv.system_key === 'pharmacovigilance' && pv.name === 'Pharmacovigilance' && pv.requires_compliance_check && !pv.is_quality, 'PV')
    assert(qa.system_key === 'quality-assurance' && qa.name === 'Quality Assurance' && qa.is_quality && !qa.requires_compliance_check, 'QA')
    assert(a.departments.PV !== b.departments.PV, 'each organization has its own')
  })

  await check('delete-department: a default department gets a clear refusal (409 default-department), nothing changes', async () => {
    for (const id of [a.departments.PV, a.departments.QA]) {
      const before = await department(id)
      const result = await invoke(a.admin.client, 'delete-department', { departmentId: id, expectedUpdatedAt: before.updated_at, confirmDeleteSops: true })
      assert(result.status === 409 && result.body.errorCode === 'default-department', `answered ${result.status} ${JSON.stringify(result.body)}`)
      assert(Object.keys(result.body).length === 1, `only the error code is returned: ${JSON.stringify(result.body)}`)
      const after = await department(id)
      assert(!after.removed_at && !after.deletion_job_id && after.updated_at === before.updated_at, 'department unchanged')
      assert(!(await db.rows(`select id from public.department_file_deletions where department_id = ${lit(id)}`)).length, 'no cleanup job')
    }
  })

  await check('delete-department: another organization\'s default department is answered as unknown, never as a default one', async () => {
    const target = await department(a.departments.QA)
    const other = await invoke(b.admin.client, 'delete-department', { departmentId: target.id, expectedUpdatedAt: target.updated_at, confirmDeleteSops: true })
    const unknown = await invoke(b.admin.client, 'delete-department', { departmentId: `department-${randomUUID()}`, expectedUpdatedAt: target.updated_at, confirmDeleteSops: true })
    assert(other.status === 409 && other.body.errorCode === 'conflict', `answered ${other.status} ${JSON.stringify(other.body)}`)
    assert(JSON.stringify(other) === JSON.stringify(unknown), `differs from an unknown id: ${JSON.stringify(other)} / ${JSON.stringify(unknown)}`)
    assert(!(await department(target.id)).removed_at, 'still there')
  })

  await check('delete-department: an author is refused before any department is looked at (403)', async () => {
    const target = await department(a.departments.PV)
    const result = await invoke(aAuthor.client, 'delete-department', { departmentId: target.id, expectedUpdatedAt: target.updated_at, confirmDeleteSops: true })
    assert(result.status === 403 && result.body.errorCode === 'forbidden', `answered ${result.status} ${JSON.stringify(result.body)}`)
  })

  await check('the API refuses renaming a default department, and allows its description, email and division', async () => {
    const pv = await department(a.departments.PV)
    await refused(a.admin.client.rpc('save_department', { p_id: pv.id, p_name: 'Drug Safety', p_initials: 'DS', p_description: 'x', p_division_id: null,
      p_expected_updated_at: pv.updated_at, p_email: 'pv@hawkim.test' }), '23514', 'rename', 'default-department')
    await refused(a.admin.client.rpc('delete_department', { p_id: pv.id, p_sop_action: 'empty', p_expected_updated_at: pv.updated_at }), 'P0001', 'delete', 'default-department')
    const division = await ok(a.admin.client.rpc('save_division', { p_id: null, p_name: `E2E DDR Division ${run}`, p_description: 'About', p_email: 'div@hawkim.test' }), 'division')
    await ok(a.admin.client.rpc('save_department', { p_id: pv.id, p_name: 'Pharmacovigilance', p_initials: 'PV', p_description: 'Drug safety',
      p_division_id: division, p_expected_updated_at: pv.updated_at, p_email: 'pv@hawkim.test' }), 'edit details and move')
    const after = await department(pv.id)
    assert(after.division_id === division && after.description === 'Drug safety' && after.email === 'pv@hawkim.test' && after.name === 'Pharmacovigilance', 'saved')
  })

  await check('an ordinary department is still deleted by delete-department (200 completed)', async () => {
    const division = (await department(a.departments.PV)).division_id
    const id = await ok(a.admin.client.rpc('save_department', { p_id: null, p_name: `E2E DDR Plain ${run}`, p_initials: 'ZQX', p_description: 'Plain',
      p_division_id: division, p_email: 'plain@hawkim.test' }), 'ordinary department')
    const row = await department(id)
    const result = await invoke(a.admin.client, 'delete-department', { departmentId: id, expectedUpdatedAt: row.updated_at, confirmDeleteSops: true })
    assert(result.status === 200 && result.body.state === 'completed', `answered ${result.status} ${JSON.stringify(result.body)}`)
    assert((await department(id)).removed_at, 'removed')
  })

  // ---------- Guideline availability and Check Compliance ----------
  let sopId
  await check('a new organization has no guideline: availability "none", and the database starts no check', async () => {
    assert(!(await db.rows(`select id from public.guideline_versions where organization_id = ${lit(a.id)}`)).length, 'no versions')
    assert((await ok(aAuthor.client.rpc('guideline_availability'), 'availability')) === 'none', 'none')
    const path = `${a.id}/${aAuthor.id}/${randomUUID()}.pdf`
    await ok(aAuthor.client.storage.from('sop-files').upload(path, pdf(), { contentType: 'application/pdf' }), 'upload without a guideline')
    sopId = await ok(aAuthor.client.rpc('create_sop', { p_title: `E2E DDR SOP ${run}`, p_description: '', p_department_id: a.departments.PV,
      p_storage_path: path, p_file_name: 'Procedure.pdf' }), 'create an SOP without a guideline')
    await refused(aAuthor.client.rpc('start_compliance_check', { p_sop_id: sopId }), 'P0002', 'check without a guideline')
    assert(!(await db.rows(`select id from public.compliance_checks where sop_id = ${lit(sopId)}`)).length, 'no check recorded')
  })

  await check('an added version waiting to be processed: availability "processing", still no check', async () => {
    const draft = randomUUID()
    await db.run(`insert into public.guideline_version_drafts (id, name, version, issued_date, source, file_name, storage_path, file_size, created_by,
      processing_status, organization_id) values (${lit(draft)}, 'E2E GVP', '1.0', current_date, 'https://www.sfda.gov.sa/gvp', 'gvp.pdf',
      ${lit(`${a.id}/files/${draft}.pdf`)}, 1, ${lit(a.admin.id)}, 'waiting', ${lit(a.id)});`)
    assert((await ok(aAuthor.client.rpc('guideline_availability'), 'availability')) === 'processing', 'processing')
    assert((await ok(b.admin.client.rpc('guideline_availability'), 'B availability')) === 'none', 'B is told about its own organization only')
    await refused(aAuthor.client.rpc('start_compliance_check', { p_sop_id: sopId }), 'P0002', 'check while processing')
    await db.run(`delete from public.guideline_version_drafts where id = ${lit(draft)};`)
  })

  // ---------- Regulatory Guideline Addition, from the Author to the Admin ----------
  let requestId
  await check('the Author sends a Regulatory Guideline Addition; it is saved and survives a new session', async () => {
    requestId = await ok(aAuthor.client.rpc('submit_user_request', { p_type: 'regulatory-guideline-addition',
      p_title: 'Request to Add a Regulatory Guideline', p_description: 'We have no regulatory guideline for compliance checking.' }), 'submit')
    await aAuthor.client.auth.signOut()
    const again = await signIn(aAuthor.email, aAuthor.password)
    const { data } = await again.from('user_requests').select('id, type, title, status, requester_id')
    assert(data?.length === 1 && data[0].id === requestId && data[0].status === 'pending' && data[0].requester_id === aAuthor.id,
      `after signing in again: ${JSON.stringify(data)}`)
    const row = await db.row(`select organization_id from public.user_requests where id = ${lit(requestId)}`)
    assert(row.organization_id === a.id, 'in the Author\'s organization')
  })

  await check('another organization\'s Admin can\'t read, count, cancel or decide it', async () => {
    const { data, count } = await b.admin.client.from('user_requests').select('id', { count: 'exact' })
    assert((data ?? []).length === 0 && count === 0, `B sees ${count}`)
    await refused(b.admin.client.rpc('decide_user_request', { p_id: requestId, p_decision: 'approved' }), 'P0002', 'B decides')
    await refused(b.admin.client.rpc('cancel_user_request', { p_id: requestId }), 'P0002', 'B cancels')
    const direct = await b.admin.client.from('user_requests').update({ status: 'approved' }).eq('id', requestId).select()
    assert(direct.error || !(direct.data ?? []).length, 'B updated it directly')
  })

  await check('the organization\'s Admin sees it, approves it; the decision persists and adds no guideline', async () => {
    const { data } = await a.admin.client.from('user_requests').select('id, status')
    assert(data?.some((row) => row.id === requestId && row.status === 'pending'), `A's Admin sees ${JSON.stringify(data)}`)
    await refused(aAuthor.client.rpc('decide_user_request', { p_id: requestId, p_decision: 'approved' }), '42501', 'the author decides')
    await ok(a.admin.client.rpc('decide_user_request', { p_id: requestId, p_decision: 'approved' }), 'approve')
    const author = await signIn(aAuthor.email, aAuthor.password)
    const { data: mine } = await author.from('user_requests').select('status, decided_by, decided_at').eq('id', requestId)
    assert(mine?.[0]?.status === 'approved' && mine[0].decided_by === a.admin.id && mine[0].decided_at, `the author sees ${JSON.stringify(mine)}`)
    await refused(author.rpc('cancel_user_request', { p_id: requestId }), 'P0001', 'cancel after approval', 'not-pending')
    assert(!(await db.rows(`select id from public.guideline_versions where organization_id = ${lit(a.id)}
      union all select id from public.guideline_version_drafts where organization_id = ${lit(a.id)}`)).length, 'no guideline was added')
  })

  await check('the Author cancels a pending request of their own', async () => {
    const author = await signIn(aAuthor.email, aAuthor.password)
    const id = await ok(author.rpc('submit_user_request', { p_type: 'regulatory-guideline-addition', p_title: 'Second', p_description: 'Again' }), 'submit')
    await ok(author.rpc('cancel_user_request', { p_id: id }), 'cancel')
    assert((await db.row(`select status from public.user_requests where id = ${lit(id)}`)).status === 'cancelled', 'cancelled')
  })
} finally {
  for (const line of results) console.log(line)
  console.log(`${results.length - failed} passed, ${failed} failed`)
}
process.exit(failed ? 1 : 0)
