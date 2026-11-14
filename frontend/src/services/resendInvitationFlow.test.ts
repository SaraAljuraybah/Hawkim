import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseError } from '../../../supabase/functions/add-user/flow.ts'
import { resendInvitationFlow, validateRequest, type ResendSteps } from '../../../supabase/functions/resend-invitation/flow.ts'

const USER = '9d000000-0000-4000-8000-000000000004'
const LINK = 'https://example.test/verify?token=SECRET-LINK-TOKEN'
const CLAIMED = '2026-11-11T10:00:00.123456+00:00'

let calls: string[]
let steps: ResendSteps
const logs = () => (steps.log as ReturnType<typeof vi.fn>).mock.calls.map(([message]) => String(message)).join('\n')
const database = (code: string, hint?: string) => new DatabaseError({ code, hint, message: 'A DATABASE MESSAGE' })

beforeEach(() => {
  calls = []
  const step = <T,>(name: string, value: T) => vi.fn(async () => { calls.push(name); return value })
  steps = {
    caller: step('caller', 'allowed' as const),
    claim: step('claim', { email: 'rana@example.test', claimedAt: CLAIMED }),
    revert: step('revert', undefined),
    newLink: step('newLink', LINK),
    sendEmail: step('sendEmail', undefined),
    log: vi.fn(),
  }
})

describe('resending an expired invitation', () => {
  it('claims it first, then makes a new link and emails it to the account', async () => {
    const result = await resendInvitationFlow({ userId: USER }, steps)
    expect(calls).toEqual(['caller', 'claim', 'newLink', 'sendEmail'])
    expect(steps.claim).toHaveBeenCalledWith(USER)
    expect(steps.newLink).toHaveBeenCalledWith('rana@example.test')
    const [to, subject, html] = (steps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(to).toBe('rana@example.test')
    expect(subject).toBe('You’re invited to Hawkim')
    expect(html).toContain(`href="${LINK}"`)
    expect(html).toContain('A Hawkim Admin has created an account for')
    expect(result).toEqual({ status: 200, body: { email: 'rana@example.test' } })
  })

  it('uses only the id from the request, never an address from it', async () => {
    await resendInvitationFlow({ userId: USER.toUpperCase(), email: 'attacker@example.test' }, steps)
    expect(steps.claim).toHaveBeenCalledWith(USER)
    expect(steps.sendEmail).toHaveBeenCalledWith('rana@example.test', expect.any(String), expect.any(String))
  })

  it('never returns or logs the link', async () => {
    const result = await resendInvitationFlow({ userId: USER }, steps)
    expect(JSON.stringify(result)).not.toContain('SECRET-LINK-TOKEN')
    expect(logs()).not.toContain('SECRET-LINK-TOKEN')
  })
})

describe('who can resend', () => {
  it.each([['unauthorized', 401], ['forbidden', 403]] as const)('refuses a caller who is %s before anything else', async (caller, status) => {
    steps.caller = vi.fn(async () => caller)
    expect(await resendInvitationFlow({ userId: USER }, steps)).toEqual({ status, body: { errorCode: caller } })
    expect(steps.claim).not.toHaveBeenCalled()
  })

  it.each([undefined, null, {}, { userId: 'not-a-uuid' }, { userId: 42 }, `{"userId":"${USER}"}`])('refuses a request that isn’t { userId } (%s)', async (input) => {
    expect(await resendInvitationFlow(input, steps)).toEqual({ status: 400, body: { errorCode: 'invalid' } })
    expect(steps.claim).not.toHaveBeenCalled()
  })

  it('reads the id only as a uuid', () => {
    expect(validateRequest({ userId: USER })).toBe(USER)
    expect(validateRequest({ userId: `${USER} ` })).toBeUndefined()
  })
})

describe('when the database refuses the claim (edge cases)', () => {
  it.each([
    ['already-activated', 409], ['still-valid', 409], ['account-blocked', 409],
    ['not-found', 404], ['no-invitation', 404], ['super-admin-required', 403], ['forbidden', 403],
  ] as const)('%s: refused, with no link and no email', async (hint, status) => {
    steps.claim = vi.fn(async () => { throw database('23514', hint) })
    expect(await resendInvitationFlow({ userId: USER }, steps)).toEqual({ status, body: { errorCode: hint } })
    expect(steps.newLink).not.toHaveBeenCalled()
    expect(steps.sendEmail).not.toHaveBeenCalled()
    expect(steps.revert).not.toHaveBeenCalled()
  })

  it('never returns database messages', async () => {
    steps.claim = vi.fn(async () => { throw database('XX000') })
    const result = await resendInvitationFlow({ userId: USER }, steps)
    expect(result).toEqual({ status: 500, body: { errorCode: 'failed' } })
    expect(JSON.stringify(result)).not.toContain('A DATABASE MESSAGE')
  })
})

describe('when the link or the email fails', () => {
  it('puts the previous sending back when no link can be made, so Resend can be tried again', async () => {
    steps.newLink = vi.fn(async () => { throw new Error('generate_link 500') })
    expect(await resendInvitationFlow({ userId: USER }, steps)).toEqual({ status: 502, body: { errorCode: 'link-failed' } })
    expect(steps.revert).toHaveBeenCalledWith(USER, CLAIMED)
    expect(steps.sendEmail).not.toHaveBeenCalled()
  })

  it('puts the previous sending back when the email fails', async () => {
    steps.sendEmail = vi.fn(async () => { throw new Error('SNDR 503') })
    expect(await resendInvitationFlow({ userId: USER }, steps)).toEqual({ status: 502, body: { errorCode: 'email-failed' } })
    expect(steps.revert).toHaveBeenCalledWith(USER, CLAIMED)
    expect(logs()).toContain('email-failed')
  })

  it('still reports the failure when the revert fails too, and logs it without database messages', async () => {
    steps.sendEmail = vi.fn(async () => { throw new Error('SNDR 503') })
    steps.revert = vi.fn(async () => { throw database('40001') })
    expect(await resendInvitationFlow({ userId: USER }, steps)).toEqual({ status: 502, body: { errorCode: 'email-failed' } })
    expect(logs()).toContain('revert failed')
    expect(logs()).not.toContain('A DATABASE MESSAGE')
  })
})
