// REAL local Auth/PostgREST/Storage/Edge tests. Hard refuses hosted URLs.
import { readFileSync } from 'node:fs'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { cleanDepartmentFiles, storageObjectExists } from '../functions/delete-department/cleanup.ts'
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const {createClient}=require('@supabase/supabase-js')
const {PDFDocument,StandardFonts}=require('pdf-lib')
const root=new URL('../../',import.meta.url)
const container='supabase_db_hawkim-deletion-20261105'
const inspect=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0]
assert(inspect.Mounts.some(m=>m.Name==='supabase_db_hawkim-deletion-20261105'))
const storage=JSON.parse(execFileSync('docker',['inspect','supabase_storage_hawkim-deletion-20261105'],{encoding:'utf8'}))[0]
assert(storage.Mounts.some(m=>m.Name==='supabase_storage_hawkim-deletion-20261105'))
assert.equal(inspect.HostConfig.PortBindings['5432/tcp'][0].HostPort,'56432')
assert(inspect.Mounts.filter(m=>m.Type==='volume').every(m=>m.Name.endsWith('_hawkim-deletion-20261105')))
assert(storage.Mounts.filter(m=>m.Type==='volume').every(m=>m.Name.endsWith('_hawkim-deletion-20261105')))
const configuration=JSON.parse(readFileSync(new URL('.local-tests/deletion-20261105/status.local.json',root),'utf8').trim())
const url=configuration.API_URL ?? configuration.api_url
assert.equal(url,'http://127.0.0.1:56431','This test only accepts the isolated local project')
assert.equal(configuration.DB_URL,'postgresql://postgres:postgres@127.0.0.1:56432/postgres')
console.log('PASS target guards: dedicated loopback API/database and separate Docker database/Storage volumes')
const key=configuration.ANON_KEY ?? configuration.anon_key
const secret=configuration.SERVICE_ROLE_KEY ?? configuration.service_role_key
assert(key&&secret,'Save local supabase status --output json before running')
const client=(credential=key)=>createClient(url,credential,{auth:{persistSession:false,autoRefreshToken:false}})
const server=client(secret),admin=client(),author=client()
const run=randomUUID().slice(0,8),password='Local-test-'+randomUUID()
const edge=async(body)=>{const result=await admin.functions.invoke('delete-department',{body});if(result.error){let detail;try{detail=await result.error.context?.json()}catch{};throw new Error('Local Edge failure: '+JSON.stringify(detail))}return result.data}
const ok=(result)=>{if(result.error) throw new Error('Local test API error: '+result.error.message);return result.data}
const rpc=async(c,name,args)=>ok(await c.rpc(name,args))
const home='verification-home-'+run
ok(await server.from('departments').insert({id:home,name:'Verification home '+run,initials:'VH'}))
async function person(label,roles) {
 const email=label+'-'+run+'@test.invalid'
 const data=ok(await server.auth.admin.createUser({email,password,email_confirm:true}))
 ok(await server.from('profiles').insert({id:data.user.id,full_name:label==='admin'?'Verification Admin':'Sara Verification',email,initials:label==='admin'?'VA':'SV',department_id:home,position:label==='admin'?'Systems Administrator':'Safety Officer'}))
 ok(await server.from('user_roles').insert(roles.map(role=>({user_id:data.user.id,role}))))
 return {id:data.user.id,email}
}
const adminUser=await person('admin',['admin']),authorUser=await person('author',['author','reviewer'])
ok(await admin.auth.signInWithPassword({email:adminUser.email,password}))
ok(await author.auth.signInWithPassword({email:authorUser.email,password}))
if (!(ok(await server.from('guideline_versions').select('id'))).length) ok(await server.from('guideline_versions').insert({name:'SFDA Guideline on Good Pharmacovigilance Practices (GVP)',version:'4.0',effective_date:'2026-01-01',file_name:'local-fixture.pdf'}))
const division=await rpc(admin,'save_division',{p_id:null,p_name:'Drug Safety '+run,p_description:'Oversees drug safety and pharmacovigilance activities across the organization.',p_email:'drugsafety@test.invalid'})
ok(await server.from('departments').update({division_id:division}).eq('id',home))
const emptyDivision=await rpc(admin,'save_division',{p_id:null,p_name:'Research '+run,p_description:'Research and development.',p_email:'research@test.invalid'})
const usedInitials=new Set(ok(await server.from('departments').select('initials')).map(d=>d.initials))
let initialsSequence=0
async function department(name) {
 let initials
 do {const n=initialsSequence++;assert(n<26**3);initials=[Math.floor(n/676),Math.floor(n/26)%26,n%26].map(i=>String.fromCharCode(65+i)).join('')} while(usedInitials.has(initials))
 usedInitials.add(initials)
 return rpc(admin,'save_department',{p_id:null,p_name:name+' '+run,p_initials:initials,p_description:'Coordinates '+name.toLowerCase()+' activities.',p_division_id:division})
}
const employeeDepartment=await department('Pharmacovigilance','PV')
async function assign(id) {ok(await server.from('profiles').update({department_id:id}).eq('id',authorUser.id))}
await assign(employeeDepartment)
const pdf=await PDFDocument.create();const page=pdf.addPage();page.drawText('Disposable Hawkim SOP verification fixture',{x:45,y:750,size:14,font:await pdf.embedFont(StandardFonts.Helvetica)});const bytes=await pdf.save()
async function sop(departmentId,versions=1) {
 await assign(departmentId)
 const paths=[]
 for(let i=0;i<versions;i++) {const path=authorUser.id+'/'+randomUUID()+'.pdf';ok(await author.storage.from('sop-files').upload(path,bytes,{contentType:'application/pdf'}));paths.push(path)}
 const id=await rpc(author,'create_sop',{p_title:'Safety procedure',p_description:'Local SOP fixture',p_department_id:departmentId,p_storage_path:paths[0],p_file_name:'Procedure.pdf'})
 for(const path of paths.slice(1)) await rpc(author,'upload_sop_version',{p_sop_id:id,p_storage_path:path,p_file_name:'Procedure.pdf'})
 return {id,paths}
}
const primarySop=await sop(employeeDepartment)
const row=async(id)=>ok(await server.from('departments').select('*').eq('id',id).single())
const snapshot=await rpc(admin,'get_divisions_departments')
const employees=snapshot.departments.find(d=>d.id===employeeDepartment)
assert.equal(employees.employees,1);assert.equal(employees.people[0].permissions.length,2);assert.equal(employees.sops,1)
await rpc(admin,'set_employee_positions',{p_profile_id:authorUser.id,p_titles:['Safety Officer','QPPV Deputy']})
assert.deepEqual((await rpc(admin,'get_divisions_departments')).departments.find(d=>d.id===employeeDepartment).people[0].positions,['Safety Officer','QPPV Deputy'])
assert((await author.rpc('set_employee_positions',{p_profile_id:authorUser.id,p_titles:['Forged']})).error)
assert.equal((await admin.rpc('delete_department',{p_id:employeeDepartment,p_sop_action:'empty',p_expected_updated_at:(await row(employeeDepartment)).updated_at})).error.code,'23503')
assert((await author.rpc('save_division',{p_id:null,p_name:'Forbidden',p_description:'',p_email:'x@test.invalid'})).error)
assert((await author.functions.invoke('delete-department',{body:{departmentId:employeeDepartment,expectedUpdatedAt:(await row(employeeDepartment)).updated_at,confirmDeleteSops:true}})).error)
console.log('PASS actual local Auth/PostgREST: CRUD persistence, counts, multiple positions and non-admin rejection')
const move=await department('Moved SOPs','MS'),moved=await sop(move,2)
await assign(employeeDepartment)
await rpc(admin,'delete_department',{p_id:move,p_sop_action:'others',p_expected_updated_at:(await row(move)).updated_at})
assert.equal(ok(await server.from('sops').select('directory_group').eq('id',moved.id).single()).directory_group,'others')
for(const path of moved.paths) assert.equal(storageObjectExists(await server.storage.from('sop-files').info(path)),true)
assert(ok(await author.from('sops').select('id').eq('id',moved.id)).length)
console.log('PASS Others: actual SOP records, all files/versions and author access preserved')
const purge=await department('Deleted SOPs','DS'),removed=await sop(purge,2)
await assign(employeeDepartment)
const destructiveBody={departmentId:purge,expectedUpdatedAt:(await row(purge)).updated_at,confirmDeleteSops:true}
const result=await edge(destructiveBody)
assert.equal(result.state,'completed')
for(const path of removed.paths) assert.equal(storageObjectExists(await server.storage.from('sop-files').info(path)),false)
assert((await row(purge)).removed_at)
assert.equal(ok(await author.from('sops').select('id').eq('id',removed.id)).length,0)
const retry=await edge({jobId:result.jobId});assert.equal(retry.state,'completed')
console.log('PASS permanent deletion: deployed LOCAL Edge Function removed all actual Storage versions; verified absent; retry idempotent')
// Induce a real Storage authorization failure without deleting unrelated data or changing policies.
const failureDepartment=await department('Cleanup recovery','CR'),failedSop=await sop(failureDepartment)
await assign(employeeDepartment)
const jobId=await rpc(admin,'begin_department_file_deletion',{p_id:failureDepartment,p_expected_updated_at:(await row(failureDepartment)).updated_at})
const failed=await cleanDepartmentFiles(jobId,{
 claim:id=>rpc(server,'claim_department_file_deletion',{p_job_id:id}),
 remove:async(bucket,paths)=>{ok(await author.storage.from(bucket).remove(paths))},
 present:(id,paths)=>rpc(server,'department_file_paths_present',{p_job_id:id,p_paths:paths}),
 acknowledge:(id,token,paths,error)=>rpc(server,'ack_department_file_deletion',{p_job_id:id,p_lease_token:token,p_deleted_paths:paths,p_failed:error}),
})
assert.equal(failed,'failed');assert.equal((await row(failureDepartment)).removed_at,null)
assert.equal(storageObjectExists(await server.storage.from('sop-files').info(failedSop.paths[0])),true)
assert.equal((await rpc(admin,'get_department_file_deletion',{p_job_id:jobId})).state,'failed')
assert.equal((await edge({jobId})).state,'completed')
assert.equal(storageObjectExists(await server.storage.from('sop-files').info(failedSop.paths[0])),false)
console.log('PASS actual Storage authorization failure: no premature completion, persisted recovery job, secure retry removes remaining file')
const noSops=await department('Empty department','ED')
await rpc(admin,'delete_department',{p_id:noSops,p_sop_action:'empty',p_expected_updated_at:(await row(noSops)).updated_at})
assert((await row(noSops)).removed_at)
const structure=await rpc(admin,'get_organizational_structure');assert(structure.divisions.some(d=>d.id===division))
const next=await rpc(admin,'get_divisions_departments');assert.equal(next.departments.find(d=>d.id===employeeDepartment).sops,1)
const empty=next.divisions.find(d=>d.id===emptyDivision)
await rpc(admin,'save_division',{p_id:empty.id,p_name:empty.name,p_description:empty.description,p_email:empty.email,p_expected_updated_at:empty.updated_at})
const current=(await rpc(admin,'get_divisions_departments')).divisions.find(d=>d.id===emptyDivision)
await rpc(admin,'delete_division',{p_id:current.id,p_expected_updated_at:current.updated_at})
// The regular management snapshot still accepts an empty division.
await rpc(admin,'save_division',{p_id:null,p_name:'Clinical Research '+run,p_description:'Research activities.',p_email:'research@test.invalid'})

