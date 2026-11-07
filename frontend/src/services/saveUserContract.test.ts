import { describe, expect, it } from 'vitest'
import migrationSource from '../../../supabase/migrations/20261107140000_save_user.sql?raw'
import rollback from '../../../supabase/scripts/rollback_save_user.sql?raw'

// Reads the SQL as text: nothing here executes it or proves how the deployed database behaves.
const plain = (sql: string) => sql.replace(/\r/g, '')
const code = (sql: string) => plain(sql).replace(/--[^\n]*/g, '')
const migration = code(migrationSource)
const SIGNATURE = 'public.save_user(uuid, text, text, text, text, text[], text, text[])'

describe('the save_user migration', () => {
  it('is additive: it only creates one function', () => {
    expect(migration).not.toMatch(/\b(drop|truncate|alter\s+table|alter\s+column|create\s+or\s+replace|create\s+trigger)\b/i)
    expect(migration.match(/create function/g)).toHaveLength(1)
  })

  it('has exactly one DELETE: the permissions an admin unticked', () => {
    const deletes = [...migration.matchAll(/\bdelete\b[^;]*;/gi)].map((match) => match[0])
    expect(deletes).toEqual(['delete from public.user_roles ur where ur.user_id = person.id and ur.role::text = any (removed_roles);'])
  })

  it('checks for an admin first, takes the lock, and checks again under it', () => {
    // Without the blank lines the comments leave.
    const body = migration.slice(migration.indexOf('begin\n  if')).replace(/\n\s*\n/g, '\n')
    const check = "if not public.can_manage_organization() then\n    raise exception 'Administrator required' using errcode = '42501';\n  end if;"
    expect(body.startsWith(`begin\n  ${check}\n  perform pg_catalog.pg_advisory_xact_lock(72441, 1);\n  ${check}`)).toBe(true)
    expect(body.match(/can_manage_organization/g)).toHaveLength(2)
  })

  it('runs as its owner with an empty search path, for signed-in users only', () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/)
    expect(migration).toContain(`revoke all on function ${SIGNATURE} from public, anon, authenticated, service_role;`)
    expect(migration).toContain(`grant execute on function ${SIGNATURE} to authenticated;`)
  })

  it('removes roles, then moves the department, then adds roles: the only order the triggers accept', () => {
    const order = ['update_user_details(person.id', 'delete from public.user_roles', 'update public.profiles p set department_id', 'insert into public.user_roles', 'insert into public.organization_management_audit']
    const places = order.map((text) => migration.indexOf(text))
    expect(places.every((place) => place >= 0)).toBe(true)
    expect([...places].sort((a, b) => a - b)).toEqual(places)
  })

  it('does every check before changing anything', () => {
    const firstChange = migration.indexOf('update_user_details(person.id')
    for (const hint of ['invalid', 'self-admin', 'last-admin', 'admin-exclusive', 'department-unavailable', 'approver-quality', 'permission-in-use']) {
      const place = migration.indexOf(`hint = '${hint}'`)
      expect(place, hint).toBeGreaterThan(0)
      expect(place, hint).toBeLessThan(firstChange)
    }
    expect(migration.indexOf("errcode = '40001'")).toBeLessThan(firstChange)
  })

  it('never changes the email or a deleted user', () => {
    expect(migration).not.toMatch(/\bemail\s*=/)
    expect(migration).toContain('where p.id = p_user_id and p.deleted_at is null for update')
  })

  it('counts reviewers as the browser does (sopsUsing, legacyDecision)', () => {
    expect(migration).toContain("s.status in ('in-review', 'in-approval', 'returned', 'approved')")
    expect(migration).toContain("in ('pending', 'accepted', 'completed', 'returned')")
  })

  it('keeps the titles a department change removes in the audit row', () => {
    expect(migration).toContain("'positionsInOldDepartment', to_jsonb(removed_positions)")
  })
})

describe('its rollback', () => {
  it('only drops the function', () => {
    const statements = code(rollback).split(';').map((statement) => statement.trim()).filter(Boolean)
    expect(statements).toEqual(['begin', `drop function if exists ${SIGNATURE}`, "notify pgrst, 'reload schema'", 'commit'])
  })
})
