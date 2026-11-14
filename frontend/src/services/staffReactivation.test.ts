import { beforeEach, describe, expect, it, vi } from 'vitest'
import { adminEn } from '../content/admin.en'
import migrationSource from '../../../supabase/migrations/20261113130000_staff_reactivation.sql?raw'
import { reactivateStaff, ReactivateStaffError, type ReactivateStaffFailure } from './people'

/*
 * Reactivate on the Deactive Staff tab, as the browser calls it. The rules are enforced and tested in the
 * database (supabase/tests/staff_reactivation.sql).
 */

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))
beforeEach(() => vi.clearAllMocks())

const refused = (code: string, hint?: string) => ({ data: null, error: { code, hint, message: 'A DATABASE MESSAGE' } })

describe('Reactivate calls the server', () => {
  it('reactivates the same person through reactivate_staff', async () => {
    rpc.mockResolvedValue({ data: { id: 'u', alreadyActive: false }, error: null })
    await expect(reactivateStaff('u')).resolves.toBeUndefined()
    expect(rpc).toHaveBeenCalledExactlyOnceWith('reactivate_staff', { p_user_id: 'u' })
  })

  it('treats a repeated request as done', async () => {
    rpc.mockResolvedValue({ data: { id: 'u', alreadyActive: true }, error: null })
    await expect(reactivateStaff('u')).resolves.toBeUndefined()
  })

  it.each<[ReturnType<typeof refused>, ReactivateStaffFailure]>([
    [refused('23514', 'admin-managed-separately'), 'admin-managed-separately'],
    [refused('23514', 'email-taken'), 'email-taken'],
    [refused('23514', 'account-unavailable'), 'account-unavailable'],
    [refused('23514', 'department-unavailable'), 'department-unavailable'],
    [refused('42501'), 'forbidden'],
    [refused('PGRST301'), 'forbidden'],
    [refused('P0002'), 'not-found'],
    [refused('XX000'), 'failed'],
  ])('explains a refusal (%j)', async (response, reason) => {
    rpc.mockResolvedValue(response)
    await expect(reactivateStaff('u')).rejects.toEqual(new ReactivateStaffError(reason))
    // Every reason has a message for the admin.
    expect(adminEn.reactivateUser.failures[reason]).toBeTruthy()
  })

  it('fails safely on a lost connection or an unexpected answer', async () => {
    rpc.mockRejectedValue(new Error('offline'))
    await expect(reactivateStaff('u')).rejects.toEqual(new ReactivateStaffError('failed'))
    rpc.mockResolvedValue({ data: { id: 'someone-else' }, error: null })
    await expect(reactivateStaff('u')).rejects.toEqual(new ReactivateStaffError('failed'))
  })
})

describe('the reactivate_staff migration', () => {
  it('only clears deleted_at, keeps the roles and never creates a profile', () => {
    const body = migrationSource.slice(migrationSource.indexOf('create function public.reactivate_staff'), migrationSource.indexOf('-- ---------- 2.'))
    expect(body).toContain('update public.profiles p set deleted_at = null where p.id = person.id;')
    expect(body).not.toMatch(/insert into public\.profiles|delete from public\.user_roles|insert into public\.user_roles/)
    expect(body).toContain("'reactivate-user'")
    expect(migrationSource).toContain('grant execute on function public.reactivate_staff(uuid) to authenticated;')
  })
})
