/*
 * Authentication with Supabase Auth (email and password). Accounts are created by
 * the project owner in the Supabase dashboard; a person can use Hawkim only when
 * they also have an active profile (see services/people.ts).
 *
 * Security: credentials must never be logged, stored (localStorage,
 * sessionStorage, cookies, etc.) or sent anywhere other than the auth provider.
 * Supabase keeps only its session tokens, in sessionStorage (see services/supabase.ts).
 */

import { isAuthApiError, isAuthRetryableFetchError, type AuthError } from '@supabase/supabase-js'
import type { User } from '../data/mock/types'
import { fetchProfile } from './people'
import { supabase } from './supabase'

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

function failureReason(error: AuthError): SignInFailureReason {
  if (isAuthRetryableFetchError(error)) return 'not-connected'
  if (error.code === 'invalid_credentials') return 'invalid-credentials'
  if (error.status === 429 || error.code === 'over_request_rate_limit') return 'too-many-attempts'
  if (isAuthApiError(error) && (error.code === 'user_banned' || error.code === 'email_not_confirmed')) return 'no-access'
  return 'failed'
}
