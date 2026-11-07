import { describe, expect, it } from 'vitest'
import migrationSource from '../../../supabase/migrations/20261107150000_add_user.sql?raw'
import rollback from '../../../supabase/scripts/rollback_add_user.sql?raw'
import functionSource from '../../../supabase/functions/add-user/index.ts?raw'
import flowSource from '../../../supabase/functions/add-user/flow.ts?raw'

// Reads the code as text: nothing here executes it or proves how the deployed function behaves.
const plain = (text: string) => text.replace(/\r/g, '')
const sql = (text: string) => plain(text).replace(/--[^\n]*/g, '')
const migration = sql(migrationSource)
const CHECK = 'public.check_new_user(text, text, text, text, text, text[])'
const ADD = 'public.add_user(uuid, text, text, text, text, text, text[])'

describe('the add_user migration', () => {
  it('is additive: it only creates two functions, with no DELETE at all', () => {
    expect(migration).not.toMatch(/\b(drop|truncate|delete|alter\s+table|alter\s+column|create\s+or\s+replace|create\s+trigger)\b/i)
    expect(migration.match(/create function/g)).toHaveLength(2)
  })

  it('checks for an admin, takes the lock, and checks again under it', () => {
    const body = migration.slice(migration.indexOf('create function public.add_user'))
    const start = body.slice(body.indexOf('begin\n  if')).replace(/\n\s*\n/g, '\n')
    expect(start.startsWith("begin\n  if not public.can_manage_organization() then\n    raise exception 'Administrator required' using errcode = '42501';\n  end if;\n  perform pg_catalog.pg_advisory_xact_lock(72441, 1);\n  perform public.check_new_user(")).toBe(true)
    const check = migration.slice(migration.indexOf('create function public.check_new_user'), migration.indexOf('create function public.add_user'))
    expect(check.slice(check.indexOf('begin\n  if'))).toMatch(/^begin\n  if not public\.can_manage_organization\(\) then/)
  })

  it('only attaches a profile to the account of that email', () => {
    expect(migration).toContain('u.id = p_user_id and u.deleted_at is null and lower(u.email) = p_email')
  })

  it('saves through save_user, so the rules are the same as Edit User', () => {
    expect(migration).toContain('saved := public.save_user(p_user_id,')
  })

  it('never touches another person: only this user in profiles', () => {
    const changes = [...migration.matchAll(/\b(insert into|update) (public|auth)\.(\w+)/g)].map((match) => `${match[1]} ${match[2]}.${match[3]}`)
    expect(changes.sort()).toEqual(['insert into public.organization_management_audit', 'insert into public.profiles', 'update public.profiles'])
  })

  it('runs as its owner with an empty search path, for signed-in users only', () => {
    expect(migration.match(/security definer\s+set search_path = ''/g)).toHaveLength(2)
    for (const signature of [CHECK, ADD]) {
      expect(migration).toContain(`revoke all on function ${signature} from public, anon, authenticated, service_role;`)
      expect(migration).toContain(`grant execute on function ${signature} to authenticated;`)
    }
  })
})

describe('its rollback', () => {
  it('only drops the two functions', () => {
    const statements = sql(rollback).split(';').map((statement) => statement.trim()).filter(Boolean)
    expect(statements).toEqual(['begin', `drop function if exists ${ADD}`, `drop function if exists ${CHECK}`, "notify pgrst, 'reload schema'", 'commit'])
  })
})

describe('the add-user Edge Function', () => {
  const source = plain(functionSource)
  const flow = plain(flowSource)

  it('checks the caller in the database, as the caller', () => {
    expect(source).toContain('caller.auth.getUser(authorization.slice(7))')
    expect(source).toContain('caller.rpc("can_manage_organization")')
    expect(source).toMatch(/const \{ data, error \} = await caller\.rpc\(name, args\)/)
  })

  it('reads the secret key from the environment only, and only sends it to Auth', () => {
    expect(source).toContain('env("HAWKIM_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY")')
    expect(source).not.toMatch(/sb_secret_|eyJ[A-Za-z0-9_-]{20,}/)
    // Declared, required, and in the two Auth headers.
    expect([...source.matchAll(/serverKey/g)].length).toBe(4)
    expect(source).toContain('headers: { apikey: serverKey, Authorization: `Bearer ${serverKey}`')
  })

  it('never logs a key, the link or the request', () => {
    const logging = [...`${source}\n${flow}`.matchAll(/(?:console\.\w+|steps\.log)\(([^\n]*)\)/g)].map((match) => match[1])
    expect(logging.length).toBeGreaterThan(0)
    for (const line of logging) expect(line).not.toMatch(/serverKey|SNDR_API_KEY|action_link|account\.link|\.link\b|input\b|user\.email|authorization/i)
  })

  it('never returns the link', () => {
    expect(flow).toContain('return { status: 200, body: { user: saved, emailSent } }')
    expect(source).not.toMatch(/json\([^)]*link/)
  })

  it('keeps JWT verification on: it is not deployed with --no-verify-jwt', () => {
    expect(source).toContain('supabase functions deploy add-user --use-api')
    expect(source).not.toContain('--no-verify-jwt')
  })
})
