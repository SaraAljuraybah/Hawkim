import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '../data/mock/types'
import { changePassword, recoveryTokens, restoreSession, sendPasswordResetEmail, setNewPassword, signIn, signOut, startPasswordRecovery } from './auth'

const auth = {
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  resetPasswordForEmail: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
}
// The separate client that only checks a password.
const checker = {
  signInWithPassword: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}
const fetchProfile = vi.fn<(id: string) => Promise<User | null>>()

vi.mock('./supabase', () => ({ supabase: () => ({ auth }), passwordCheckClient: () => ({ auth: checker }) }))
vi.mock('./people', () => ({ fetchProfile: (id: string) => fetchProfile(id) }))
const markAccountActivated = vi.hoisted(() => vi.fn())
vi.mock('./invitations', () => ({ markAccountActivated }))

const sara: User = { id: 'uuid-sara', name: 'Sara Aljuraybah', email: 'sara.aljuraybah@hawkim.test', initials: 'SA', departmentId: 'information-technology', permissions: ['author'] }
const signedIn = { data: { user: { id: 'uuid-sara' }, session: {} }, error: null }
const failed = (error: Error) => ({ data: { user: null, session: null }, error })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('signing in', () => {
  it('signs in with the email and password, then loads the profile', async () => {
    auth.signInWithPassword.mockResolvedValue(signedIn)
    fetchProfile.mockResolvedValue(sara)
    expect(await signIn('sara.aljuraybah@hawkim.test', 'secret')).toEqual({ ok: true, user: sara })
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'sara.aljuraybah@hawkim.test', password: 'secret' })
    expect(fetchProfile).toHaveBeenCalledWith('uuid-sara')
  })

  it.each([
    ['invalid-credentials', new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')],
    ['too-many-attempts', new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit')],
    ['not-connected', new AuthRetryableFetchError('Failed to fetch', 0)],
    ['no-access', new AuthApiError('User is banned', 400, 'user_banned')],
    ['failed', new AuthApiError('Unexpected failure', 500, 'unexpected_failure')],
  ])('reports %s', async (reason, error) => {
    auth.signInWithPassword.mockResolvedValue(failed(error))
    expect(await signIn('sara.aljuraybah@hawkim.test', 'secret')).toEqual({ ok: false, reason })
    expect(fetchProfile).not.toHaveBeenCalled()
  })

  it('refuses an account without an active profile and signs it out of this browser', async () => {
    auth.signInWithPassword.mockResolvedValue(signedIn)
    fetchProfile.mockResolvedValue(null)
    expect(await signIn('new.person@hawkim.test', 'secret')).toEqual({ ok: false, reason: 'no-access' })
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('reports no connection when the profile can\'t be loaded', async () => {
    auth.signInWithPassword.mockResolvedValue(signedIn)
    fetchProfile.mockRejectedValue(new Error('Failed to fetch'))
    expect(await signIn('sara.aljuraybah@hawkim.test', 'secret')).toEqual({ ok: false, reason: 'not-connected' })
  })
})

describe('restoring the session after a reload', () => {
  it('returns nobody when this tab has no session', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null })
    expect(await restoreSession()).toBeNull()
    expect(fetchProfile).not.toHaveBeenCalled()
  })

  it('returns the person whose session this tab has', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'uuid-sara' } } }, error: null })
    fetchProfile.mockResolvedValue(sara)
    expect(await restoreSession()).toEqual(sara)
  })

  it('ends a session whose profile is no longer active', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'uuid-sara' } } }, error: null })
    fetchProfile.mockResolvedValue(null)
    expect(await restoreSession()).toBeNull()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('keeps the session for the next reload when the server can\'t be reached', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'uuid-sara' } } }, error: null })
    fetchProfile.mockRejectedValue(new Error('Failed to fetch'))
    expect(await restoreSession()).toBeNull()
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})

