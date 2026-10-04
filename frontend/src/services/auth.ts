/*
 * Authentication service.
 *
 * DEMO ONLY — replace with real authentication (planned: Supabase Auth,
 * e.g. supabase.auth.signInWithPassword). For now signIn() signs in as the
 * sample user with that email (any password), or as Sara for any other
 * valid-looking email, so the signed-in screens can be demonstrated.
 *
 * Security: credentials must never be logged, stored (localStorage,
 * sessionStorage, cookies, etc.) or sent anywhere other than the auth provider.
 */

import type { User } from '../data/mock/types'

/**
 * Why a sign-in attempt did not succeed:
 * - no-access: the account was deleted by an admin.
 * Real reasons (e.g. invalid credentials) will be added with the backend.
 */
export type SignInFailureReason = 'not-connected' | 'no-access'

export type SignInResult = { ok: true; user: User } | { ok: false; reason: SignInFailureReason }

/** Simulated network delay so the loading state can be seen and tested. */
const STUB_DELAY_MS = 800

/**
 * Signs a user in with email and password.
 * DEMO ONLY: `accounts` are the sample users from the users store (the real auth
 * provider looks accounts up itself). The password is intentionally unused (and
 * never logged or stored). The email is matched ignoring case; a deleted account
 * is refused; any other email signs in as the first sample user (Sara).
 */
export async function signIn(email: string, _password: string, accounts: User[]): Promise<SignInResult> {
  await new Promise((resolve) => setTimeout(resolve, STUB_DELAY_MS))
  const address = email.toLowerCase()
  const matches = accounts.filter((account) => account.email.toLowerCase() === address)
  const active = matches.find((account) => !account.deletedAt)
  if (active) return { ok: true, user: active }
  if (matches.length > 0) return { ok: false, reason: 'no-access' }
  const fallback = accounts[0]
  return fallback && !fallback.deletedAt ? { ok: true, user: fallback } : { ok: false, reason: 'no-access' }
}
