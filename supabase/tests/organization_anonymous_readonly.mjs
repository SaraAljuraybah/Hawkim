// Optional read-only smoke check against the frontend-configured Supabase project.
// node --env-file=frontend/.env.local supabase/tests/organization_anonymous_readonly.mjs
// No login, stored user session, writes, migration actions or response bodies logged.
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key || !(key.startsWith('sb_publishable_') || key.startsWith('eyJ'))) throw new Error('A frontend URL and publishable/anon key are required')
if (key.startsWith('eyJ')) {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
  if (payload.role !== 'anon') throw new Error('Only a public anon key is permitted')
}
const parsed = new URL(url)
if (parsed.origin !== url) throw new Error('Expected a project origin URL')
let requests = 0
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => { requests++; return fetch(input, { ...init, signal: AbortSignal.timeout(15000) }) } },
})
console.log(`Anonymous read-only target: ${parsed.hostname}`)
let failures = 0
for (const [label, query] of [
  ['RPC', () => client.rpc('get_organizational_structure')],
  ['divisions', () => client.from('divisions').select('id').limit(1)],
  ['profiles', () => client.from('profiles').select('id').limit(1)],
  ['departments', () => client.from('departments').select('id').limit(1)],
  ['user_roles', () => client.from('user_roles').select('user_id').limit(1)],
]) {
  const { data, error, status } = await query()
  // Missing endpoints and transport failures do not prove authorization.
  const denied = [401, 403].includes(status) && error?.code === '42501'
  if (denied) console.log(`PASS ${label}: denied (HTTP ${status}, PostgreSQL 42501)`)
  else {
    failures++
    const visible = Array.isArray(data) ? data.length : data != null ? 1 : 0
    console.log(`UNVERIFIED ${label}: HTTP ${status}, code ${error?.code || 'none'}, visible rows/payload ${visible}`)
  }
}
console.log(`Read-only requests sent: ${requests}; inconclusive or unsafe results: ${failures}`)
if (failures) process.exitCode = 1
