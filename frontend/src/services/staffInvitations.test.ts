import { FunctionsHttpError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { linkStage } from '../lib/invitations'
import {
  cancelInvitation, confirmAccountActivated, fetchInvitationLinkState, fetchStaffInvitations, resendInvitation,
} from './invitations'

const rpc = vi.hoisted(() => vi.fn())
const invoke = vi.hoisted(() => vi.fn())
vi.mock('./supabase', () => ({ supabase: () => ({ rpc, functions: { invoke } }) }))
beforeEach(() => vi.clearAllMocks())

const httpError = (status: number, body: unknown) => ({ data: null, error: new FunctionsHttpError(new Response(JSON.stringify(body), { status })) })
const row = { user_id: 'u-1', sent_at: '2026-11-16T08:00:00+00:00', expires_at: '2026-11-17T08:00:00+00:00', expired: false, cancelled: false }
const REF = '7c000000-0000-4000-8000-0000000000aa'

describe('Sent Invitations from the database', () => {
  it('reads get_staff_invitations, keeping only well-formed rows', async () => {
    rpc.mockResolvedValue({ data: [row, { ...row, user_id: 'u-2', expired: 'yes' }, { ...row, user_id: 'u-3', cancelled: true }], error: null })
    expect(await fetchStaffInvitations()).toEqual([
      { userId: 'u-1', sentAt: row.sent_at, expiresAt: row.expires_at, expired: false, cancelled: false },
      { userId: 'u-3', sentAt: row.sent_at, expiresAt: row.expires_at, expired: false, cancelled: true },
    ])
    expect(rpc).toHaveBeenCalledWith('get_staff_invitations')
  })

  it('throws when they can\'t be read (e.g. not an Admin, or the database is older)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(fetchStaffInvitations()).rejects.toThrow()
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
    await expect(fetchStaffInvitations()).rejects.toThrow()
  })
})

describe('Resend from Sent Invitations', () => {
  it('returns the new sending\'s time when the server gives it', async () => {
    invoke.mockResolvedValue({ data: { email: 'rana@example.test', sentAt: '2026-11-16T12:00:00Z' }, error: null })
    expect(await resendInvitation('u-1')).toEqual({ ok: true, email: 'rana@example.test', sentAt: '2026-11-16T12:00:00Z' })
    invoke.mockResolvedValue({ data: { email: 'rana@example.test' }, error: null })
    expect(await resendInvitation('u-1')).toEqual({ ok: true, email: 'rana@example.test' })
  })

  it('reports a cancelled invitation, a still-valid link and an email failure', async () => {
    invoke.mockResolvedValue(httpError(409, { errorCode: 'cancelled' }))
    expect(await resendInvitation('u-1')).toEqual({ ok: false, reason: 'cancelled' })
    invoke.mockResolvedValue(httpError(409, { errorCode: 'still-valid' }))
    expect(await resendInvitation('u-1')).toEqual({ ok: false, reason: 'still-valid' })
    invoke.mockResolvedValue(httpError(502, { errorCode: 'email-failed' }))
    expect(await resendInvitation('u-1')).toEqual({ ok: false, reason: 'email-failed' })
  })
})

describe('Cancel invitation', () => {
  it('calls the cancel-invitation Edge Function with the person only', async () => {
    invoke.mockResolvedValue({ data: { cancelledAt: '2026-11-16T12:00:00Z' }, error: null })
    expect(await cancelInvitation('u-1')).toEqual({ ok: true })
    expect(invoke).toHaveBeenCalledWith('cancel-invitation', { body: { userId: 'u-1' } })
  })

  it.each([
    ['already-activated', 409, 'already-activated'],
    ['no-invitation', 404, 'no-invitation'],
    ['admin-managed-separately', 403, 'admin-managed-separately'],
    ['cancel-failed', 502, 'cancel-failed'],
    ['unauthorized', 401, 'forbidden'],
    ['something-new', 500, 'failed'],
  ] as const)('maps %s to its reason', async (code, status, reason) => {
    invoke.mockResolvedValue(httpError(status, { errorCode: code }))
    expect(await cancelInvitation('u-1')).toEqual({ ok: false, reason })
  })

  it('reports a failure when the network fails', async () => {
    invoke.mockRejectedValue(new Error('offline'))
    expect(await cancelInvitation('u-1')).toEqual({ ok: false, reason: 'failed' })
  })
})

