// Destructive tests accept only these owned disposable projects, never a URL from application env.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
const environments={
 deletion:{project:'hawkim-deletion-20261105',directory:'deletion-20261105',api:56431,db:56432},
 remediation:{project:'hawkim-remediation-20261105',directory:'remediation-20261105',api:57431,db:57432},
}
export function localManagementTarget() {
 const target=environments[process.env.HAWKIM_LOCAL_TEST_ENV??'deletion']
 assert(target,'Unknown disposable test environment')
 const container='supabase_db_'+target.project
 for(const service of ['db','storage']) {
  const name='supabase_'+service+'_'+target.project
  const inspect=JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8'}))[0]
  assert(inspect.Mounts.some(m=>m.Name===name))
  assert(inspect.Mounts.filter(m=>m.Type==='volume').every(m=>m.Name.endsWith('_'+target.project)))
  if(service==='db')assert.equal(inspect.HostConfig.PortBindings['5432/tcp'][0].HostPort,String(target.db))
 }
 const configuration=JSON.parse(readFileSync(new URL(`../../.local-tests/${target.directory}/status.local.json`,import.meta.url),'utf8').trim())
 assert.equal(configuration.API_URL,`http://127.0.0.1:${target.api}`)
 assert.equal(configuration.DB_URL,`postgresql://postgres:postgres@127.0.0.1:${target.db}/postgres`)
 assert(configuration.ANON_KEY&&configuration.SERVICE_ROLE_KEY)
 return {container,configuration}
}
