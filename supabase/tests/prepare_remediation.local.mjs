// Writes only an ignored NEW local project. Does not start Docker or connect to hosted services.
import { mkdirSync, cpSync, writeFileSync, existsSync } from 'node:fs'
import assert from 'node:assert/strict'
import { hostedAccessFixture, hostedOrganizationDrift } from './hostedAccessFixture.mjs'
const destination=new URL('../../.local-tests/remediation-20261105/supabase/',import.meta.url)
assert(!existsSync(new URL('./config.toml',destination)),'Refuse to overwrite an existing disposable project')
mkdirSync(destination,{recursive:true})
for(const folder of ['migrations','functions'])cpSync(new URL('../'+folder,import.meta.url),new URL('./'+folder,destination),{recursive:true})
writeFileSync(new URL('./migrations/20261105120000_access_requests.sql',destination),hostedAccessFixture()+'\n'+hostedOrganizationDrift)
writeFileSync(new URL('./config.toml',destination),`project_id = "hawkim-remediation-20261105"
[api]
enabled = true
port = 57431
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
[db]
port = 57432
shadow_port = 57430
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[analytics]
enabled = false
[auth]
enabled = true
site_url = "http://127.0.0.1:5173"
[auth.email]
enable_confirmations = false
[local_smtp]
port = 57434
[storage]
enabled = true
[realtime]
enabled = false
[edge_runtime]
inspector_port = 8283
[functions.delete-department]
verify_jwt = false
[functions.manage-users]
verify_jwt = false
`)
console.log('Prepared NEW disposable remediation project with observed catalog fixture (not recovered migration history)')
