/*
 * Authentication with Supabase Auth (email and password). Accounts are created by
 * the project owner in the Supabase dashboard; a person can use Hawkim only when
 * they also have an active profile (see services/people.ts).
 *
 * Security: credentials must never be logged, stored (localStorage,
 * sessionStorage, cookies, etc.) or sent anywhere other than the auth provider.
 * Supabase keeps only its session tokens, in sessionStorage (see services/supabase.ts).
 */

import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError, type AuthError } from '@supabase/supabase-js'
import type { User } from '../data/mock/types'
import { RESET_PASSWORD_PATH } from '../lib/routes'
import { fetchProfile } from './people'
import { passwordCheckClient, supabase } from './supabase'

/**
 * Why a sign-in attempt did not succeed:
 * - invalid-credentials: wrong email or password;
 * - too-many-attempts: Supabase is limiting attempts for now;
 * - not-connected: the server couldn't be reached;
 * - no-access: the account has no active profile (none was set up, or it was ended);
 * - failed: anything else.
 */
export type SignInFailureReason = 'invalid-credentials' | 'too-many-attempts' | 'not-connected' | 'no-access' | 'failed'

export type SignInResult = { ok: true; user: User } | { ok: false; reason: SignInFailureReason }

/** Signs a user in with email and password, then loads their profile. Without an active profile they're signed out again. */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  let user: User | null
  try {
    const { data, error } = await supabase().auth.signInWithPassword({ email, password })
    if (error) return { ok: false, reason: failureReason(error) }
    user = await fetchProfile(data.user.id)
  } catch {
    return { ok: false, reason: 'not-connected' }
  }
  if (!user) {
    await signOut()
    return { ok: false, reason: 'no-access' }
  }
  return { ok: true, user }
}

/**
 * The person whose session this tab already has (after a reload), or null. A session
 * without an active profile is ended. If the server can't be reached, the session is
 * kept for the next reload and nobody is signed in for now.
 */
export async function restoreSession(): Promise<User | null> {
  try {
    const { data } = await supabase().auth.getSession()
    const userId = data.session?.user.id
    if (!userId) return null
    const user = await fetchProfile(userId)
    if (!user) await signOut()
    return user
  } catch {
    return null
  }
}

/** Ends the session in this browser only (other devices stay signed in). */
export async function signOut(): Promise<void> {
  try {
    await supabase().auth.signOut({ scope: 'local' })
  } catch {
    // The local session is removed even when the server can't be reached.
  }
}

/** Calls `callback` whenever the session ends (signed out, or it could no longer be refreshed). Returns an unsubscribe function. */
export function onSignedOut(callback: () => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback()
  })
  return () => data.subscription.unsubscribe()
}

/** Why the password email could not be sent. */
export type PasswordEmailFailureReason = 'too-many-attempts' | 'not-connected' | 'failed'

/** Sends the Supabase password reset email; its link opens Set New Password on this site. */
export async function sendPasswordResetEmail(email: string): Promise<{ ok: true } | { ok: false; reason: PasswordEmailFailureReason }> {
  try {
    const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}` })
    if (!error) return { ok: true }
    return { ok: false, reason: limitOrConnection(error) ?? 'failed' }
  } catch {
    return { ok: false, reason: 'not-connected' }
  }
}

/** The session tokens in a recovery link's address hash, if it is one and it has no error. */
export function recoveryTokens(hash: string): { access_token: string; refresh_token: string } | undefined {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const access_token = params.get('access_token')
  const refresh_token = params.get('refresh_token')
  // 'recovery': the password reset email; 'invite': a new account's first password (accepted Request Hawkim).
  const type = params.get('type')
  if (params.get('error') || params.get('error_code') || (type !== 'recovery' && type !== 'invite') || !access_token || !refresh_token) return undefined
  return { access_token, refresh_token }
}

/**
 * Starts the recovery session from a link's address hash. Returns false when the link is
 * missing, invalid or expired. Links stay in the implicit flow on purpose: the email opens a new
 * tab, and a PKCE verifier saved in this tab's sessionStorage wouldn't be there.
 */
export async function startPasswordRecovery(hash: string): Promise<boolean> {
  const tokens = recoveryTokens(hash)
  if (!tokens) return false
  try {
    const { data, error } = await supabase().auth.setSession(tokens)
    return !error && !!data.session
  } catch {
    return false
  }
}

/** Why a new password could not be saved. 'expired': the recovery session is gone. */
export type NewPasswordFailureReason = PasswordEmailFailureReason | 'weak-password' | 'same-password' | 'expired'

/** Saves the new password for the recovery session's account. */
export async function setNewPassword(password: string): Promise<{ ok: true } | { ok: false; reason: NewPasswordFailureReason }> {
  try {
    const { error } = await supabase().auth.updateUser({ password })
    if (!error) return { ok: true }
    if (error.code === 'weak_password') return { ok: false, reason: 'weak-password' }
    if (error.code === 'same_password') return { ok: false, reason: 'same-password' }
    // reauthentication_needed: the project requires a recent sign-in to change a password.
    if (isAuthSessionMissingError(error) || error.status === 401 || error.status === 403 || error.code === 'reauthentication_needed') return { ok: false, reason: 'expired' }
    return { ok: false, reason: limitOrConnection(error) ?? 'failed' }
  } catch {
    return { ok: false, reason: 'not-connected' }
  }
}

/** Why Change Password didn't save. 'wrong-current': the current password typed isn't the account's. */
export type ChangePasswordFailureReason = NewPasswordFailureReason | 'wrong-current'

/**
 * Changes the signed-in person's password, only after Supabase Auth confirms the current password they
 * typed is theirs. The check signs in on a separate client (see passwordCheckClient), so this tab's
 * session isn't touched and that extra session is ended straight away. Guessing is limited by Auth's
 * sign-in rate limit. A failed check saves nothing.
 */
export async function changePassword(current: string, next: string): Promise<{ ok: true } | { ok: false; reason: ChangePasswordFailureReason }> {
  try {
    const { data: { session } } = await supabase().auth.getSession()
    if (!session?.user.email) return { ok: false, reason: 'expired' }
    const checker = passwordCheckClient().auth
    const { data, error } = await checker.signInWithPassword({ email: session.user.email, password: current })
    if (error) {
      if (error.code === 'invalid_credentials') return { ok: false, reason: 'wrong-current' }
      return { ok: false, reason: limitOrConnection(error) ?? 'failed' }
    }
    // Only this account's password counts.
    if (data.user?.id !== session.user.id) return { ok: false, reason: 'failed' }
    await checker.signOut({ scope: 'local' }).catch(() => {
      // It expires by itself, and only this client knows it.
    })
  } catch {
    return { ok: false, reason: 'not-connected' }
  }
  return setNewPassword(next)
}

function limitOrConnection(error: AuthError): 'too-many-attempts' | 'not-connected' | undefined {
  if (isAuthRetryableFetchError(error)) return 'not-connected'
  if (error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit') return 'too-many-attempts'
  return undefined
}

function failureReason(error: AuthError): SignInFailureReason {
  if (isAuthRetryableFetchError(error)) return 'not-connected'
  if (error.code === 'invalid_credentials') return 'invalid-credentials'
  if (error.status === 429 || error.code === 'over_request_rate_limit') return 'too-many-attempts'
  if (isAuthApiError(error) && (error.code === 'user_banned' || error.code === 'email_not_confirmed')) return 'no-access'
  return 'failed'
}
