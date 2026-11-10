import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addUserFlow, DatabaseError, invitationEmail, validateDetails, type AddUserSteps } from '../../../supabase/functions/add-user/flow.ts'

const LINK = 'https://example.test/verify?token=SECRET-LINK-TOKEN'
const FRESH_LINK = 'https://example.test/verify?token=FRESH-SECRET-TOKEN'
const input = { name: ' Rana Saleh ', email: ' Rana@Example.TEST ', phone: '+966512345678', position: ' Specialist ', departmentId: 'home', permissions: ['author', 'reviewer'] }
const cleaned = { name: 'Rana Saleh', email: 'rana@example.test', phone: '+966512345678', position: 'Specialist', departmentId: 'home', permissions: ['author', 'reviewer'] }
const saved = { id: 'id-1', email: cleaned.email, name: cleaned.name, initials: 'RS', phone: cleaned.phone, position: cleaned.position, departmentId: 'home', permissions: cleaned.permissions }

let calls: string[]
let steps: AddUserSteps
const logs = () => (steps.log as ReturnType<typeof vi.fn>).mock.calls.map(([message]) => String(message)).join('\n')
const database = (code: string, hint?: string, details?: string) => new DatabaseError({ code, hint, details, message: 'A DATABASE MESSAGE' })

beforeEach(() => {
  calls = []
  const step = <T,>(name: string, value: T) => vi.fn(async () => { calls.push(name); return value })
  steps = {
    caller: step('caller', 'allowed' as const),
    checkNewUser: step('checkNewUser', undefined),
    accountLink: step('accountLink', { id: 'id-1', link: LINK, existing: false }),
    isBanned: step('isBanned', false),
    profileState: step('profileState', 'none' as const),
    setRandomPassword: step('setRandomPassword', undefined),
    addUser: step('addUser', saved),
    freshLink: step('freshLink', FRESH_LINK),
    deactivate: step('deactivate', undefined),
    sendEmail: step('sendEmail', undefined),
    log: vi.fn(),
  }
})

