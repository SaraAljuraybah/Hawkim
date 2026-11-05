// REAL local Auth/PostgREST/Storage/Edge tests. Hard refuses hosted URLs.
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { cleanDepartmentFiles, storageObjectExists } from '../functions/delete-department/cleanup.ts'
const require=createRequire(new URL('../../frontend/package.json',import.meta.url))
const {createClient}=require('@supabase/supabase-js')
const {PDFDocument,StandardFonts}=require('pdf-lib')
const root=new URL('../../',import.meta.url)
const configuration=JSON.parse(readFileSync(new URL('.local-tests/status.local.json',root),'utf8').trim())
const url=configuration.API_URL ?? configuration.api_url
assert.equal(url,'http://127.0.0.1:55431','This test only accepts the isolated local project')
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
async function department(name,initials) { return rpc(admin,'save_department',{p_id:null,p_name:name+' '+run,p_initials:initials[0]+String.fromCharCode(65+parseInt(run[0],16))+String.fromCharCode(65+parseInt(run[1],16)),p_description:'Coordinates '+name.toLowerCase()+' activities.',p_division_id:division}) }
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
// Keep a second empty division for the collapsed/expanded browser screenshots.
await rpc(admin,'save_division',{p_id:null,p_name:'Clinical Research '+run,p_description:'Research activities.',p_email:'research@test.invalid'})
const adminSession=ok(await admin.auth.getSession()).session,authorSession=ok(await author.auth.getSession()).session
mkdirSync(new URL('.local-tests/',root),{recursive:true})
writeFileSync(new URL('.local-tests/browser-fixture.local.json',root),JSON.stringify({url,key,adminSession,authorSession,division,employeeDepartment,primarySopId:primarySop.id,authorId:authorUser.id}))
mkdirSync(new URL('docs/verification/',root),{recursive:true})
writeFileSync(new URL('docs/verification/local-supabase-results.json',root),JSON.stringify({environment:'isolated local Supabase',url,checkedAt:new Date().toISOString(),auth:true,postgrest:true,storageDeletion:true,edgeFunction:true,physicalAbsence:true,recovery:true,hostedTested:false},null,2)+'\n')
console.log('PASS local CRUD and existing Organizational Structure checks; genuine local browser sessions saved privately')