// Fixed container and credentials above are deliberately independent of .env.local.
const sqlArgs=['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At']
const sql=input=>execFileSync('docker',sqlArgs,{input,encoding:'utf8',timeout:60000})
const reject=async(c,name,args,code)=>assert.equal((await c.rpc(name,args)).error?.code,code,name)
const token=async id=>(await row(id)).updated_at
const del=async(id,action='empty')=>({p_id:id,p_sop_action:action,p_expected_updated_at:await token(id)})
const visible=async id=>ok(await author.from('sops').select('id').eq('id',id))
const exists=async path=>storageObjectExists(await server.storage.from('sop-files').info(path))
const job=async id=>rpc(admin,'begin_department_file_deletion',{p_id:id,p_expected_updated_at:await token(id)})
const worker={
 claim:id=>rpc(server,'claim_department_file_deletion',{p_job_id:id}),
 remove:async(bucket,paths)=>ok(await server.storage.from(bucket).remove(paths)),
 present:(id,paths)=>rpc(server,'department_file_paths_present',{p_job_id:id,p_paths:paths}),
 acknowledge:(id,lease,paths,failed)=>rpc(server,'ack_department_file_deletion',{p_job_id:id,p_lease_token:lease,p_deleted_paths:paths,p_failed:failed}),
}
await reject(admin,'delete_department',await del(employeeDepartment),'23503')
await reject(admin,'begin_department_file_deletion',{p_id:employeeDepartment,p_expected_updated_at:await token(employeeDepartment)},'23503')
const restricted=await department('Restrictions','RX'),restrictedSop=await sop(restricted)
await assign(employeeDepartment)
await reject(admin,'delete_department',await del(restricted),'23503')
await reject(admin,'delete_department',await del(restricted,'delete'),'23514')
await reject(admin,'delete_department',{...await del(restricted,'others'),p_expected_updated_at:'2000-01-01T00:00:00Z'},'40001')
for(const state of ['in-review','in-approval']) {
 ok(await server.from('sops').update({status:state}).eq('id',restrictedSop.id))
 await reject(admin,'delete_department',await del(restricted,'others'),'23514')
 await reject(admin,'begin_department_file_deletion',{p_id:restricted,p_expected_updated_at:await token(restricted)},'23514')
 assert.equal((await row(restricted)).deletion_job_id,null)
 assert.equal(await exists(restrictedSop.paths[0]),true)
}
ok(await server.from('sops').update({status:'draft'}).eq('id',restrictedSop.id))
const openRound=ok(await server.from('review_rounds').insert({sop_id:restrictedSop.id,version:1,requested_by:authorUser.id}).select('id').single())
await reject(admin,'begin_department_file_deletion',{p_id:restricted,p_expected_updated_at:await token(restricted)},'23514')
await reject(admin,'delete_department',await del(restricted,'others'),'23514')
ok(await server.from('review_rounds').update({status:'completed',closed_at:new Date().toISOString()}).eq('id',openRound.id))
const guideline=ok(await server.from('guideline_versions').select('id').limit(1))[0].id
const running=ok(await server.from('compliance_checks').insert({sop_id:restrictedSop.id,sop_version:1,guideline_version_id:guideline,triggered_by:authorUser.id}).select('id').single())
await reject(admin,'begin_department_file_deletion',{p_id:restricted,p_expected_updated_at:await token(restricted)},'23514')
await reject(admin,'delete_department',await del(restricted,'others'),'23514')
ok(await server.from('compliance_checks').update({status:'failed',completed_at:new Date().toISOString()}).eq('id',running.id))
const noConfirm=await admin.functions.invoke('delete-department',{body:{departmentId:restricted,expectedUpdatedAt:await token(restricted)}})
assert.equal(noConfirm.error?.context?.status,400)
console.log('PASS restrictions: employees, nonempty choice, RPC delete bypass, stale token, active review/approval, explicit confirmation')

