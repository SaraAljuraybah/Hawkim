import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminActionError, deleteAdminAccount, fetchSuperAdminId, transferSuperAdmin, updateAdminDetails } from './admins'

const rpc = vi.fn()
vi.mock('./supabase', () => ({ supabase: () => ({ rpc }) }))
beforeEach(() => vi.clearAllMocks())

const refused = (code: string, hint?: string) => ({ data: null, error: { code, hint: hint ?? null, message: 'x' } })

describe('the Admins server calls', () => {
  it('read who the Super Admin is (null when none is assigned)', async () => {
    rpc.mockResolvedValueOnce({ data: 'u1', error: null }).mockResolvedValueOnce({ data: null, error: null })
    await expect(fetchSuperAdminId()).resolves.toBe('u1')
    await expect(fetchSuperAdminId()).resolves.toBeNull()
    expect(rpc).toHaveBeenCalledWith('get_super_admin_id', {})
  })

  it('save only name and phone on Edit Admin (no role and nothing else)', async () => {
    rpc.mockResolvedValue({ data: { id: 'u2', name: 'Amal Fahad', initials: 'AF', phone: '+966512345678' }, error: null })
    await expect(updateAdminDetails('u2', 'Amal Fahad', '+966512345678')).resolves.toEqual({ name: 'Amal Fahad', initials: 'AF', phone: '+966512345678' })
    expect(rpc).toHaveBeenCalledWith('update_admin', { p_user_id: 'u2', p_full_name: 'Amal Fahad', p_phone: '+966512345678' })
  })

  it('delete by id only', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await deleteAdminAccount('u2')
    expect(rpc).toHaveBeenCalledWith('delete_admin', { p_user_id: 'u2' })
  })

  it('transfer in ONE call naming only the recipient', async () => {
    rpc.mockResolvedValue({ data: 'u2', error: null })
    await expect(transferSuperAdmin('u2')).resolves.toBe('u2')
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('transfer_super_admin', { p_recipient: 'u2' })
  })

  it.each([
    [refused('42501', 'super-admin-required'), 'super-admin-required'],
    [refused('42501', 'super-admin-protected'), 'super-admin-protected'],
    [refused('23514', 'super-admin-protected'), 'super-admin-protected'],
    [refused('23514', 'recipient-not-admin'), 'recipient-not-admin'],
    [refused('23514', 'recipient-self'), 'recipient-self'],
    [refused('23514', 'invalid'), 'invalid'],
    [refused('42501'), 'forbidden'],
    [refused('PGRST301'), 'forbidden'],
    [refused('P0002'), 'not-found'],
    [refused('23514'), 'invalid'],
    [refused('XX000'), 'failed'],
  ])('explain refusal %# as %s', async (response, reason) => {
    rpc.mockResolvedValue(response)
    await expect(transferSuperAdmin('u2')).rejects.toMatchObject({ reason })
  })

  it('report a lost connection as failed', async () => {
    rpc.mockRejectedValue(new TypeError('fetch failed'))
    await expect(deleteAdminAccount('u2')).rejects.toBeInstanceOf(AdminActionError)
    await expect(deleteAdminAccount('u2')).rejects.toMatchObject({ reason: 'failed' })
  })

  it('refuse an unexpected reply rather than trusting it', async () => {
    rpc.mockResolvedValue({ data: { name: 1 }, error: null })
    await expect(updateAdminDetails('u2', 'A', '+966512345678')).rejects.toMatchObject({ reason: 'failed' })
    rpc.mockResolvedValue({ data: 42, error: null })
    await expect(fetchSuperAdminId()).rejects.toMatchObject({ reason: 'failed' })
  })
})
