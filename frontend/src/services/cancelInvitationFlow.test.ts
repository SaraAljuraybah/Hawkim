import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseError } from '../../../supabase/functions/add-user/flow.ts'
import { cancelInvitationFlow, type CancelSteps } from '../../../supabase/functions/cancel-invitation/flow.ts'

const USER = '9d000000-0000-4000-8000-000000000004'
const CANCELLED = '2026-11-16T10:00:00.123456+00:00'

let calls: string[]
let steps: CancelSteps
const logs = () => (steps.log as ReturnType<typeof vi.fn>).mock.calls.map(([message]) => String(message)).join('\n')
const database = (code: string, hint?: string) => new DatabaseError({ code, hint, message: 'A DATABASE MESSAGE' })

beforeEach(() => {
  calls = []
  const step = <T,>(name: string, value: T) => vi.fn(async () => { calls.push(name); return value })
  steps = {
    caller: step('caller', 'allowed' as const),
    cancel: step('cancel', { cancelledAt: CANCELLED, already: false }),
    undo: step('undo', undefined),
    block: step('block', undefined),
    log: vi.fn(),
  }
})

describe('cancelling an invitation', () => {
  it('records the cancellation first, then blocks the account in Auth', async () => {
    const result = await cancelInvitationFlow({ userId: USER }, steps)
    expect(calls).toEqual(['caller', 'cancel', 'block'])
    expect(steps.cancel).toHaveBeenCalledWith(USER)
    expect(steps.block).toHaveBeenCalledWith(USER)
    expect(result).toEqual({ status: 200, body: { cancelledAt: CANCELLED } })
  })

  it('undoes the cancellation when the account can\'t be blocked, so nothing changed and it can be retried', async () => {
    steps.block = vi.fn(async () => { calls.push('block'); throw new Error('update account 500') })
    const result = await cancelInvitationFlow({ userId: USER }, steps)
    expect(calls).toEqual(['caller', 'cancel', 'block', 'undo'])
    expect(steps.undo).toHaveBeenCalledWith(USER, CANCELLED)
    expect(result).toEqual({ status: 502, body: { errorCode: 'cancel-failed' } })
  })

  it('keeps an earlier cancellation when blocking fails on a repeated request (access stays refused)', async () => {
    steps.cancel = vi.fn(async () => { calls.push('cancel'); return { cancelledAt: CANCELLED, already: true } })
    steps.block = vi.fn(async () => { calls.push('block'); throw new Error('update account 500') })
    expect((await cancelInvitationFlow({ userId: USER }, steps)).status).toBe(502)
    expect(steps.undo).not.toHaveBeenCalled()
  })

  it('blocks the account again on a repeated request, and succeeds', async () => {
    steps.cancel = vi.fn(async () => { calls.push('cancel'); return { cancelledAt: CANCELLED, already: true } })
    expect(await cancelInvitationFlow({ userId: USER }, steps)).toEqual({ status: 200, body: { cancelledAt: CANCELLED } })
    expect(calls).toEqual(['caller', 'cancel', 'block'])
  })

  it.each([
    ['already-activated', 409],
    ['no-invitation', 404],
    ['not-found', 404],
    ['admin-managed-separately', 403],
    ['forbidden', 403],
  ])('refuses %s without touching the account', async (hint, status) => {
    steps.cancel = vi.fn(async () => { throw database(hint === 'not-found' || hint === 'no-invitation' ? 'P0002' : '23514', hint) })
    const result = await cancelInvitationFlow({ userId: USER }, steps)
    expect(result).toEqual({ status, body: { errorCode: hint } })
    expect(steps.block).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not an active Admin, and a request without a person', async () => {
    steps.caller = vi.fn(async () => 'forbidden' as const)
    expect(await cancelInvitationFlow({ userId: USER }, steps)).toEqual({ status: 403, body: { errorCode: 'forbidden' } })
    steps.caller = vi.fn(async () => 'unauthorized' as const)
    expect(await cancelInvitationFlow({ userId: USER }, steps)).toEqual({ status: 401, body: { errorCode: 'unauthorized' } })
    steps.caller = vi.fn(async () => 'allowed' as const)
    expect(await cancelInvitationFlow({ userId: 'not-a-uuid' }, steps)).toEqual({ status: 400, body: { errorCode: 'invalid' } })
    expect(steps.cancel).not.toHaveBeenCalled()
  })

  it('never logs a database message', async () => {
    steps.block = vi.fn(async () => { throw new Error('update account 500') })
    steps.undo = vi.fn(async () => { throw database('08006') })
    await cancelInvitationFlow({ userId: USER }, steps)
    expect(logs()).not.toContain('A DATABASE MESSAGE')
  })
})
