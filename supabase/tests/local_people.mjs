// Disposable people for the *.local.mjs tests, made the way the app makes them, never by inserting
// profiles or roles directly (the service role can't, and the database rules would be skipped):
//
//  - The first Admin: MedCare's Super Admin if the local database has one (its sign-in password is replaced,
//    which is fine only on a disposable local stack), otherwise any active MedCare Admin, otherwise one made
//    by the database owner, as seed.sql makes its people (Request Hawkim would create a new organization).
//  - Everyone else: a sign-in account (as the add-user Edge Function creates it) and add_user called by
//    that Admin, which is what Add Staff and Add Admin call.
//
// Only for a LOCAL stack: the tests that use it refuse any URL that isn't localhost.
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
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
        and p.organization_id = (select o.id from public.organizations o order by o.created_at, o.id limit 1)
      order by exists (select 1 from public.organizations o where o.super_admin_id = p.id) desc, p.email
      limit 1;`)
    if (existing) {
      const [id, email] = existing.split(' ')
      await ok(service.auth.admin.updateUserById(id, { password }), 'set the first Admin\'s password')
      admin = { id, email, password, client: await signIn(email, password, 'first Admin') }
      return admin
    }
    // A new local database has no MedCare Admin (the seed makes profiles only for existing sign-in
    // accounts), and Request Hawkim now creates a NEW organization (20261117130000): the first MedCare Admin
    // is made by the database owner, as seed.sql makes its people. Everyone else is added through add_user.
    const email = `${prefix}-first-admin-${run}@test.invalid`
    const { user } = await ok(service.auth.admin.createUser({ email, password, email_confirm: true }), 'create the first Admin')
    await ownerValue(container, `
      begin;
      insert into public.profiles (id, full_name, email, initials, phone, organization_id)
      select '${user.id}', 'E2E First Admin', '${email}', 'FA', '+966500000000', o.id
      from public.organizations o order by o.created_at, o.id limit 1;
      insert into public.user_roles (user_id, role) values ('${user.id}', 'admin');
      commit;`)
    admin = { id: user.id, email, password, client: await signIn(email, password, 'first Admin') }
    return admin
  }

  /**
   * A person added through add_user: { id, email, password, client, department, roles, organizationId }. Admins get no
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
    // Their organization: the first folder of the files they upload (20261116230000).
    const organizationId = await ownerValue(container, `select organization_id from public.profiles where id = '${user.id}';`)
    return { id: user.id, email, password, client: await signIn(email, password, key), department, roles, organizationId }
  }

  return { firstAdmin, person }
}
