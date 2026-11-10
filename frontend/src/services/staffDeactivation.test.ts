import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { adminEn } from '../content/admin.en'
import migrationSource from '../../../supabase/migrations/20261112120000_staff_deactivation.sql?raw'
import staffManagementSource from '../../../supabase/migrations/20261110120000_staff_management.sql?raw'
import { addUserAccount, AddUserError, deactivateStaff, DeactivateStaffError, saveUser } from './people'

/*
 * Delete Staff (deactivation) and Add Staff reactivation, as the browser calls them. The rules themselves
 * are enforced and tested in the database (supabase/tests/staff_deactivation.sql) and end to end against
 * a local stack (supabase/tests/staff_deactivation.local.mjs).
 */

const rpc = vi.fn()
const invoke = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, functions: { invoke } }) }))
beforeEach(() => vi.clearAllMocks())

const refused = (code: string, hint?: string, details?: string) => ({ data: null, error: { code, hint, details, message: 'A DATABASE MESSAGE' } })

describe('Delete Staff calls the server', () => {
  it('deactivates through deactivate_staff and returns when the database did it', async () => {
    rpc.mockResolvedValue({ data: { id: 'u', deactivatedAt: '2026-11-11T09:00:00Z', alreadyDeactivated: false }, error: null })
    await expect(deactivateStaff('u')).resolves.toEqual({ deactivatedAt: '2026-11-11T09:00:00Z' })
    expect(rpc).toHaveBeenCalledWith('deactivate_staff', { p_user_id: 'u' })
  })

  it('treats a repeated request as done (the server changes nothing the second time)', async () => {
    rpc.mockResolvedValue({ data: { id: 'u', deactivatedAt: '2026-11-11T09:00:00Z', alreadyDeactivated: true }, error: null })
    await expect(deactivateStaff('u')).resolves.toEqual({ deactivatedAt: '2026-11-11T09:00:00Z' })
  })

  it.each([
    [refused('23514', 'self-delete'), 'self-delete', 0],
    [refused('23514', 'admin-managed-separately'), 'admin-managed-separately', 0],
    [refused('23514', 'responsibilities-in-progress', 'total:2,author:1,co-author:0,reviewer:1,approver:0'), 'responsibilities-in-progress', 2],
    [refused('42501'), 'forbidden', 0],
    [refused('PGRST301'), 'forbidden', 0],
    [refused('P0002'), 'not-found', 0],
    [refused('XX000'), 'failed', 0],
  ] as const)('reports each refusal in the app\'s words (%#)', async (response, reason, blockingSops) => {
    rpc.mockResolvedValue(response)
    const error = await deactivateStaff('u').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DeactivateStaffError)
    expect(error).toMatchObject({ reason, blockingSops })
    expect(String((error as Error).message)).not.toContain('A DATABASE MESSAGE')
  })

  it('reports a network failure, and an answer it doesn\'t understand, as failed (never as success)', async () => {
    rpc.mockRejectedValue(new Error('offline'))
    await expect(deactivateStaff('u')).rejects.toMatchObject({ reason: 'failed' })
    rpc.mockResolvedValue({ data: null, error: null })
    await expect(deactivateStaff('u')).rejects.toMatchObject({ reason: 'failed' })
  })

  it('has a message for every refusal', () => {
    for (const reason of ['forbidden', 'not-found', 'self-delete', 'admin-managed-separately', 'failed'] as const) {
      expect(adminEn.deleteUser.failures[reason]).toBeTruthy()
    }
    expect(adminEn.deleteUser.inProgress.one).toContain('{count}')
  })
})

describe('the Delete Staff wording says it deactivates', () => {
  it('asks to deactivate, says what is kept, and confirms afterwards', () => {
    expect(adminEn.deleteUser.title).toBe('Deactivate Staff?')
    expect(adminEn.deleteUser.description).toBe('Are you sure you want to deactivate {name}? They will lose access to Hawkim, but their account information and history will be preserved.')
    expect(adminEn.deleteUser.confirm).toBe('Deactivate')
    expect(adminEn.deleteUser.cancel).toBe('Cancel')
    expect(adminEn.deleteUser.done).toBe('{name} deactivated successfully.')
  })
})

describe('Add Staff with a deactivated staff member\'s email', () => {
  const user = { id: 'u', email: 'rana@example.test', name: 'Rana', initials: 'RA', phone: '+966512345678', position: 'Lead', departmentId: 'qa', permissions: ['reviewer'] }
  const details = { name: 'Rana', email: 'rana@example.test', phone: '+966512345678', position: 'Lead', departmentId: 'qa', permissions: ['reviewer' as const] }

  it('says the same person was reactivated, with the new invitation sent', async () => {
    invoke.mockResolvedValue({ data: { user: { ...user, reactivated: true }, emailSent: true }, error: null })
    await expect(addUserAccount(details)).resolves.toMatchObject({ user: { id: 'u' }, emailSent: true, reactivated: true })
  })

  it('says a new account is not a reactivation', async () => {
    invoke.mockResolvedValue({ data: { user: { ...user, reactivated: false }, emailSent: true }, error: null })
    await expect(addUserAccount(details)).resolves.toMatchObject({ reactivated: false })
  })

  it.each(['invitation-failed', 'admin-managed-separately'] as const)('reports %s, and nothing as added', async (errorCode) => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify({ errorCode }), { status: errorCode === 'invitation-failed' ? 502 : 409 })) })
    const error = await addUserAccount(details).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AddUserError)
    expect(error).toMatchObject({ reason: errorCode })
    expect(adminEn.addUser.failures[errorCode]).toBeTruthy()
  })

  it('shows the reactivation message on the staff member\'s page', () => {
    expect(adminEn.userDetails.reactivated).toBe('Staff member reactivated. A new invitation has been sent.')
  })
})

