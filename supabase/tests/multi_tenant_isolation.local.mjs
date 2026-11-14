// The multi-tenant isolation test through the real API: Storage (all three buckets), the Edge Functions and
// PostgREST, against a REAL LOCAL Supabase stack with every migration applied (supabase/tests/README.md).
// Disposable data only; it refuses any URL that isn't localhost, so it can never touch the shared project.
// The database side (every table and every function) is supabase/tests/multi_tenant_isolation.sql.
//
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role key> node supabase/tests/multi_tenant_isolation.local.mjs
//
// A is MedCare: an Admin, an author with an SOP and its file, a GVP file and an index file. B is a second
// organization made through Request Hawkim, with its Super Admin and an author. B's people try to read, list,
// sign, upload, remove, delete and change A's things; nothing of A's may come back or change.
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
const people = localPeople({ url, anonKey, service, options, run, prefix: 'e2e-iso' })
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
async function invoke(client, name, body) {
  const response = await client.functions.invoke(name, { body })
  if (!response.error) return { status: 200, body: response.data }
  if (response.error instanceof FunctionsHttpError) {
    return { status: response.error.context.status, body: await response.error.context.json().catch(() => ({})) }
  }
  throw new Error(`${name}: ${response.error.message}`)
}
const pdf = () => new Blob([`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`], { type: 'application/pdf' })

// ---------- A: MedCare ----------
const aAdmin = await people.firstAdmin()
const aAuthor = await people.person('a-author', 'regulatory-affairs', ['author'])
const aOrg = aAuthor.organizationId
const aSopPath = `${aOrg}/${aAuthor.id}/${randomUUID()}.pdf`
await ok(aAuthor.client.storage.from('sop-files').upload(aSopPath, pdf(), { contentType: 'application/pdf' }), 'A uploads an SOP file')
const aSop = await ok(aAuthor.client.rpc('create_sop', { p_title: `E2E Iso A SOP ${run}`, p_description: '', p_department_id: 'regulatory-affairs',
  p_storage_path: aSopPath, p_file_name: 'A.pdf' }), 'A creates an SOP')
const aGvpPath = `${aOrg}/files/${randomUUID()}.pdf`
await ok(aAdmin.client.storage.from('guideline-files').upload(aGvpPath, pdf(), { contentType: 'application/pdf' }), 'A uploads a GVP file')
const aIndexPath = `${aOrg}/versions/${randomUUID()}/meta.json`
await ok(service.storage.from('guideline-indexes').upload(aIndexPath, new Blob(['{}'], { type: 'application/json' }), { contentType: 'application/json' }),
  'the service stores an index of A')
// An empty department of A's, which A itself could delete: B's refusal can only be the organization's.
const aDivision = await ok(aAdmin.client.rpc('save_division', { p_id: null, p_name: `E2E Iso A Division ${run}`, p_description: '', p_email: '' }),
  'A adds a division')
const aDepartment = await ok(aAdmin.client.rpc('save_department', { p_id: null, p_name: `E2E Iso A Dept ${run}`,
  p_initials: String.fromCharCode(65 + Math.floor(Math.random() * 26), 65 + Math.floor(Math.random() * 26), 65 + Math.floor(Math.random() * 26)),
  p_description: '', p_division_id: aDivision, p_expected_updated_at: null, p_email: '' }), 'A adds a department')
const aDepartmentRow = await db.row(`select id, updated_at from public.departments where id = ${lit(aDepartment)}`)
await db.run(`insert into public.user_invitations (user_id, sent_at, sent_by) values (${lit(aAuthor.id)}, now() - interval '3 days', ${lit(aAdmin.id)})
  on conflict (user_id) do update set sent_at = excluded.sent_at, activated_at = null;`)

// ---------- B: a new organization from Request Hawkim ----------
const b = await people.newOrganization('b')
const bAuthorEmail = `e2e-iso-b-author-${run}@test.invalid`
const bAuthorPassword = `E2e-${randomUUID()}`
const { user: bAuthorAccount } = await ok(service.auth.admin.createUser({ email: bAuthorEmail, password: bAuthorPassword, email_confirm: true }), 'B author account')
await ok(b.admin.client.rpc('add_user', { p_user_id: bAuthorAccount.id, p_email: bAuthorEmail, p_full_name: 'E2E Iso B Author', p_phone: '+966500000000',
  p_position: 'Officer', p_department_id: b.departments.PV, p_roles: ['author'] }), 'B adds its author')
const bAuthor = createClient(url, anonKey, options)
await ok(bAuthor.auth.signInWithPassword({ email: bAuthorEmail, password: bAuthorPassword }), 'B author signs in')
const bCallers = [['B Super Admin', b.admin.client], ['B author', bAuthor]]

const fingerprint = () => db.row(`select
  (select md5(string_agg(to_jsonb(s)::text, '')) from public.sops s where s.id = ${lit(aSop)}) as sop,
  (select md5(string_agg(to_jsonb(p)::text, '' order by p.id)) from public.profiles p where p.organization_id = ${lit(aOrg)}) as people,
  (select md5(string_agg(to_jsonb(i)::text, '')) from public.user_invitations i where i.user_id = ${lit(aAuthor.id)}) as invitation,
  (select md5(string_agg(to_jsonb(d)::text, '')) from public.departments d where d.id = ${lit(aDepartmentRow.id)}) as department`)
const before = await fingerprint()

