import { describe, expect, it } from 'vitest'
import migrationSource from '../../../supabase/migrations/20261107130000_update_user_details.sql?raw'
import rollback from '../../../supabase/scripts/rollback_update_user_details.sql?raw'

// Reads the SQL as text: nothing here executes it or proves how the deployed database behaves.
const plain = (sql: string) => sql.replace(/\r/g, '')
const code = (sql: string) => plain(sql).replace(/--[^\n]*/g, '')
const migration = code(migrationSource)

describe('the update_user_details migration', () => {
  it('is additive: it only creates one function', () => {
    expect(migration).not.toMatch(/\b(drop|truncate|alter\s+table|alter\s+column|create\s+or\s+replace)\b/i)
    expect(migration).not.toMatch(/\bdelete\s+from\b/i)
    expect(migration.match(/create function/g)).toHaveLength(1)
  })

  it('checks for an admin in the database before anything else', () => {
    const body = migration.slice(migration.indexOf('begin\n  if'))
    expect(body.trimStart().startsWith('begin\n  if not public.can_manage_organization() then')).toBe(true)
    expect(body).toContain("using errcode = '42501'")
  })

  it('runs as its owner with an empty search path, for signed-in users only', () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/)
    expect(migration).toContain('revoke all on function public.update_user_details(uuid, text, text, text) from public, anon, authenticated, service_role;')
    expect(migration).toContain('grant execute on function public.update_user_details(uuid, text, text, text) to authenticated;')
  })

  it('changes only name, initials, phone and position in profiles', () => {
    const updates = [...migration.matchAll(/update public\.profiles p\s+set ([^;]*?)\s+where/g)].map((match) => match[1])
    expect(updates).toEqual(['full_name = new_name, initials = new_initials, phone = p_phone', '"position" = new_position'])
    expect(migration).not.toMatch(/\b(email|department_id|deleted_at)\s*=\s*(new|p_)/)
    expect(migration).not.toContain('user_roles')
  })

  it('audits the changed field names, in the columns of organization_management_audit', () => {
    expect(migration).toContain("insert into public.organization_management_audit (actor_id, action, entity_id, details)")
    expect(migration).toContain("jsonb_build_object('fields', to_jsonb(changed))")
  })

  it('only names position in an update when it changed, so its trigger does not run otherwise', () => {
    expect(migration).toMatch(/if new_position is distinct from person\."position" then\s+update public\.profiles p set "position" = new_position/)
  })
})

describe('its rollback', () => {
  it('only drops the function', () => {
    const statements = code(rollback).split(';').map((statement) => statement.trim()).filter(Boolean)
    expect(statements).toEqual([
      'begin',
      'drop function if exists public.update_user_details(uuid, text, text, text)',
      "notify pgrst, 'reload schema'",
      'commit',
    ])
  })
})