const divToken=ok(await server.from('divisions').select('updated_at').eq('id',division).single()).updated_at
await reject(admin,'delete_division',{p_id:division,p_expected_updated_at:divToken},'23503')
assert.equal(ok(await server.from('divisions').select('is_active').eq('id',emptyDivision).single()).is_active,false)
await reject(admin,'delete_division',{p_id:emptyDivision,p_expected_updated_at:current.updated_at},'40001')
console.log('PASS division deletion: assigned departments block removal, empty division inactive and absent from snapshot, repeat conflicts')

for(const [name,args] of [
 ['delete_department',await del(restricted,'others')],
 ['begin_department_file_deletion',{p_id:restricted,p_expected_updated_at:await token(restricted)}],
 ['get_department_file_deletion',{p_job_id:result.jobId}],
 ['delete_division',{p_id:division,p_expected_updated_at:divToken}],
 ['delete_user_profile',{p_user_id:adminUser.id}],
 ['claim_department_file_deletion',{p_job_id:result.jobId}],
 ['ack_department_file_deletion',{p_job_id:result.jobId,p_lease_token:randomUUID(),p_deleted_paths:[],p_failed:false}],
 ['department_file_paths_present',{p_job_id:result.jobId,p_paths:[]}],
]) {
 await reject(author,name,args,'42501')
 assert((await client().rpc(name,args)).error,`Anonymous ${name}`)
}
assert.equal((await author.functions.invoke('manage-users',{body:{action:'delete',userId:adminUser.id}})).error?.context?.status,403)
console.log('PASS authorization: non-admin and anonymous deletion/worker RPCs refused; non-admin manage-users refused')

