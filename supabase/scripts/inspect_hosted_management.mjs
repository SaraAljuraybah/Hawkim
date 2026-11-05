// Read-only project/schema probe. No migration, file mutation or production fixture writes.
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../frontend/package.json',import.meta.url))
const { createClient } = require('@supabase/supabase-js')
const root = new URL('../../',import.meta.url)
const env = { ...process.env }
for (const name of ['frontend/.env.local','.env.hosted.local']) {
  const file = new URL(name,root)
  if (!existsSync(file)) continue
  for (const line of readFileSync(file,'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match && !env[match[1]]) env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g,'')
  }
}
const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) throw new Error('Configure the existing frontend Supabase URL and publishable key')
const origin = new URL(url)
if (origin.protocol !== 'https:' || !origin.hostname.endsWith('.supabase.co')) throw new Error('Expected the configured hosted Supabase project')
const project = origin.hostname.split('.')[0]
const report = { project, url:origin.origin, checkedAt:new Date().toISOString(), remoteWrites:false, checks:[], blockers:[] }
const headers = { apikey:key }
const settings = await fetch(url+'/auth/v1/settings',{ headers,signal:AbortSignal.timeout(15000) })
report.checks.push({ name:'Auth endpoint connectivity',httpStatus:settings.status })
const api = await fetch(url+'/rest/v1/',{ headers:{ ...headers,Accept:'application/openapi+json' },signal:AbortSignal.timeout(15000) })
report.checks.push({ name:'PostgREST connectivity',httpStatus:api.status })
if (api.ok) {
  const spec = await api.json()
  const paths = Object.keys(spec.paths??{})
  report.checks.push({ name:'Public schema visibility (not authenticated readiness)', availableManagementRpcs:paths.filter((path)=>/divisions_departments|save_division|delete_division|save_department|delete_department|file_deletion/.test(path)) })
}
const edge = await fetch(url+'/functions/v1/delete-department',{ method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000) })
report.checks.push({ name:'Unauthenticated cleanup endpoint probe (no delete intent)',httpStatus:edge.status })
if (env.SUPABASE_ACCESS_TOKEN) {
  const query = `select version,name from supabase_migrations.schema_migrations order by version`
  const ledger = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{
    method:'POST',headers:{Authorization:`Bearer ${env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({query,read_only:true}),signal:AbortSignal.timeout(15000) })
  if (ledger.ok) {
    const rows = await ledger.json()
    const versions = new Set(rows.map((row)=>row.version))
    report.checks.push({ name:'Remote migration ledger', appliedVersions:[...versions], missingLocalVersions:readdirSync(new URL('supabase/migrations/',root)).filter((name)=>name.endsWith('.sql')&&!versions.has(name.split('_')[0])) })
  } else report.blockers.push('Remote migration ledger access returned HTTP '+ledger.status)
} else report.blockers.push('SUPABASE_ACCESS_TOKEN or read-only database access is required to inspect the remote migration ledger and schema')
if (env.HAWKIM_TEST_ADMIN_EMAIL && env.HAWKIM_TEST_ADMIN_PASSWORD) {
  const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const {error} = await client.auth.signInWithPassword({email:env.HAWKIM_TEST_ADMIN_EMAIL,password:env.HAWKIM_TEST_ADMIN_PASSWORD})
  if (error) report.blockers.push('Dedicated admin authentication failed; verify local account configuration')
  else {
    const {data,error:rpcError} = await client.rpc('get_divisions_departments')
    report.checks.push({name:'Authenticated read-only management snapshot',success:!rpcError,divisionCount:data?.divisions?.length,departmentCount:data?.departments?.length,errorCode:rpcError?.code})
  }
} else report.blockers.push('Dedicated HAWKIM_TEST_ADMIN_EMAIL/PASSWORD required for authenticated hosted verification')
mkdirSync(new URL('docs/verification/',root),{recursive:true})
writeFileSync(new URL('docs/verification/hosted-management.json',root),JSON.stringify(report,null,2)+'\n')
console.log(JSON.stringify(report,null,2))