describe('a new user', () => {
  it('checks first, then creates the account, the profile and the email, in that order', async () => {
    const result = await addUserFlow(input, steps)
    expect(calls).toEqual(['caller', 'checkNewUser', 'accountLink', 'addUser', 'sendEmail'])
    expect(result).toEqual({ status: 200, body: { user: saved, emailSent: true } })
  })

  it('saves the email in lowercase, and everything trimmed', async () => {
    await addUserFlow(input, steps)
    expect(steps.checkNewUser).toHaveBeenCalledWith(cleaned)
    expect(steps.accountLink).toHaveBeenCalledWith('rana@example.test', 'Rana Saleh')
    expect(steps.addUser).toHaveBeenCalledWith('id-1', cleaned)
    expect((steps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('rana@example.test')
  })

  it('does not touch the password of an account it just created', async () => {
    await addUserFlow(input, steps)
    expect(steps.setRandomPassword).not.toHaveBeenCalled()
  })
})

describe('who can add', () => {
  it.each([['unauthorized', 401], ['forbidden', 403]] as const)('refuses a caller who is %s before doing anything else', async (caller, status) => {
    steps.caller = vi.fn(async () => caller)
    expect(await addUserFlow(input, steps)).toEqual({ status, body: { errorCode: caller } })
    expect(steps.checkNewUser).not.toHaveBeenCalled()
    expect(steps.accountLink).not.toHaveBeenCalled()
  })

  it('checks the caller before even looking at the details', async () => {
    steps.caller = vi.fn(async () => 'forbidden' as const)
    expect((await addUserFlow('not an object', steps)).body.errorCode).toBe('forbidden')
  })
})

describe('bad input creates no account', () => {
  it.each([
    ['not an object', 'text'],
    ['no name', { ...input, name: '  ' }],
    ['a name over 100', { ...input, name: 'n'.repeat(101) }],
    ['no email', { ...input, email: '' }],
    ['an invalid email', { ...input, email: 'a b@c' }],
    ['an email over 254', { ...input, email: `${'a'.repeat(250)}@b.co` }],
    ['a phone not as stored', { ...input, phone: '0512345678' }],
    ['no position', { ...input, position: ' ' }],
    ['a position over 100', { ...input, position: 'p'.repeat(101) }],
    ['no department', { ...input, departmentId: '' }],
    ['no permissions list', { ...input, permissions: 'author' }],
    ['an unknown permission', { ...input, permissions: ['owner'] }],
  ])('%s', async (_, body) => {
    expect((await addUserFlow(body, steps)).body.errorCode).toBe('invalid')
    expect(steps.checkNewUser).not.toHaveBeenCalled()
    expect(steps.accountLink).not.toHaveBeenCalled()
  })

  it('allows a name and position of exactly 100, and no permissions', () => {
    expect(validateDetails({ ...input, name: 'n'.repeat(100), position: 'p'.repeat(100), permissions: [] })?.name).toHaveLength(100)
  })

  it.each([
    ['email-taken', 409],
    ['admin-exclusive', 409],
    ['approver-quality', 409],
    ['department-unavailable', 409],
    ['invalid', 400],
  ])('stops at check_new_user when it refuses with %s', async (hint, status) => {
    steps.checkNewUser = vi.fn(async () => { throw database('23514', hint) })
    expect(await addUserFlow(input, steps)).toEqual({ status, body: { errorCode: hint } })
    expect(steps.accountLink).not.toHaveBeenCalled()
  })

  it('stops when the database says the caller is no longer an admin', async () => {
    steps.checkNewUser = vi.fn(async () => { throw database('42501') })
    expect((await addUserFlow(input, steps)).body.errorCode).toBe('forbidden')
    expect(steps.accountLink).not.toHaveBeenCalled()
  })
})

describe('an account that already exists', () => {
  beforeEach(() => {
    steps.accountLink = vi.fn(async () => { calls.push('accountLink'); return { id: 'id-1', link: LINK, existing: true } })
  })

  it('gets a random password before the profile is saved, so only the emailed link opens it', async () => {
    const result = await addUserFlow(input, steps)
    expect(calls).toEqual(['caller', 'checkNewUser', 'accountLink', 'isBanned', 'profileState', 'setRandomPassword', 'addUser', 'freshLink', 'sendEmail'])
    expect(result.status).toBe(200)
  })

  it('emails a link made after the profile is saved, so a concurrent, refused request cannot replace it', async () => {
    await addUserFlow(input, steps)
    expect(steps.freshLink).toHaveBeenCalledWith('rana@example.test')
    const html = (steps.sendEmail as ReturnType<typeof vi.fn>).mock.calls[0][2] as string
    expect(html).toContain('FRESH-SECRET-TOKEN')
    expect(html).not.toContain('SECRET-LINK-TOKEN"')
  })

  it('is refused when banned, and nothing about it changes', async () => {
    steps.isBanned = vi.fn(async () => true)
    expect(await addUserFlow(input, steps)).toEqual({ status: 409, body: { errorCode: 'account-blocked' } })
    expect(steps.setRandomPassword).not.toHaveBeenCalled()
    expect(steps.addUser).not.toHaveBeenCalled()
    expect(steps.sendEmail).not.toHaveBeenCalled()
  })

  it('never changes the password of someone already using Hawkim', async () => {
    steps.profileState = vi.fn(async () => 'active' as const)
    expect(await addUserFlow(input, steps)).toEqual({ status: 409, body: { errorCode: 'email-taken' } })
    expect(steps.setRandomPassword).not.toHaveBeenCalled()
    expect(steps.addUser).not.toHaveBeenCalled()
  })

  it.each(['isBanned', 'profileState', 'setRandomPassword'] as const)('stops when %s fails, with no profile saved', async (name) => {
    steps[name] = vi.fn(async () => { throw new Error('Auth is down') }) as never
    expect(await addUserFlow(input, steps)).toEqual({ status: 502, body: { errorCode: 'account-failed' } })
    expect(steps.addUser).not.toHaveBeenCalled()
    expect(steps.sendEmail).not.toHaveBeenCalled()
  })
})

describe('when a later step fails', () => {
  it('reports the account failing, with no profile and no email', async () => {
    steps.accountLink = vi.fn(async () => { throw new Error('generate_link 500') })
    expect(await addUserFlow(input, steps)).toEqual({ status: 502, body: { errorCode: 'account-failed' } })
    expect(steps.addUser).not.toHaveBeenCalled()
    expect(steps.sendEmail).not.toHaveBeenCalled()
  })

  it.each([
    [database('23514', 'email-taken'), 409, { errorCode: 'email-taken' }],
    [database('23514', 'permission-in-use', 'author:2'), 409, { errorCode: 'permission-in-use', inUse: 'author:2' }],
    [database('23514'), 400, { errorCode: 'invalid' }],
    [database('42501'), 403, { errorCode: 'forbidden' }],
    [database('PGRST303'), 403, { errorCode: 'forbidden' }],
    [database('XX000'), 500, { errorCode: 'failed' }],
    [new Error('network'), 500, { errorCode: 'failed' }],
  ])('reports add_user failing, and sends no email: the account stays for a retry (%#)', async (error, status, body) => {
    steps.addUser = vi.fn(async () => { throw error })
    expect(await addUserFlow(input, steps)).toEqual({ status, body })
    expect(steps.sendEmail).not.toHaveBeenCalled()
  })

  it('keeps the user when only the email fails', async () => {
    steps.sendEmail = vi.fn(async () => { throw new Error('SNDR 500') })
    expect(await addUserFlow(input, steps)).toEqual({ status: 200, body: { user: saved, emailSent: false } })
  })
})

describe('Add Staff with a deactivated staff member email (reactivation)', () => {
  const reactivated = { ...saved, reactivated: true }
  beforeEach(() => {
    steps.accountLink = vi.fn(async () => { calls.push('accountLink'); return { id: 'id-1', link: LINK, existing: true } })
    steps.addUser = vi.fn(async () => { calls.push('addUser'); return reactivated })
    steps.profileState = vi.fn(async () => { calls.push('profileState'); return 'deactivated' as const })
  })

  it('reuses the account; only after add_user lets it through does it replace the password, then make and send the link', async () => {
    const result = await addUserFlow(input, steps)
    expect(steps.addUser).toHaveBeenCalledWith('id-1', cleaned)
    expect(calls).toEqual(['caller', 'checkNewUser', 'accountLink', 'isBanned', 'profileState', 'addUser', 'setRandomPassword', 'freshLink', 'sendEmail'])
    expect(result).toEqual({ status: 200, body: { user: reactivated, emailSent: true } })
    expect(steps.deactivate).not.toHaveBeenCalled()
  })

  it.each([
    ['the email cannot be sent', () => { steps.sendEmail = vi.fn(async () => { throw new Error('SNDR 500') }) }],
    ['the link cannot be made', () => { steps.freshLink = vi.fn(async () => { throw new Error('generate_link 500') }) }],
  ])('deactivates them again and says so when %s: never a false success, and a retry is safe', async (_, fail) => {
    fail()
    expect(await addUserFlow(input, steps)).toEqual({ status: 502, body: { errorCode: 'invitation-failed' } })
    expect(steps.deactivate).toHaveBeenCalledWith('id-1')
  })

  it('reports them as added without an invitation when they cannot be deactivated again (they really are active)', async () => {
    steps.sendEmail = vi.fn(async () => { throw new Error('SNDR 500') })
    steps.deactivate = vi.fn(async () => { throw database('XX000') })
    expect(await addUserFlow(input, steps)).toEqual({ status: 200, body: { user: reactivated, emailSent: false } })
  })

  it('leaves Add Admin as it was: an Admin brought back is never deactivated by it', async () => {
    const admin = { ...input, permissions: ['admin'] }
    steps.sendEmail = vi.fn(async () => { throw new Error('SNDR 500') })
    expect((await addUserFlow(admin, steps)).status).toBe(200)
    expect(steps.deactivate).not.toHaveBeenCalled()
  })

  it('touches nothing in Auth when a concurrent Add Staff got there first, so it can’t spoil that invitation', async () => {
    steps.addUser = vi.fn(async () => { throw database('23514', 'email-taken') })
    expect(await addUserFlow(input, steps)).toEqual({ status: 409, body: { errorCode: 'email-taken' } })
    expect(steps.setRandomPassword).not.toHaveBeenCalled()
    expect(steps.freshLink).not.toHaveBeenCalled()
    expect(steps.sendEmail).not.toHaveBeenCalled()
  })

  it('deactivates them again when the old password can’t be replaced', async () => {
    steps.setRandomPassword = vi.fn(async () => { throw new Error('Auth is down') })
    expect(await addUserFlow(input, steps)).toEqual({ status: 502, body: { errorCode: 'invitation-failed' } })
    expect(steps.deactivate).toHaveBeenCalledWith('id-1')
    expect(steps.sendEmail).not.toHaveBeenCalled()
  })

  it('keeps Add Admin’s order for a former Admin: the password first, then add_user', async () => {
    calls = []
    await addUserFlow({ ...input, permissions: ['admin'] }, steps)
    expect(calls.indexOf('setRandomPassword')).toBeLessThan(calls.indexOf('addUser'))
  })

  it('refuses bringing back a former Admin as staff', async () => {
    steps.addUser = vi.fn(async () => { throw database('23514', 'admin-managed-separately') })
    expect(await addUserFlow(input, steps)).toEqual({ status: 409, body: { errorCode: 'admin-managed-separately' } })
    expect(steps.sendEmail).not.toHaveBeenCalled()
  })

  it('never makes a second link for an account it just created', async () => {
    steps.accountLink = vi.fn(async () => ({ id: 'id-1', link: LINK, existing: false }))
    await addUserFlow(input, steps)
    expect(steps.freshLink).not.toHaveBeenCalled()
  })

  it('never returns or logs either link', async () => {
    steps.sendEmail = vi.fn(async () => { throw new Error('SNDR 500') })
    const outcome = await addUserFlow(input, steps)
    expect(JSON.stringify(outcome)).not.toMatch(/SECRET-LINK-TOKEN|FRESH-SECRET-TOKEN/)
    expect(logs()).not.toMatch(/SECRET-LINK-TOKEN|FRESH-SECRET-TOKEN|rana@example\.test/)
  })
})

describe('what must stay secret', () => {
  it('never returns or logs the link, in any outcome', async () => {
    const outcomes = [
      await addUserFlow(input, steps),
      await (async () => { steps.sendEmail = vi.fn(async () => { throw new Error('SNDR 500') }); return addUserFlow(input, steps) })(),
      await (async () => { steps.addUser = vi.fn(async () => { throw database('XX000') }); return addUserFlow(input, steps) })(),
    ]
    for (const outcome of outcomes) expect(JSON.stringify(outcome)).not.toContain('SECRET-LINK-TOKEN')
    expect(logs()).not.toContain('SECRET-LINK-TOKEN')
    expect(logs()).not.toContain('rana@example.test')
  })

  it('never returns database messages', async () => {
    steps.addUser = vi.fn(async () => { throw database('XX000') })
    expect(JSON.stringify(await addUserFlow(input, steps))).not.toContain('A DATABASE MESSAGE')
  })
})

describe('the invitation email', () => {
  const email = invitationEmail('rana@example.test', LINK)

  it('invites them, with the button linking to their link', () => {
    expect(email.subject).toBe('You’re invited to Hawkim')
    expect(email.html).toContain('A Hawkim admin has created an account for <strong>rana@example.test</strong>. Accept this invitation to access the platform and set your password.')
    expect(email.html).toContain('Accept invitation')
    expect(email.html).toContain(LINK)
  })

  it('says what to do when the link has expired', () => {
    expect(email.html).toContain('If it has expired, use “Forgot password?” on the sign-in page.')
  })

  it('escapes the address', () => {
    expect(invitationEmail('<b>@example.test', LINK).html).not.toContain('<b>@example.test')
  })
})
