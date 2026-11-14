// Disposable people for the *.local.mjs tests, made the way the app makes them, never by inserting
// profiles or roles directly (the service role can't, and the database rules would be skipped):
//
//  - The first Admin: the Super Admin if the local database has one (its sign-in password is replaced,
//    which is fine only on a disposable local stack), otherwise any active Admin, otherwise one made by
//    Request Hawkim: submit_access_request and accept_access_request, the database calls of the
//    access-requests Edge Function (its review emails are left out).
//  - Everyone else: a sign-in account (as the add-user Edge Function creates it) and add_user called by
//    that Admin, which is what Add Staff and Add Admin call.
//
// Only for a LOCAL stack: the tests that use it refuse any URL that isn't localhost.
import { createRequire } from 'node:module'
import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

async function ok(promise, what) {
  const { data, error } = await promise
  if (error) throw new Error(`${what}: ${error.message ?? JSON.stringify(error)}`)
  return data
}

/** One value from the local database, as its owner (docker exec psql). */
function ownerValue(container, sql) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-At', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
      { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (data) => { stdout += data })
    child.stderr.on('data', (data) => { stderr += data })
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`psql: ${stderr.trim()}`)))
    child.stdin.end(sql)
  })
}

/** A value as an SQL literal ('it''s', null). Test values only. */
export const lit = (value) => value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`

/**
 * Fixture reads and writes as the database owner: the API roles, the service role included, have no
 * direct table access (they go through the functions), so a test reads and changes rows here instead.
 */
export function owner(container = process.env.HAWKIM_DB_CONTAINER ?? 'supabase_db_Hawkim') {
  return {
    /** The rows of a SELECT, as objects. */
    rows: async (sql) => JSON.parse(await ownerValue(container, `select coalesce(json_agg(q), '[]') from (${sql}) q;`)),
    /** The first row of a SELECT (throws when there is none). */
    row: async (sql) => {
      const rows = JSON.parse(await ownerValue(container, `select coalesce(json_agg(q), '[]') from (${sql}) q;`))
      if (!rows.length) throw new Error(`no row: ${sql}`)
      return rows[0]
    },
    /** Runs statements; throws with the database's message when they fail. */
    run: (sql) => ownerValue(container, sql),
    /** Runs statements: { ok, message } instead of throwing. */
    attempt: (sql) => ownerValue(container, sql).then(() => ({ ok: true, message: '' }), (error) => ({ ok: false, message: error.message })),
  }
}

/**
 * @param {{ url: string, anonKey: string, service: any, options: object, run: string, prefix: string,
 *           container?: string }} settings
 */
export function localPeople({ url, anonKey, service, options, run, prefix, container = process.env.HAWKIM_DB_CONTAINER ?? 'supabase_db_Hawkim' }) {
  let admin = null

  async function signIn(email, password, what) {
    const client = createClient(url, anonKey, options)
    await ok(client.auth.signInWithPassword({ email, password }), `sign in ${what}`)
    return client
  }

  /** The Admin who adds everyone else: { id, email, password, client }. */
  async function firstAdmin() {
    if (admin) return admin
    const password = `E2e-${randomUUID()}`
    const existing = await ownerValue(container, `
      select p.id || ' ' || p.email from public.profiles p
      where public.is_active_admin(p.id)
      order by exists (select 1 from public.organizations o where o.super_admin_id = p.id) desc, p.email
      limit 1;`)
    if (existing) {
      const [id, email] = existing.split(' ')
      await ok(service.auth.admin.updateUserById(id, { password }), 'set the first Admin\'s password')
      admin = { id, email, password, client: await signIn(email, password, 'first Admin') }
      return admin
    }
    // A new local database: the first Admin comes from Request Hawkim, as on a new deployment.
    const email = `${prefix}-first-admin-${run}@test.invalid`
    const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const requestId = await ok(service.rpc('submit_access_request', {
      p_organization: `E2E Organization ${prefix} ${run}`, p_contact_name: 'E2E First Admin', p_job_title: null, p_email: email,
      p_phone: '+966500000000', p_approx_users: 10, p_message: null, p_token_hash: tokenHash,
      p_organization_email: 'info@organization.test', p_organization_address: 'King Fahd Road, Riyadh',
      p_organization_maps_url: null, p_organization_website: null, p_organization_description: 'A test organization.',
    }), 'submit_access_request')
    const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), 'create the first Admin')
    await ok(service.rpc('accept_access_request', { p_id: requestId, p_token_hash: tokenHash, p_user_id: user.id, p_department: null }),
      'accept_access_request')
    admin = { id: user.id, email, password, client: await signIn(email, password, 'first Admin') }
    return admin
  }

  /**
   * A person added through add_user: { id, email, password, client, department, roles }. Admins get no
   * department or position (as Add Admin); staff get the department, position and roles.
   */
  async function person(key, department, roles, position = 'Specialist') {
    const adder = await firstAdmin()
    const email = `${prefix}-${key}-${run}@test.invalid`.toLowerCase()
    const password = `E2e-${randomUUID()}`
    const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), `create ${key}`)
    await ok(adder.client.rpc('add_user', {
      p_user_id: user.id, p_email: email, p_full_name: `E2E ${key}`, p_phone: '+966500000000',
      p_position: roles.includes('admin') ? null : position, p_department_id: roles.includes('admin') ? null : department,
      p_roles: roles,
    }), `add ${key}`)
    return { id: user.id, email, password, client: await signIn(email, password, key), department, roles }
  }

  return { firstAdmin, person }
}