describe('signing out', () => {
  it('ends the session in this browser only', async () => {
    await signOut()
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})

describe('changing a password by email link', () => {
  const tooMany = new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit')
  const offline = new AuthRetryableFetchError('Failed to fetch', 0)
  const link = '#access_token=access&refresh_token=refresh&type=recovery&expires_in=3600'

  it('asks Supabase to email the link back to Set New Password on this site', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://hawkim.example' } })
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
    expect(await sendPasswordResetEmail('sara@example.test')).toEqual({ ok: true })
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('sara@example.test', { redirectTo: 'https://hawkim.example/reset-password' })
    vi.unstubAllGlobals()
  })

  it.each([
    ['too-many-attempts', tooMany],
    ['not-connected', offline],
    ['failed', new AuthApiError('Unexpected failure', 500, 'unexpected_failure')],
  ])('reports %s when the email fails', async (reason, error) => {
    vi.stubGlobal('window', { location: { origin: 'https://hawkim.example' } })
    auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error })
    expect(await sendPasswordResetEmail('sara@example.test')).toEqual({ ok: false, reason })
    vi.unstubAllGlobals()
  })

  it('reads only a recovery link without an error', () => {
    expect(recoveryTokens(link)).toEqual({ access_token: 'access', refresh_token: 'refresh' })
    expect(recoveryTokens('')).toBeUndefined()
    expect(recoveryTokens('#access_token=access&refresh_token=refresh&type=invite')).toEqual({ access_token: 'access', refresh_token: 'refresh' })
    expect(recoveryTokens('#access_token=access&refresh_token=refresh&type=signup')).toBeUndefined()
    expect(recoveryTokens('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')).toBeUndefined()
  })

  it('starts the session from a valid link, and refuses a bad or rejected one', async () => {
    auth.setSession.mockResolvedValue({ data: { session: {} }, error: null })
    expect(await startPasswordRecovery(link)).toBe(true)
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' })
    auth.setSession.mockClear()
    expect(await startPasswordRecovery('#error_code=otp_expired')).toBe(false)
    expect(auth.setSession).not.toHaveBeenCalled()
    auth.setSession.mockResolvedValue({ data: { session: null }, error: new AuthApiError('Invalid token', 403, 'bad_jwt') })
    expect(await startPasswordRecovery(link)).toBe(false)
  })

  it('saves the new password', async () => {
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
    expect(await setNewPassword('a new password')).toEqual({ ok: true })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'a new password' })
  })

  it.each([
    ['weak-password', new AuthApiError('Password is too weak', 422, 'weak_password')],
    ['same-password', new AuthApiError('Same password', 422, 'same_password')],
    ['expired', new AuthApiError('Session expired', 403, 'session_expired')],
    ['too-many-attempts', tooMany],
    ['not-connected', offline],
    ['failed', new AuthApiError('Unexpected failure', 500, 'unexpected_failure')],
  ])('reports %s when saving fails', async (reason, error) => {
    auth.updateUser.mockResolvedValue({ data: {}, error })
    expect(await setNewPassword('a new password')).toEqual({ ok: false, reason })
  })
})