// Fail after document scrubbing, then prove every relational change rolls back.
const rollback=await department('Atomic rollback','AR'),rollbackSop=await sop(rollback)
await assign(employeeDepartment)
sql(`create function public.deletion_test_fail() returns trigger language plpgsql as $$ begin
 if new.entity_id='${rollback}' then raise exception 'injected audit failure'; end if; return new; end $$;
 create trigger deletion_test_fail before insert on public.organization_management_audit for each row execute function public.deletion_test_fail();`)
try {
 for(const action of ['others','purge']) {
  if(action==='others') await reject(admin,'delete_department',await del(rollback,'others'),'P0001')
  else await reject(admin,'begin_department_file_deletion',{p_id:rollback,p_expected_updated_at:await token(rollback)},'P0001')
  const unchanged=await row(rollback)
  assert.equal(unchanged.removed_at,null);assert.equal(unchanged.deletion_job_id,null)
  const doc=ok(await server.from('sops').select('title,deleted_at,directory_group').eq('id',rollbackSop.id).single())
  assert.equal(doc.title,'Safety procedure');assert.equal(doc.deleted_at,null);assert.equal(doc.directory_group,'department')
  assert.equal((await visible(rollbackSop.id)).length,1);assert.equal(await exists(rollbackSop.paths[0]),true)
  assert.equal(sql(`select count(*) from public.department_file_deletions where department_id='${rollback}';`).trim(),'0')
 }
} finally {sql('drop trigger deletion_test_fail on public.organization_management_audit; drop function public.deletion_test_fail();')}
console.log('PASS rollback: audit failure rolls back Others movement and purge preparation, including manifest, SOP prose and visibility')

