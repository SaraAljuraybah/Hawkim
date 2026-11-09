import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DatabaseError, EmailInUseError, updateEmailFlow, validateRequest, type UpdateEmailSteps } from '../../../supabase/functions/update-user-email/flow.ts'

const USER = '3f9c2a10-1b2c-4d5e-8f90-123456789abc'
const input = { userId: USER, email: ' New.Email@Example.TEST ' }

let calls: string[]
let steps: UpdateEmailSteps
const database = (code: string, hint?: string) => new DatabaseError({ code, hint, message: 'A DATABASE MESSAGE' })

beforeEach(() => {
  calls = []
  const step = <T,>(name: string, value: T) => vi.fn(async (...args: unknown[]) => { calls.push(`${name}${args.length > 2 ? `:${String(args[2])}` : ''}`); return value })
  steps = {
    caller: step('caller', 'allowed' as const),
    setProfileEmail: step('setProfileEmail', undefined),
    accountEmail: step('accountEmail', 'old@example.test'),
    setAccountEmail: step('setAccountEmail', undefined),
    log: vi.fn(),
  }
})

describe("changing a staff member's email", () => {
  it('checks in the database, then changes the sign-in account, then the profile', async () => {
    const result = await updateEmailFlow(input, steps)
    expect(calls).toEqual(['caller', 'setProfileEmail:false', 'accountEmail', 'setAccountEmail', 'setProfileEmail:true'])
    expect(steps.setAccountEmail).toHaveBeenCalledWith(USER, 'new.email@example.test')
    expect(result).toEqual({ status: 200, body: { userId: USER, email: 'new.email@example.test' } })
  })

  it("doesn't touch the account when it already has the email (only the profile follows)", async () => {
    steps.accountEmail = vi.fn(async () => 'NEW.EMAIL@example.test')
    await updateEmailFlow(input, steps)
    expect(steps.setAccountEmail).not.toHaveBeenCalled()
    expect(steps.setProfileEmail).toHaveBeenLastCalledWith(USER, 'new.email@example.test', true)
  })

  it('puts the account email back when the profile then refuses it, so both always match', async () => {
    steps.setProfileEmail = vi.fn(async (_id: string, _email: string, apply: boolean) => { if (apply) throw database('23514', 'email-taken') })
    const result = await updateEmailFlow(input, steps)
    expect(steps.setAccountEmail).toHaveBeenNthCalledWith(1, USER, 'new.email@example.test')
    expect(steps.setAccountEmail).toHaveBeenNthCalledWith(2, USER, 'old@example.test')
    expect(result).toEqual({ status: 409, body: { errorCode: 'email-taken' } })
  })

  it('stops before changing anything when the database refuses the dry run', async () => {
    steps.setProfileEmail = vi.fn(async () => { throw database('23514', 'email-taken') })
    expect(await updateEmailFlow(input, steps)).toEqual({ status: 409, body: { errorCode: 'email-taken' } })
    expect(steps.setAccountEmail).not.toHaveBeenCalled()
  })

  it('reports an email another sign-in account already has', async () => {
    steps.setAccountEmail = vi.fn(async () => { throw new EmailInUseError() })
    expect(await updateEmailFlow(input, steps)).toEqual({ status: 409, body: { errorCode: 'email-taken' } })
  })

  it.each([
    ['unauthorized', 401], ['forbidden', 403],
  ] as const)('refuses a caller who is %s, before reading anything', async (caller, status) => {
    steps.caller = vi.fn(async () => caller)
    expect((await updateEmailFlow(input, steps)).status).toBe(status)
    expect(steps.setProfileEmail).not.toHaveBeenCalled()
  })

  it.each([
    [database('42501'), 403, 'forbidden'], [database('P0002'), 404, 'not-found'], [database('23514', 'invalid'), 400, 'invalid'], [new Error('x'), 500, 'failed'],
  ])('explains a database refusal (%s)', async (error, status, errorCode) => {
    steps.setProfileEmail = vi.fn(async () => { throw error })
    expect(await updateEmailFlow(input, steps)).toEqual({ status, body: { errorCode } })
  })

  it('reports an account that no longer exists, and an Auth failure, without changing the profile', async () => {
    steps.accountEmail = vi.fn(async () => undefined)
    expect((await updateEmailFlow(input, steps)).body).toEqual({ errorCode: 'not-found' })
    steps.accountEmail = vi.fn(async () => 'old@example.test')
    steps.setAccountEmail = vi.fn(async () => { throw new Error('update account 500') })
    expect((await updateEmailFlow(input, steps)).body).toEqual({ errorCode: 'account-failed' })
    expect(steps.setProfileEmail).not.toHaveBeenCalledWith(USER, 'new.email@example.test', true)
  })
})

describe('the request', () => {
  it('needs a user id and a valid email, stored in lowercase', () => {
    expect(validateRequest(input)).toEqual({ userId: USER, email: 'new.email@example.test' })
    for (const bad of [null, {}, { userId: 'not-a-uuid', email: 'a@b.co' }, { userId: USER, email: 'nope' }, { userId: USER, email: `${'a'.repeat(250)}@b.co` }]) {
      expect(validateRequest(bad)).toBeUndefined()
    }
  })
})
