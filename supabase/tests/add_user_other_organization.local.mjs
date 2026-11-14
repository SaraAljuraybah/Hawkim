// End-to-end test of the add-user Edge Function across organizations (20261117140000), against a REAL LOCAL
// Supabase stack (PostgreSQL, Auth, PostgREST, Edge Functions) with every migration applied. Disposable data
// only; it refuses any URL that isn't localhost, so it can never touch the shared project.
//
//   supabase start
//   supabase functions serve --env-file <file>   (see supabase/tests/README.md)
//   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=<local anon key> \
//   SUPABASE_SERVICE_ROLE_KEY=<local service_role key> node supabase/tests/add_user_other_organization.local.mjs
//
// An Admin of a second organization adds the email of a MedCare person (active, or deactivated): add-user
// answers "email taken" and doesn't touch that person's sign-in account (their password still works).
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { localPeople } from './local_people.mjs'

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
const people = localPeople({ url, anonKey, service, options, run, prefix: 'e2e-xorg' })
const results = []
let failed = 0
function assert(condition, message) { if (!condition) throw new Error(message) }
async function check(name, fn) {
  try { await fn(); results.push(`PASS  ${name}`) } catch (error) { failed++; results.push(`FAIL  ${name}: ${error.message}`) }
}
async function addStaff(client, details) {
  const response = await client.functions.invoke('add-user', { body: details })
  if (!response.error) return { status: 200, body: response.data }
  if (response.error instanceof FunctionsHttpError) {
    return { status: response.error.context.status, body: await response.error.context.json().catch(() => ({})) }
  }
  throw new Error(`add-user: ${response.error.message}`)
}
async function signsIn(email, password) {
  const { data } = await createClient(url, anonKey, options).auth.signInWithPassword({ email, password })
  return !!data?.session
}

// MedCare: an Admin, an active author and a deactivated one. Other: a new organization from Request Hawkim.
const medAdmin = await people.firstAdmin()
const active = await people.person('active', 'regulatory-affairs', ['author'])
const former = await people.person('former', 'regulatory-affairs', ['author'])
{
  const { error } = await medAdmin.client.rpc('deactivate_staff', { p_user_id: former.id })
  if (error) throw new Error(`deactivate: ${error.message}`)
}
const other = await people.newOrganization('other')

for (const [label, target] of [['active', active], ['deactivated', former]]) {
  await check(`An Admin of another organization adding a MedCare person's email (${label}): email taken, account untouched`, async () => {
    const result = await addStaff(other.admin.client, {
      name: 'Taken Over', email: target.email, phone: '+966512340009', position: 'Officer',
      departmentId: other.departments.PV, permissions: ['author'],
    })
    assert(result.status === 409 && result.body.errorCode === 'email-taken', `status ${result.status} ${JSON.stringify(result.body)}`)
    assert(await signsIn(target.email, target.password), 'their password was changed')
  })
}
await check('The other organization still adds its own people', async () => {
  const email = `e2e-xorg-own-${run}@test.invalid`
  const result = await addStaff(other.admin.client, {
    name: 'Own Person', email, phone: '+966512340010', position: 'Officer', departmentId: other.departments.PV, permissions: ['author'],
  })
  assert(result.status === 200 && result.body.user?.id, `status ${result.status} ${JSON.stringify(result.body)}`)
})

console.log(results.join('\n'))
console.log(failed ? `\n${failed} failed` : `\nAll ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