const partial=await department('Partial cleanup','PC'),partialSop=await sop(partial,2)
await assign(employeeDepartment)
const partialJob=await job(partial)
const partialState=await cleanDepartmentFiles(partialJob,{...worker,remove:async(bucket,paths)=>{
 ok(await server.storage.from(bucket).remove(paths.slice(0,1)));throw new Error('injected partial response failure')
}})
assert.equal(partialState,'failed')
assert.equal((await rpc(admin,'get_department_file_deletion',{p_job_id:partialJob})).deletedFiles,1)
assert.equal((await row(partial)).removed_at,null)
assert.equal((await edge({jobId:partialJob})).state,'completed')
for(const path of partialSop.paths) assert.equal(await exists(path),false)
console.log('PASS partial Storage deletion: only verified absent paths acknowledged, retry removes remainder')

const historical=await department('Historical versions','HV'),historicalSop=await sop(historical,2)
await assign(employeeDepartment)
ok(await server.from('sop_versions').update({deleted_at:new Date().toISOString(),deleted_by:authorUser.id}).eq('sop_id',historicalSop.id).eq('version',1))
const historicalJob=await job(historical)
assert.equal((await rpc(admin,'get_department_file_deletion',{p_job_id:historicalJob})).totalFiles,2)
assert.equal((await edge({jobId:historicalJob})).state,'completed')
for(const path of historicalSop.paths) {
 assert.equal(await exists(path),false)
 assert((await server.storage.from('sop-files').download(path)).error,'Deleted bytes remain downloadable')
}
const batched=await department('Multiple batches','MB'),batchedSop=await sop(batched,101)
await assign(employeeDepartment)
const batchedJob=await job(batched)
assert.equal(await cleanDepartmentFiles(batchedJob,worker),'pending')
assert.equal((await rpc(admin,'get_department_file_deletion',{p_job_id:batchedJob})).deletedFiles,100)
assert.equal((await row(batched)).removed_at,null)
assert.equal((await edge({jobId:batchedJob})).state,'completed')
for(const path of batchedSop.paths) assert.equal(await exists(path),false)
console.log('PASS complete manifests: historical soft-deleted version removed, bytes unavailable, 101-file job completes across 100-file batches')

const finalizing=await department('Finalization rollback','FR'),finalSop=await sop(finalizing)
await assign(employeeDepartment)
const finalJob=await job(finalizing)
sql(`create function public.deletion_test_finalize() returns trigger language plpgsql as $$ begin
 if new.entity_id='${finalizing}' and new.action='department-file-deletion-completed' then raise exception 'injected finalization failure'; end if; return new; end $$;
 create trigger deletion_test_finalize before insert on public.organization_management_audit for each row execute function public.deletion_test_finalize();`)
