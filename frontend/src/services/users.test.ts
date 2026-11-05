import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usersAdminEn as text } from '../content/usersAdmin.en'
import { createUser, deleteUserAccount, setUserPermissions } from './users'
import { organizationEvents, ORGANIZATION_CHANGED } from './organizationAdmin'

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, functions: { invoke } }) }))
const failure = (errorCode: string) => ({ data: null, error: { context: { json: async () => ({ errorCode }) } } })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { location: { origin: 'https://hawkim.example' } })
  invoke.mockResolvedValue({ data: { userId: 'new-id' }, error: null })
  rpc.mockResolvedValue({ data: null, error: null })
})

describe('creating a user', () => {
  it('goes through the secure Edge Function (never the Auth admin API from the browser)', async () => {
    const listener = vi.fn()
    organizationEvents.addEventListener(ORGANIZATION_CHANGED, listener)
    const id = await createUser({ name: ' Sara Ali ', email: ' Sara@Test.Invalid ', phone: '0512345678', departmentId: 'qa',
      positions: [' Officer ', ''], permissions: ['author'] })
    organizationEvents.removeEventListener(ORGANIZATION_CHANGED, listener)
    expect(id).toBe('new-id')
    expect(invoke).toHaveBeenCalledWith('manage-users', { body: { action: 'create', name: 'Sara Ali', email: 'sara@test.invalid',
      phone: '0512345678', departmentId: 'qa', positions: ['Officer'], roles: ['author'], redirectTo: 'https://hawkim.example/reset-password' } })
    expect(listener).toHaveBeenCalledOnce()
  })
  it.each([
    ['email-taken', text.emailTaken], ['approver-quality', text.approverQuality], ['department-unavailable', text.departmentUnavailable],
    ['invite-failed', text.inviteFailed], ['forbidden', text.forbidden], ['something-else', text.failed],
  ])('explains the refusal %s', async (code, message) => {
    invoke.mockResolvedValue(failure(code))
    await expect(createUser({ name: 'A', email: 'a@b.c', phone: '0512345678', departmentId: 'qa', positions: ['X'], permissions: [] })).rejects.toThrow(message)
  })
})

describe('permissions and deletion', () => {
  it('saves permissions through the admin RPC and explains database refusals', async () => {
    await setUserPermissions('u', ['reviewer'])
    expect(rpc).toHaveBeenCalledWith('set_user_roles', { p_user_id: 'u', p_roles: ['reviewer'] })
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'At least one admin must remain' } })
    await expect(setUserPermissions('u', [])).rejects.toThrow(text.lastAdmin)
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'This permission is in use on SOPs' } })
    await expect(setUserPermissions('u', [])).rejects.toThrow(text.inUse)
  })
  it('deletes through the Edge Function and reports an unfinished sign-in block', async () => {
    await deleteUserAccount('u')
    expect(invoke).toHaveBeenCalledWith('manage-users', { body: { action: 'delete', userId: 'u' } })
    invoke.mockResolvedValue(failure('ban-failed'))
    await expect(deleteUserAccount('u')).rejects.toThrow(text.banFailed)
  })
})
