// Admin user management that needs the Auth admin API: create (invite) and delete (ban) users.
// Permission changes need no Auth change and go straight to the set_user_roles RPC.
//
// Every request: Bearer token verified by Auth.getUser, then the database's active/non-banned
// Admin check AS THAT USER, before any service-role client exists. Every database rule runs in
// the admin's own RPC calls (create_employee_profile, delete_user_profile); the service role is
// only used for auth.admin.* calls. Responses never include SQL errors, tokens or keys.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { errorCodeFor, safeRedirect } from './rules.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store',
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ROLES = ['author', 'reviewer', 'approver', 'admin']
// Ban for ~100 years: the profile ends and the account can no longer sign in or refresh a session.
const BAN = '876000h'

const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === 'string')

async function createUser(body: Record<string, unknown>, user: SupabaseClient, server: SupabaseClient) {
  const { name, email, phone, departmentId, positions, roles } = body
  const redirectTo = safeRedirect(body.redirectTo)
  if (typeof name !== 'string' || typeof email !== 'string' || typeof phone !== 'string' || typeof departmentId !== 'string'
    || !strings(positions) || !strings(roles) || !(roles as string[]).every((role) => ROLES.includes(role)) || !redirectTo) {
    return json(400, { errorCode: 'invalid-request' })
  }
  const args = { p_name: name, p_email: email, p_phone: phone, p_department_id: departmentId, p_positions: positions, p_roles: roles }
  // Dry run first: every rule is checked before an Auth account (and its invitation) exists.
  const check = await user.rpc('create_employee_profile', { p_user_id: null, ...args })
  if (check.error) return json(409, { errorCode: errorCodeFor(check.error) })

  const invited = await server.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), { redirectTo })
  if (invited.error || !invited.data.user) {
    const exists = invited.error?.code === 'email_exists' || invited.error?.status === 422
    return json(exists ? 409 : 503, { errorCode: exists ? 'email-taken' : 'invite-failed' })
  }
  const id = invited.data.user.id
  const created = await user.rpc('create_employee_profile', { p_user_id: id, ...args })
  if (created.error) {
    // Never leave an Auth account without its profile. The invitation link stops working with it.
    await server.auth.admin.deleteUser(id).catch(() => undefined)
    return json(409, { errorCode: errorCodeFor(created.error) })
  }
  return json(201, { userId: id })
}

async function deleteUser(body: Record<string, unknown>, user: SupabaseClient, server: SupabaseClient) {
  if (typeof body.userId !== 'string' || !uuid.test(body.userId)) return json(400, { errorCode: 'invalid-request' })
  // The database decides (self, last admin, work in progress) and ends the profile; repeats are allowed.
  const ended = await user.rpc('delete_user_profile', { p_user_id: body.userId })
  if (ended.error) return json(409, { errorCode: errorCodeFor(ended.error) })
  const banned = await server.auth.admin.updateUserById(body.userId, { ban_duration: BAN })
  // The profile is already ended (no data access); a retry repeats the ban.
  if (banned.error) return json(503, { errorCode: 'ban-failed' })
  return json(200, { userId: body.userId })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json(405, { errorCode: 'method-not-allowed' })
  const url = Deno.env.get('SUPABASE_URL')
  const publicKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serverKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !publicKey || !serverKey) return json(503, { errorCode: 'not-configured' })
  const authorization = request.headers.get('Authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return json(401, { errorCode: 'unauthorized' })
  const user = createClient(url, publicKey, { global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false } })
  const { data: identity, error: authError } = await user.auth.getUser(authorization.slice(7))
  if (authError || !identity.user) return json(401, { errorCode: 'unauthorized' })
  const { data: allowed, error: permissionError } = await user.rpc('can_manage_organization')
  if (permissionError || allowed !== true) return json(403, { errorCode: 'forbidden' })
  let body: Record<string, unknown>
  try {
    const parsed = await request.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(400, { errorCode: 'invalid-request' })
    body = parsed as Record<string, unknown>
  } catch { return json(400, { errorCode: 'invalid-request' }) }
  try {
    const server = createClient(url, serverKey, { auth: { persistSession: false, autoRefreshToken: false } })
    if (body.action === 'create') return await createUser(body, user, server)
    if (body.action === 'delete') return await deleteUser(body, user, server)
    return json(400, { errorCode: 'invalid-request' })
  } catch {
    return json(503, { errorCode: 'failed' })
  }
})