try {
 await assert.rejects(cleanDepartmentFiles(finalJob,worker),/injected finalization failure/)
 assert.equal(await exists(finalSop.paths[0]),false)
 assert.equal((await row(finalizing)).removed_at,null)
 assert.equal((await rpc(admin,'get_department_file_deletion',{p_job_id:finalJob})).deletedFiles,0)
} finally {sql('drop trigger deletion_test_finalize on public.organization_management_audit; drop function public.deletion_test_finalize();')}
sql(`update public.department_file_deletions set lease_until=clock_timestamp()-interval '1 second' where id='${finalJob}';`)
assert.equal((await edge({jobId:finalJob})).state,'completed')
console.log('PASS finalization rollback: removed bytes remain absent, failed database finalization stays incomplete and safely retries')

const crash=await department('Lost acknowledgement','LA'),crashSop=await sop(crash)
await assign(employeeDepartment)
const crashJob=await job(crash)
await assert.rejects(cleanDepartmentFiles(crashJob,{...worker,acknowledge:async()=>{throw new Error('lost acknowledgement')}}),/lost acknowledgement/)
assert.equal(await exists(crashSop.paths[0]),false)
assert.equal((await rpc(server,'claim_department_file_deletion',{p_job_id:crashJob})).state,'busy')
sql(`update public.department_file_deletions set lease_until=clock_timestamp()-interval '1 second' where id='${crashJob}';`)
assert.equal((await edge({jobId:crashJob})).state,'completed')
console.log('PASS worker interruption: active lease prevents competing worker, expired lease recovers after lost acknowledgement')

const pending=await department('Pending guards','PG'),pendingSop=await sop(pending)
await assign(employeeDepartment)
const pendingJob=await job(pending)
await reject(admin,'delete_department',await del(pending,'others'),'23514')
assert((await server.from('profiles').update({department_id:pending}).eq('id',authorUser.id)).error)
const claimed=await rpc(server,'claim_department_file_deletion',{p_job_id:pendingJob})
await reject(server,'ack_department_file_deletion',{p_job_id:pendingJob,p_lease_token:claimed.leaseToken,p_deleted_paths:pendingSop.paths,p_failed:false},'23514')
assert.equal((await row(pending)).removed_at,null)
await rpc(server,'ack_department_file_deletion',{p_job_id:pendingJob,p_lease_token:claimed.leaseToken,p_deleted_paths:[],p_failed:true})
assert.equal((await edge({jobId:pendingJob})).state,'completed')
assert((await author.storage.from('sop-files').upload(pendingSop.paths[0],bytes,{contentType:'application/pdf'})).error)
console.log('PASS pending guards: assignment/move blocked, false Storage acknowledgement rejected, deleted path cannot be reused')

const concurrent=input=>new Promise((resolve,reject)=>{
 const child=spawn('docker',sqlArgs,{stdio:['pipe','pipe','pipe']});let stderr=''
 child.stderr.on('data',data=>stderr+=data);child.on('error',reject);child.on('close',code=>resolve({code,stderr}));child.stdin.end(input)
})
const asAdmin=`select set_config('request.jwt.claim.sub','${adminUser.id}',false);set role authenticated;`
// Hold a row lock in one session; poll pg_stat_activity to prove overlap before launching the contender.
async function overlap(label,first,second) {
 const firstRun=concurrent(`set application_name='${label}';begin;${first};select pg_sleep(2);commit;`)
 let sleeping=false
 for(let n=0;n<80;n++) {
  if(sql(`select exists(select 1 from pg_stat_activity where application_name='${label}' and wait_event='PgSleep');`).trim()==='t'){sleeping=true;break}
  await new Promise(resolve=>setTimeout(resolve,25))
 }
 assert(sleeping,'First transaction never held its lock')
 const secondRun=concurrent(second)
 const outcomes=await Promise.all([firstRun,secondRun])
 assert.equal(outcomes.filter(r=>r.code===0).length,1,JSON.stringify(outcomes))
}
const race=await department('Assignment race','RA')
await overlap('delete_wins',`${asAdmin}select public.delete_department('${race}','empty',(select updated_at from public.departments where id='${race}'))`,
 `update public.profiles set department_id='${race}' where id='${authorUser.id}';`)
