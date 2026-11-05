// Real local Auth/PostgREST/Edge authorization and observed access-request compatibility.
import { createRequire } from 'node:module'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { localManagementTarget } from './localManagementTarget.mjs'
assert.equal(process.env.HAWKIM_LOCAL_TEST_ENV,'remediation','Requires the NEW disposable remediation project')
const {container,configuration}=localManagementTarget()
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const {createClient}=require('@supabase/supabase-js')
const client=(key=configuration.ANON_KEY)=>createClient(configuration.API_URL,key,{auth:{persistSession:false,autoRefreshToken:false}})
const server=client(configuration.SERVICE_ROLE_KEY)
const run=randomUUID().slice(0,8),password='Local-only-'+randomUUID(),home='security-home-'+run
const ok=result=>{if(result.error)throw new Error(result.error.message);return result.data}
const rpc=async(c,name,args)=>ok(await c.rpc(name,args))
const sql=input=>execFileSync('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input,encoding:'utf8',timeout:60000})
ok(await server.from('departments').insert({id:home,name:'Security home '+run,initials:'SH'}))
async function account(label,roles=[]) {
 const email=`${label}-${run}@test.invalid`
 const user=ok(await server.auth.admin.createUser({email,password,email_confirm:true})).user
 ok(await server.from('profiles').insert({id:user.id,full_name:label,email,initials:'ST',department_id:home,position:'Test fixture title'}))
 if(roles.length)ok(await server.from('user_roles').insert(roles.map(role=>({user_id:user.id,role}))))
 const c=client();ok(await c.auth.signInWithPassword({email,password}))
 return {id:user.id,email,client:c}
}
const admin=await account('admin',['admin']),employee=await account('employee',['author','reviewer'])
const inactive=await account('inactive',['author']),inactiveAdmin=await account('inactive-admin',['admin'])
const banned=await account('banned',['author']),bannedAdmin=await account('banned-admin',['admin'])
for(const p of [inactive,inactiveAdmin])ok(await server.from('profiles').update({deleted_at:new Date().toISOString()}).eq('id',p.id))
for(const p of [banned,bannedAdmin])ok(await server.auth.admin.updateUserById(p.id,{ban_duration:'24h'}))
const division=await rpc(admin.client,'save_division',{p_id:null,p_name:'Security division '+run,p_description:'',p_email:null})
const updated=ok(await server.from('divisions').select('updated_at').eq('id',division).single()).updated_at
const department=await rpc(admin.client,'save_department',{p_id:null,p_name:'Security department '+run,p_initials:'SC',p_description:'',p_division_id:division})
const deptUpdated=ok(await server.from('departments').select('updated_at').eq('id',department).single()).updated_at
const mutations=[
 ['save_division',{p_id:division,p_name:'Unauthorized',p_description:'',p_email:null,p_expected_updated_at:updated}],
 ['delete_division',{p_id:division,p_expected_updated_at:updated}],
 ['save_department',{p_id:department,p_name:'Unauthorized',p_initials:'SC',p_description:'',p_division_id:division,p_expected_updated_at:deptUpdated}],
 ['delete_department',{p_id:department,p_sop_action:'empty',p_expected_updated_at:deptUpdated}],
 ['begin_department_file_deletion',{p_id:department,p_expected_updated_at:deptUpdated}],
 ['set_employee_positions',{p_profile_id:employee.id,p_titles:['Escalated title']}],
 ['set_user_roles',{p_user_id:employee.id,p_roles:['admin']}],
 ['delete_user_profile',{p_user_id:admin.id}],
 ['create_employee_profile',{p_user_id:null,p_name:'Escalated',p_email:'escalate@test.invalid',p_phone:'0512345678',p_department_id:home,p_positions:['Fixture'],'p_roles':['admin']}],
 ['accept_access_request',{p_id:randomUUID(),p_token_hash:'0'.repeat(64),p_user_id:employee.id,p_department:home}],
 ['reject_access_request',{p_id:randomUUID(),p_token_hash:'0'.repeat(64)}],
]
let negativeChecks=0
sql('create policy security_test_extra_read on public.divisions for select to authenticated using (true);')
try {
 for(const [label,c] of [['employee',employee.client],['anonymous',client()],['inactive employee',inactive.client],['inactive admin',inactiveAdmin.client],['banned employee',banned.client],['banned admin',bannedAdmin.client]]) {
  for(const name of ['can_read_organizational_structure','can_manage_organization']) {
   const result=await c.rpc(name)
   if(label==='anonymous')assert(result.error);else assert.equal(ok(result),false,label+' '+name)
   negativeChecks++
  }
  for(const name of ['get_organizational_structure','get_divisions_departments','get_employees_missing_positions']) {
   assert.equal((await c.rpc(name)).error?.code,'42501',label+' '+name);negativeChecks++
  }
  for(const [name,args] of mutations){assert.equal((await c.rpc(name,args)).error?.code,'42501',label+' '+name);negativeChecks++}
  const divisions=await c.from('divisions').select('id')
  assert(divisions.error || divisions.data.length===0,label+' direct divisions');negativeChecks++
  for(const name of ['delete-department','manage-users']) {
   const result=await c.functions.invoke(name,{body:name==='manage-users'?{action:'delete',userId:admin.id}:{departmentId:department,expectedUpdatedAt:deptUpdated,confirmDeleteSops:true}})
   assert([401,403].includes(result.error?.context?.status),label+' '+name);negativeChecks++
  }
  console.log('PASS denied organization reads/writes/Edge: '+label)
 }
} finally {sql('drop policy security_test_extra_read on public.divisions;')}
for(const name of ['can_read_organizational_structure','can_manage_organization'])assert.equal(await rpc(admin.client,name),true)
for(const name of ['get_organizational_structure','get_divisions_departments','get_employees_missing_positions'])await rpc(admin.client,name)
const hierarchy=await rpc(admin.client,'get_organizational_structure')
for(const d of hierarchy.departments)for(const p of d.employees)assert(!('email' in p)&&!('phone' in p),'Hierarchy contact fields leaked')
assert((ok(await admin.client.from('divisions').select('id'))).some(d=>d.id===division))
assert((ok(await employee.client.from('departments').select('id,name'))).some(d=>d.id===home))
assert.equal((await admin.client.rpc('delete_user_profile',{p_user_id:admin.id})).error?.code,'23514')
assert.equal((await admin.client.rpc('set_user_roles',{p_user_id:admin.id,p_roles:[]})).error?.code,'23514')
for(const c of [admin.client,employee.client])for(const [name,args] of [
 ['claim_department_file_deletion',{p_job_id:randomUUID()}],
 ['ack_department_file_deletion',{p_job_id:randomUUID(),p_lease_token:randomUUID(),p_deleted_paths:[],p_failed:false}],
 ['department_file_paths_present',{p_job_id:randomUUID(),p_paths:[]}],
])assert.equal((await c.rpc(name,args)).error?.code,'42501')
console.log('PASS active Admin reads; minimal hierarchy payload; employee department directory; browser worker isolation; sole usable Admin self-protection')

// Widening visibility in a future change must never authorize an administrative mutation.
sql("create or replace function public.can_read_organizational_structure() returns boolean language sql stable security definer set search_path='' as $$ select public.is_active_user(); $$;")
try {
 assert.equal(await rpc(employee.client,'can_read_organizational_structure'),true)
 assert.equal(await rpc(employee.client,'can_manage_organization'),false)
 for(const [name,args] of mutations)assert.equal((await employee.client.rpc(name,args)).error?.code,'42501',name)
 for(const name of ['delete-department','manage-users'])assert.equal((await employee.client.functions.invoke(name,{body:{}})).error?.context?.status,403)
} finally {sql(readFileSync(new URL('../migrations/20261105120100_organization_admin_authorization.sql',import.meta.url),'utf8'))}
assert.equal(await rpc(employee.client,'can_read_organizational_structure'),false)
console.log('PASS independent mutation authorization remains Admin-only when visibility helper is deliberately widened locally')

// Auth invitations stay in this project's local email sink; no hosted hook is configured.
const inviteEmail=`invited-${run}@test.invalid`
const createBody={action:'create',name:'Invited fixture',email:inviteEmail,phone:'0512345678',departmentId:home,
 positions:['Fixture primary','Fixture secondary'],roles:['author','reviewer'],redirectTo:'http://127.0.0.1:5173/reset-password'}
const invited=ok(await admin.client.functions.invoke('manage-users',{body:createBody}))
assert(invited.userId)
assert(ok(await server.auth.admin.getUserById(invited.userId)).user.invited_at)
assert.equal(ok(await server.from('profiles').select('email,position').eq('id',invited.userId).single()).email,inviteEmail)
assert.deepEqual(ok(await server.from('employee_positions').select('title').eq('profile_id',invited.userId).order('sort_order')).map(p=>p.title),createBody.positions)
assert.deepEqual(ok(await server.from('user_roles').select('role').eq('user_id',invited.userId).order('role')).map(p=>p.role),createBody.roles)
assert.equal((await admin.client.functions.invoke('manage-users',{body:createBody})).error?.context?.status,409)
assert.equal((await admin.client.functions.invoke('manage-users',{body:{...createBody,email:`invalid-${run}@test.invalid`,roles:['admin','author']}})).error?.context?.status,409)
assert.equal((await admin.client.functions.invoke('manage-users',{body:{...createBody,redirectTo:'https://example.invalid/other'}})).error?.context?.status,400)
console.log('PASS manage-users real local invitation: Auth/profile/positions/roles persist; duplicate, mixed-Admin roles and invalid redirect refused')

// Observed onboarding plus the approved forward change: only active Admin sessions decide requests.
// Submission/read helpers remain service-only; the missing external caller must be updated before rollout.
const tokenHash=()=>createHash('sha256').update(randomUUID()).digest('hex')
async function request(label) {
 const hash=tokenHash(),email=`request-${label}-${run}@test.invalid`
 const id=await rpc(server,'submit_access_request',{p_organization:'Disposable fixture',p_contact_name:'Fixture Applicant',p_job_title:'Applicant supplied fixture title',p_email:email,p_phone:'+966512345678',p_approx_users:3,p_message:'Local compatibility test',p_token_hash:hash})
 return {id,hash,email}
}
const requested=await request('accepted')
const user=ok(await server.auth.admin.createUser({email:requested.email,password,email_confirm:true})).user
for(const c of [client(),employee.client,server])for(const [name,args] of [
 ['accept_access_request',{p_id:requested.id,p_token_hash:requested.hash,p_user_id:user.id,p_department:home}],
 ['reject_access_request',{p_id:requested.id,p_token_hash:requested.hash}],
])assert.equal((await c.rpc(name,args)).error?.code,'42501',name+' requires an active Admin session')
for(const c of [client(),employee.client,admin.client])assert.equal((await c.rpc('get_access_request',{p_id:requested.id,p_token_hash:requested.hash})).error?.code,'42501')
assert.equal((await rpc(server,'get_access_request',{p_id:requested.id,p_token_hash:tokenHash()})).length,0)
assert.equal((await admin.client.rpc('accept_access_request',{p_id:requested.id,p_token_hash:requested.hash,p_user_id:employee.id,p_department:home})).error?.code,'40001')
assert.equal((await rpc(server,'get_access_request',{p_id:requested.id,p_token_hash:requested.hash}))[0].status,'pending')
await rpc(admin.client,'accept_access_request',{p_id:requested.id,p_token_hash:requested.hash,p_user_id:user.id,p_department:home})
assert.equal(ok(await server.from('profiles').select('position').eq('id',user.id).single()).position,'Applicant supplied fixture title')
assert.equal(ok(await server.from('employee_positions').select('title').eq('profile_id',user.id)).length,1)
assert.deepEqual(ok(await server.from('user_roles').select('role').eq('user_id',user.id)).map(r=>r.role),['admin'])
assert((await admin.client.rpc('accept_access_request',{p_id:requested.id,p_token_hash:requested.hash,p_user_id:user.id,p_department:home})).error)
const rejected=await request('rejected')
await rpc(admin.client,'reject_access_request',{p_id:rejected.id,p_token_hash:rejected.hash})
assert.equal((await rpc(server,'get_access_request',{p_id:rejected.id,p_token_hash:rejected.hash}))[0].status,'rejected')
const expired=await request('expired')
ok(await server.from('access_requests').update({review_expires_at:'2000-01-01T00:00:00Z'}).eq('id',expired.id))
assert((await admin.client.rpc('reject_access_request',{p_id:expired.id,p_token_hash:expired.hash})).error)
const pendingJob=await rpc(admin.client,'begin_department_file_deletion',{p_id:department,p_expected_updated_at:deptUpdated})
const pendingRequest=await request('pending-department')
const pendingUser=ok(await server.auth.admin.createUser({email:pendingRequest.email,password,email_confirm:true})).user
assert.equal((await admin.client.rpc('accept_access_request',{p_id:pendingRequest.id,p_token_hash:pendingRequest.hash,p_user_id:pendingUser.id,p_department:department})).error?.code,'23514')
assert.equal(ok(await server.from('profiles').select('id').eq('id',pendingUser.id)).length,0)
assert.equal((await rpc(server,'get_access_request',{p_id:pendingRequest.id,p_token_hash:pendingRequest.hash}))[0].status,'pending')
ok(await admin.client.functions.invoke('delete-department',{body:{jobId:pendingJob}}))
console.log('PASS access-request workflow with Admin decisions: legacy service-only decisions denied, token matching, no existing-employee repurposing, acceptance/profile/positions, rejection, expiry, duplicate decision and pending-department rollback')
console.log(`PASS security suite: ${negativeChecks} matrix denials plus positive, escalation and observed access-request compatibility checks; original migration source remains missing`)