describe('the staff deactivation migration', () => {
  // Read as text: nothing here executes it (supabase/tests/staff_deactivation.sql does).
  const code = migrationSource.replace(/\r/g, '').replace(/--[^\n]*/g, '')
  const deactivate = code.slice(code.indexOf('create function public.deactivate_staff'), code.indexOf('create or replace function public.add_user'))

  it('never removes a person: no DELETE from profiles, user_roles or auth.users, nothing dropped', () => {
    // Deactivation and reactivation (section 3 only redefines save_user, which changes permissions as before).
    const lifecycle = code.slice(0, code.indexOf('create or replace function public.save_user('))
    expect(lifecycle).not.toMatch(/delete\s+from\s+(public\.)?(profiles|user_roles|sops|sop_versions|timeline_events|organization_management_audit)\b/i)
    expect(lifecycle).not.toMatch(/delete\s+from\s+auth\.users\b/i)
    expect(code).not.toMatch(/\b(drop|truncate)\b/i)
    expect(deactivate).toMatch(/update public\.profiles p set deleted_at = ended_at where p\.id = person\.id/)
  })

  it('only lets an active Admin do it, under the shared lock, checked again under it', () => {
    const first = deactivate.indexOf('can_manage_organization()')
    const lock = deactivate.indexOf('pg_advisory_xact_lock(72441, 1)')
    expect(first).toBeGreaterThan(0)
    expect(lock).toBeGreaterThan(first)
    expect(deactivate.indexOf('can_manage_organization()', lock)).toBeGreaterThan(lock)
  })

  it('refuses the caller, Admins and SOP work in progress, and ends their sessions', () => {
    expect(deactivate).toContain("hint = 'self-delete'")
    expect(deactivate).toContain("hint = 'admin-managed-separately'")
    expect(deactivate).toContain("hint = 'responsibilities-in-progress'")
    expect(deactivate).toContain('delete from auth.sessions s where s.user_id = person.id')
    expect(deactivate).toContain("'deactivate-staff'")
  })

  it('runs as its owner with an empty search path, for signed-in users only', () => {
    expect(deactivate).toMatch(/security definer\s+set search_path = ''/)
    expect(code).toContain('revoke all on function public.deactivate_staff(uuid) from public, anon, authenticated, service_role;')
    expect(code).toContain('grant execute on function public.deactivate_staff(uuid) to authenticated;')
  })

  it('never brings back a former Admin through Add Staff, and audits reactivations', () => {
    expect(code).toMatch(/if readded and not system_admin and exists \(select 1 from public\.user_roles r where r\.user_id = person\.id and r\.role = 'admin'\)/)
    expect(code).toContain("'reactivate-user'")
    expect(code).toContain("'reactivated', readded")
  })
})

describe('Edit Staff refuses a stale save at once (not SQLSTATE 40001, which PostgREST 14 retries until it times out)', () => {
  const changes = { name: 'Rana', phone: '+966512345678', position: 'Specialist', departmentId: 'it', permissions: ['author' as const] }

  it('reports the conflict hint as a conflict', async () => {
    rpc.mockResolvedValue(refused('P0001', 'conflict'))
    await expect(saveUser('u', changes, { departmentId: 'qa', permissions: ['author'] })).rejects.toMatchObject({ reason: 'conflict' })
  })

  it('still understands 40001 from a database without the migration', async () => {
    rpc.mockResolvedValue(refused('40001'))
    await expect(saveUser('u', changes, { departmentId: 'qa', permissions: ['author'] })).rejects.toMatchObject({ reason: 'conflict' })
  })

  it('redefines save_user exactly as before except that one refusal', () => {
    const block = (text: string) => {
      const plain = text.replace(/\r/g, '')
      const start = plain.indexOf('create or replace function public.save_user(')
      return plain.slice(start, plain.indexOf('$$;', start) + 3).replace(/[ \t]*--[^\n]*\n/g, '')
    }
    const before = block(staffManagementSource)
    const after = block(migrationSource)
    expect(before).toContain("errcode = '40001'")
    expect(after).not.toContain('40001')
    expect(after.replace("errcode = 'P0001', hint = 'conflict'", "errcode = '40001'")).toBe(before)
  })
})