const reverse=await department('Reverse assignment race','RR')
await overlap('assign_wins',`update public.profiles set department_id='${reverse}' where id='${authorUser.id}'`,
 `${asAdmin}select public.delete_department('${reverse}','empty',(select updated_at from public.departments where id='${reverse}'));`)
await assign(employeeDepartment)
const divisionRace=await rpc(admin,'save_division',{p_id:null,p_name:'Division race '+run,p_description:'',p_email:null})
await overlap('division_delete_wins',`${asAdmin}select public.delete_division('${divisionRace}',(select updated_at from public.divisions where id='${divisionRace}'))`,
 `${asAdmin}select public.save_department(null,'Racing department ${run}','ZZZ','','${divisionRace}');`)
const duplicate=await department('Duplicate purge','DP'),duplicateSop=await sop(duplicate)
await assign(employeeDepartment)
const jobs=await Promise.all([job(duplicate),job(duplicate)])
assert.equal(jobs[0],jobs[1])
const claims=await Promise.all(jobs.map(id=>rpc(server,'claim_department_file_deletion',{p_job_id:id})))
assert.equal(claims.filter(c=>c.state==='processing').length,1);assert.equal(claims.filter(c=>c.state==='busy').length,1)
const lease=claims.find(c=>c.state==='processing').leaseToken
await rpc(server,'ack_department_file_deletion',{p_job_id:jobs[0],p_lease_token:lease,p_deleted_paths:[],p_failed:true})
assert.equal((await edge({jobId:jobs[0]})).state,'completed');assert.equal(await exists(duplicateSop.paths[0]),false)
console.log('PASS concurrency: both assignment/removal orderings preserve invariants; duplicate purge creates one job; simultaneous claims issue one lease')

const disposableUser=await person('retired',['reviewer']),retired=client()
ok(await retired.auth.signInWithPassword({email:disposableUser.email,password}))
await reject(admin,'delete_user_profile',{p_user_id:adminUser.id},'23514')
await reject(admin,'delete_user_profile',{p_user_id:authorUser.id},'23514')
assert.equal(ok(await server.from('profiles').select('deleted_at').eq('id',authorUser.id).single()).deleted_at,null)
const ended=ok(await admin.functions.invoke('manage-users',{body:{action:'delete',userId:disposableUser.id}}))
assert.equal(ended.userId,disposableUser.id)
assert(ok(await server.from('profiles').select('deleted_at').eq('id',disposableUser.id).single()).deleted_at)
assert(ok(await server.auth.admin.getUserById(disposableUser.id)).user.banned_until)
assert((await client().auth.signInWithPassword({email:disposableUser.email,password})).error)
assert.equal((await retired.from('sops').select('id')).data?.length,0)
ok(await admin.functions.invoke('manage-users',{body:{action:'delete',userId:disposableUser.id}}))
console.log('PASS user soft deletion: self/work-in-progress blocked, profile retained and ended, Auth ban, existing token access denied, retry idempotent')

const endedAdmin=await person('ended-admin',['admin']),endedClient=client()
ok(await endedClient.auth.signInWithPassword({email:endedAdmin.email,password}))
ok(await server.from('profiles').update({deleted_at:new Date().toISOString()}).eq('id',endedAdmin.id))
await reject(endedClient,'delete_division',{p_id:division,p_expected_updated_at:divToken},'42501')
assert.equal((await endedClient.functions.invoke('delete-department',{body:{jobId:result.jobId}})).error?.context?.status,403)
const bannedAdmin=await person('banned-admin',['admin']),bannedClient=client()
ok(await bannedClient.auth.signInWithPassword({email:bannedAdmin.email,password}))
ok(await server.auth.admin.updateUserById(bannedAdmin.id,{ban_duration:'24h'}))
await reject(bannedClient,'delete_division',{p_id:division,p_expected_updated_at:divToken},'42501')
assert((await bannedClient.functions.invoke('delete-department',{body:{jobId:result.jobId}})).error)
console.log('PASS ended/banned administrators: issued tokens cannot authorize deletion through SQL or Edge')
console.log('PASS all real local deletion integration groups; no hosted target or existing local stack used')

