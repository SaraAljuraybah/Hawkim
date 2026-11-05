import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '../data/mock/types'
import { recoveryTokens, restoreSession, sendPasswordResetEmail, setNewPassword, signIn, signOut, startPasswordRecovery } from './auth'

const auth = {
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
  resetPasswordForEmail: vi.fn(),
  setSession: vi.fn(),
  updateUser: vi.fn(),
}
const fetchProfile = vi.fn<(id: string) => Promise<User | null>>()

vi.mock('./supabase', () => ({ supabase: () => ({ auth }) }))
vi.mock('./people', () => ({ fetchProfile: (id: string) => fetchProfile(id) }))

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
