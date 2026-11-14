import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchMyExpiredInvitations, markAccountActivated, resendInvitation } from './invitations'

const rpc = vi.hoisted(() => vi.fn())
const invoke = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, functions: { invoke } }) }))
beforeEach(() => vi.clearAllMocks())

const row = { user_id: 'u-1', name: 'Rana Saleh', email: 'rana@example.test', kind: 'staff', sent_at: '2026-11-10T08:00:00+00:00', expired_at: '2026-11-11T08:00:00+00:00' }
const httpError = (status: number, body: unknown) => ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify(body), { status })) })

describe('marking one’s own account activated', () => {
  it('calls the database without waiting, and ignores a failure', async () => {
    rpc.mockReturnValue(Promise.reject(new Error('offline')))
    expect(markAccountActivated()).toBeUndefined()
    expect(rpc).toHaveBeenCalledWith('mark_account_activated')
    await Promise.resolve()
  })

  it('never throws, even when the client itself fails', () => {
    rpc.mockImplementation(() => { throw new Error('not configured') })
    expect(() => markAccountActivated()).not.toThrow()
  })
})

describe('the signed-in Admin’s expired invitations', () => {
  it('reads them from the database, keeping only well-formed rows', async () => {
    rpc.mockResolvedValue({ data: [row, { ...row, user_id: 'u-2', kind: 'superuser' }, { ...row, user_id: 3 }, { ...row, user_id: 'u-4', kind: 'admin' }], error: null })
    expect(await fetchMyExpiredInvitations()).toEqual([
      { userId: 'u-1', name: 'Rana Saleh', email: 'rana@example.test', kind: 'staff', sentAt: row.sent_at, expiredAt: row.expired_at },
      { userId: 'u-4', name: 'Rana Saleh', email: 'rana@example.test', kind: 'admin', sentAt: row.sent_at, expiredAt: row.expired_at },
    ])
    expect(rpc).toHaveBeenCalledWith('get_my_expired_invitations')
  })

  it('throws when they can’t be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(fetchMyExpiredInvitations()).rejects.toThrow()
    rpc.mockResolvedValue({ data: { not: 'a list' }, error: null })
    await expect(fetchMyExpiredInvitations()).rejects.toThrow()
  })
})

describe('Resend invitation', () => {
  it('calls the resend-invitation function with the person’s id only, and returns the address it was sent to', async () => {
    invoke.mockResolvedValue({ data: { email: 'rana@example.test' }, error: null })
    expect(await resendInvitation('u-1')).toEqual({ ok: true, email: 'rana@example.test' })
    expect(invoke).toHaveBeenCalledWith('resend-invitation', { body: { userId: 'u-1' } })
  })

  it.each([
    ['already-activated', 409, 'already-activated'], ['still-valid', 409, 'still-valid'], ['not-found', 404, 'not-found'],
    ['no-invitation', 404, 'no-invitation'], ['account-blocked', 409, 'account-blocked'], ['forbidden', 403, 'forbidden'],
    ['super-admin-required', 403, 'forbidden'], ['unauthorized', 401, 'forbidden'],
    ['email-failed', 502, 'email-failed'], ['link-failed', 502, 'email-failed'], ['failed', 500, 'failed'], ['something-new', 500, 'failed'],
  ])('maps %s to %s', async (code, status, reason) => {
    invoke.mockResolvedValue(httpError(status, { errorCode: code }))
    expect(await resendInvitation('u-1')).toEqual({ ok: false, reason })
  })

  it('reports a connection failure or an unreadable answer as failed', async () => {
    invoke.mockResolvedValue({ data: null, error: new FunctionsFetchError('offline') })
    expect(await resendInvitation('u-1')).toEqual({ ok: false, reason: 'failed' })
    invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(new Response('not json', { status: 500 })) })
    expect(await resendInvitation('u-1')).toEqual({ ok: false, reason: 'failed' })
    invoke.mockRejectedValue(new Error('boom'))
    expect(await resendInvitation('u-1')).toEqual({ ok: false, reason: 'failed' })
  })
})