describe('changing the password', () => {
  const wrong = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')
  const tooMany = new AuthApiError('Email rate limit exceeded', 429, 'over_email_send_rate_limit')
  const offline = new AuthRetryableFetchError('Failed to fetch', 0)
  const session = { user: { id: 'uuid-sara', email: 'sara.aljuraybah@hawkim.test' } }

  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session } })
    checker.signInWithPassword.mockResolvedValue({ data: { user: { id: 'uuid-sara' }, session: {} }, error: null })
    checker.signOut.mockResolvedValue({ error: null })
    auth.updateUser.mockResolvedValue({ data: {}, error: null })
  })

  it('checks the current password on the separate client, then saves the new one on the session', async () => {
    expect(await changePassword('the-current', 'the-new')).toEqual({ ok: true })
    expect(checker.signInWithPassword).toHaveBeenCalledWith({ email: 'sara.aljuraybah@hawkim.test', password: 'the-current' })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: 'the-new' })
    expect(checker.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(auth.updateUser.mock.invocationCallOrder[0])
  })

  it('never signs this tab in or out', async () => {
    await changePassword('the-current', 'the-new')
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('ends the extra session, and only that one', async () => {
    await changePassword('the-current', 'the-new')
    expect(checker.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('still saves if ending the extra session fails', async () => {
    checker.signOut.mockRejectedValue(new Error('offline'))
    expect(await changePassword('the-current', 'the-new')).toEqual({ ok: true })
  })

  it('saves nothing when the current password is wrong', async () => {
    checker.signInWithPassword.mockResolvedValue(failed(wrong))
    expect(await changePassword('a-guess', 'the-new')).toEqual({ ok: false, reason: 'wrong-current' })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it.each([
    ['too-many-attempts', tooMany],
    ['not-connected', offline],
    ['failed', new AuthApiError('Banned', 400, 'user_banned')],
  ])('reports %s and saves nothing when the check fails', async (reason, error) => {
    checker.signInWithPassword.mockResolvedValue(failed(error))
    expect(await changePassword('the-current', 'the-new')).toEqual({ ok: false, reason })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('saves nothing when the check can not reach the server', async () => {
    checker.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await changePassword('the-current', 'the-new')).toEqual({ ok: false, reason: 'not-connected' })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('saves nothing when the check signs in to a different account', async () => {
    checker.signInWithPassword.mockResolvedValue({ data: { user: { id: 'someone-else' }, session: {} }, error: null })
    expect(await changePassword('the-current', 'the-new')).toEqual({ ok: false, reason: 'failed' })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it('reports an ended session without checking anything', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } })
    expect(await changePassword('the-current', 'the-new')).toEqual({ ok: false, reason: 'expired' })
    expect(checker.signInWithPassword).not.toHaveBeenCalled()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it.each([
    ['weak-password', new AuthApiError('Password is too weak', 422, 'weak_password')],
    ['same-password', new AuthApiError('Same password', 422, 'same_password')],
    ['expired', new AuthApiError('Reauthentication needed', 400, 'reauthentication_needed')],
    ['expired', new AuthApiError('Session expired', 403, 'session_expired')],
    ['too-many-attempts', tooMany],
    ['not-connected', offline],
    ['failed', new AuthApiError('Unexpected failure', 500, 'unexpected_failure')],
  ])('reports %s when saving fails after a correct check', async (reason, error) => {
    auth.updateUser.mockResolvedValue({ data: {}, error })
    expect(await changePassword('the-current', 'the-new')).toEqual({ ok: false, reason })
  })
})

describe('marking the account activated (expired-invitation notifications)', () => {
  it('marks it after signing in with a password, and not when signing in fails or there is no access', async () => {
    auth.signInWithPassword.mockResolvedValue(signedIn)
    fetchProfile.mockResolvedValue(sara)
    await signIn('sara.aljuraybah@hawkim.test', 'secret')
    expect(markAccountActivated).toHaveBeenCalledTimes(1)
    markAccountActivated.mockClear()
    fetchProfile.mockResolvedValue(null)
    await signIn('sara.aljuraybah@hawkim.test', 'secret')
    auth.signInWithPassword.mockResolvedValue(failed(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')))
    await signIn('sara.aljuraybah@hawkim.test', 'wrong')
    expect(markAccountActivated).not.toHaveBeenCalled()
  })

  it('marks it after the new password is saved, and not when saving fails', async () => {
    auth.updateUser.mockResolvedValue({ data: { user: {} }, error: null })
    expect(await setNewPassword('a-long-new-password')).toEqual({ ok: true })
    expect(markAccountActivated).toHaveBeenCalledTimes(1)
    markAccountActivated.mockClear()
    auth.updateUser.mockResolvedValue({ data: { user: null }, error: new AuthApiError('Password is too weak', 422, 'weak_password') })
    expect(await setNewPassword('weak')).toEqual({ ok: false, reason: 'weak-password' })
    expect(markAccountActivated).not.toHaveBeenCalled()
  })
})