describe('what became of an invitation link', () => {
  it('asks the invitation-link-state Edge Function, for a well-formed reference only', async () => {
    invoke.mockResolvedValue({ data: { state: 'cancelled' }, error: null })
    expect(await fetchInvitationLinkState(REF)).toBe('cancelled')
    expect(invoke).toHaveBeenCalledWith('invitation-link-state', { body: { linkRef: REF } })
    expect(rpc).not.toHaveBeenCalled()
    invoke.mockClear()
    expect(await fetchInvitationLinkState('not-a-reference')).toBe('unknown')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('says unknown when it cannot tell', async () => {
    invoke.mockResolvedValue(httpError(500, { errorCode: 'failed' }))
    expect(await fetchInvitationLinkState(REF)).toBe('unknown')
    invoke.mockResolvedValue({ data: { state: 'something-else' }, error: null })
    expect(await fetchInvitationLinkState(REF)).toBe('unknown')
    invoke.mockRejectedValue(new Error('offline'))
    expect(await fetchInvitationLinkState(REF)).toBe('unknown')
  })

  it('Set New Password shows "cancelled" for a cancelled invitation and never starts its session', async () => {
    const startPasswordRecovery = vi.fn(async () => true)
    const cancelled = { fetchInvitationLinkState: vi.fn(async () => 'cancelled' as const), startPasswordRecovery }
    expect(await linkStage(`?invitation=${REF}`, '#access_token=a', cancelled)).toBe('cancelled')
    expect(startPasswordRecovery).not.toHaveBeenCalled()
  })

  it('Set New Password tells an expired or replaced invitation link apart from a cancelled one', async () => {
    const startPasswordRecovery = vi.fn(async () => false)
    for (const state of ['expired', 'replaced', 'unknown'] as const) {
      expect(await linkStage(`?invitation=${REF}`, '#error=access_denied', { fetchInvitationLinkState: async () => state, startPasswordRecovery })).toBe('invalid')
    }
    // A link without an invitation (Forgot password) never asks.
    const ask = vi.fn(async () => 'cancelled' as const)
    expect(await linkStage('', '#access_token=a', { fetchInvitationLinkState: ask, startPasswordRecovery: async () => true })).toBe('ready')
    expect(ask).not.toHaveBeenCalled()
  })
})

describe('activation after saving the password', () => {
  it('waits for mark_account_activated, and tries once more when it fails', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '08006' } }).mockResolvedValueOnce({ data: null, error: null })
    await confirmAccountActivated()
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('mark_account_activated')
  })

  it('never throws, even when the client fails', async () => {
    rpc.mockImplementation(() => { throw new Error('not configured') })
    await expect(confirmAccountActivated()).resolves.toBeUndefined()
  })
})

describe('the invitation-link-state Edge Function', () => {
  it('answers with the state only, for a well-formed reference only', async () => {
    const { linkStateFlow } = await import('../../../supabase/functions/invitation-link-state/flow.ts')
    const lookup = vi.fn(async () => 'cancelled')
    expect(await linkStateFlow({ linkRef: REF.toUpperCase() }, lookup, vi.fn())).toEqual({ status: 200, body: { state: 'cancelled' } })
    expect(lookup).toHaveBeenCalledWith(REF)
    expect(await linkStateFlow({ linkRef: 'x' }, lookup, vi.fn())).toEqual({ status: 400, body: { errorCode: 'invalid' } })
    expect(await linkStateFlow(undefined, lookup, vi.fn())).toEqual({ status: 400, body: { errorCode: 'invalid' } })
    expect(await linkStateFlow({ linkRef: REF }, async () => 'odd', vi.fn())).toEqual({ status: 200, body: { state: 'unknown' } })
    const log = vi.fn()
    expect(await linkStateFlow({ linkRef: REF }, async () => { throw new Error('A DATABASE MESSAGE') }, log)).toEqual({ status: 500, body: { errorCode: 'failed' } })
    expect(String(log.mock.calls[0][0])).not.toContain('A DATABASE MESSAGE')
  })
})