try {
  // ---------- Storage ----------
  for (const [who, client] of bCallers) {
    await check(`${who}: no file of A's in any bucket (list, download, signed link)`, async () => {
      for (const [bucket, path] of [['sop-files', aSopPath], ['guideline-files', aGvpPath], ['guideline-indexes', aIndexPath]]) {
        const folder = path.slice(0, path.lastIndexOf('/'))
        const listed = await client.storage.from(bucket).list(folder)
        assert(!(listed.data ?? []).length, `${bucket}: listed ${JSON.stringify(listed.data)}`)
        const top = await client.storage.from(bucket).list(aOrg)
        assert(!(top.data ?? []).length, `${bucket}: listed A's folder`)
        const downloaded = await client.storage.from(bucket).download(path)
        assert(downloaded.error && !downloaded.data, `${bucket}: downloaded ${path}`)
        const signed = await client.storage.from(bucket).createSignedUrl(path, 60)
        assert(signed.error && !signed.data?.signedUrl, `${bucket}: signed a link to ${path}`)
      }
    })
    await check(`${who}: no upload into A's folder and no removal of A's files`, async () => {
      const intoA = await client.storage.from('sop-files').upload(`${aOrg}/${aAuthor.id}/${randomUUID()}.pdf`, pdf(), { contentType: 'application/pdf' })
      assert(intoA.error, 'uploaded into A\'s SOP folder')
      const gvp = await client.storage.from('guideline-files').upload(`${aOrg}/files/${randomUUID()}.pdf`, pdf(), { contentType: 'application/pdf' })
      assert(gvp.error, 'uploaded into A\'s GVP folder')
      const index = await client.storage.from('guideline-indexes').upload(`${aOrg}/versions/${randomUUID()}/x.json`, new Blob(['{}']))
      assert(index.error, 'uploaded an index')
      await client.storage.from('sop-files').remove([aSopPath])
      await client.storage.from('guideline-files').remove([aGvpPath])
      await client.storage.from('guideline-indexes').remove([aIndexPath])
      for (const [bucket, path] of [['sop-files', aSopPath], ['guideline-files', aGvpPath], ['guideline-indexes', aIndexPath]]) {
        const still = await service.storage.from(bucket).download(path)
        assert(still.data && !still.error, `${bucket}: ${path} was removed`)
      }
    })
  }

  // ---------- Edge Functions ----------
  await check('delete-sop: B can\'t delete A\'s SOP or one of its versions', async () => {
    for (const [, client] of bCallers) {
      const sop = await invoke(client, 'delete-sop', { action: 'delete-sop', sopId: aSop, reason: 'Taken' })
      assert(sop.status >= 400, `delete-sop answered ${sop.status}`)
      const version = await invoke(client, 'delete-sop', { action: 'delete-version', sopId: aSop, version: 1 })
      assert(version.status >= 400, `delete-version answered ${version.status}`)
    }
  })
  await check('delete-department: B can\'t delete A\'s department', async () => {
    const result = await invoke(b.admin.client, 'delete-department', { departmentId: aDepartmentRow.id, expectedUpdatedAt: aDepartmentRow.updated_at, confirmDeleteSops: true })
    assert(result.status >= 400, `answered ${result.status} ${JSON.stringify(result.body)}`)
    // And through the database directly: unknown to B (the conflict answer), while A could delete it.
    const direct = await b.admin.client.rpc('delete_department', { p_id: aDepartmentRow.id, p_sop_action: 'empty', p_expected_updated_at: aDepartmentRow.updated_at })
    assert(direct.error?.hint === 'conflict', `delete_department: ${direct.error?.code} ${direct.error?.hint}`)
    assert((await db.row(`select removed_at from public.departments where id = ${lit(aDepartmentRow.id)}`)).removed_at === null, "A's department was removed")
  })
  await check('update-user-email: B can\'t change the email of A\'s person', async () => {
    const result = await invoke(b.admin.client, 'update-user-email', { userId: aAuthor.id, email: `e2e-iso-taken-${run}@test.invalid` })
    assert(result.status >= 400, `answered ${result.status}`)
    const account = await ok(service.auth.admin.getUserById(aAuthor.id), 'read A\'s account')
    assert(account.user.email === aAuthor.email, `A's sign-in email is now ${account.user.email}`)
  })
  await check('resend-invitation: B can\'t resend A\'s invitation', async () => {
    const result = await invoke(b.admin.client, 'resend-invitation', { userId: aAuthor.id })
    assert(result.status >= 400, `answered ${result.status}`)
  })

  // ---------- PostgREST: the tables ----------
  for (const [who, client] of bCallers) {
    await check(`${who}: reads no row of A's (profiles, departments, SOPs, versions, GVP versions, requirements)`, async () => {
      for (const table of ['profiles', 'departments', 'sops', 'sop_versions', 'guideline_versions', 'guideline_requirements', 'user_roles', 'timeline_events']) {
        const { data, error } = await client.from(table).select('organization_id').neq('organization_id', b.id).limit(5)
        assert(!error || error.code === '42501', `${table}: ${error?.message}`)
        assert(!(data ?? []).length, `${table}: ${data.length} row(s) of another organization`)
      }
    })
  }

  await check('Nothing of A\'s changed', async () => {
    const after = await fingerprint()
    assert(JSON.stringify(after) === JSON.stringify(before), `before ${JSON.stringify(before)} after ${JSON.stringify(after)}`)
    assert((await service.storage.from('sop-files').download(aSopPath)).data, 'A\'s SOP file is gone')
  })
} finally {
  await service.storage.from('guideline-files').remove([aGvpPath])
  await service.storage.from('guideline-indexes').remove([aIndexPath])
}

console.log(results.join('\n'))
console.log(failed ? `\n${failed} failed` : `\nAll ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
