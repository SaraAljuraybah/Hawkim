// Test-only materialization of observed catalog definitions. NOT recovered migration history.
import { readFileSync } from 'node:fs'
const snapshot=JSON.parse(readFileSync(new URL('./fixtures/hosted-access-requests.snapshot.json',import.meta.url),'utf8'))
const identifier=value=>'"'+value.replaceAll('"','""')+'"'
const literal=value=>"'"+value.replaceAll("'","''")+"'"
export function hostedAccessFixture() {
 if(snapshot.policies.length || snapshot.triggers.length) throw new Error('Review newly observed policies/triggers before materializing the fixture')
 if(snapshot.table_acl!=='{postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres}') throw new Error('Unexpected observed table ACL')
 const columns=snapshot.columns.map(c=>`${identifier(c.name)} ${c.type}${c.default?' default '+c.default:''}${c.not_null?' not null':''}`)
 const constraints=snapshot.constraints.map(c=>`constraint ${identifier(c.name)} ${c.definition}`)
 const definitions=snapshot.functions.map(f=>{
  const acl=Array.isArray(f.acl)?f.acl:[]
  if(!acl.every(a=>a==='postgres=X/postgres'||a==='service_role=X/postgres'))throw new Error('Unexpected observed function ACL')
  return `${f.definition};\nalter function public.${f.signature} owner to postgres;
revoke all on function public.${f.signature} from public,anon,authenticated,service_role;
${acl.includes('service_role=X/postgres')?`grant execute on function public.${f.signature} to service_role;`:''}`
 })
 return `-- TEST FIXTURE ONLY: observed catalog; not the original access_requests migration.
create type public.access_request_status as enum (${snapshot.enum_labels.map(literal).join(',')});
create table public.access_requests (${[...columns,...constraints].join(',\n')});
${snapshot.indexes.join(';\n')};
alter table public.access_requests enable row level security;
revoke all on public.access_requests from public,anon,authenticated;
grant all on public.access_requests to service_role;
${definitions.join('\n')}`
}

/** Reproduce the observed visibility drift before applying the forward security migration. */
export const hostedOrganizationDrift=`
create or replace function public.can_read_organizational_structure() returns boolean
language sql stable security definer set search_path='' as $$
 select public.is_active_user() and exists(select 1 from auth.users u where u.id=auth.uid()
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()));
$$;
drop policy "Admins can read divisions" on public.divisions;
drop policy "Organizational structure admin guard" on public.divisions;
create policy "Active users can read divisions" on public.divisions for select to authenticated
 using ((select public.can_read_organizational_structure()));
create policy "Organizational structure active user guard" on public.divisions as restrictive for select to authenticated
 using ((select public.can_read_organizational_structure()));
`
