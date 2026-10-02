/*
 * Authentication service.
 *
 * DEMO ONLY — replace with real authentication (planned: Supabase Auth,
 * e.g. supabase.auth.signInWithPassword). For now signIn() accepts any
 * valid-looking credentials and returns the sample user, so the signed-in
 * screens can be demonstrated.
 *
 * Security: credentials must never be logged, stored (localStorage,
 * sessionStorage, cookies, etc.) or sent anywhere other than the auth provider.
 */

import { currentUser } from '../data/mock/currentUser'
import type { User } from '../data/mock/types'

/**
 * Why a sign-in attempt did not succeed. The demo never fails; real reasons
 * (e.g. invalid credentials) will be added with the backend.
 */
export type SignInFailureReason = 'not-connected'

export type SignInResult = { ok: true; user: User } | { ok: false; reason: SignInFailureReason }

/** Simulated network delay so the loading state can be seen and tested. */
const STUB_DELAY_MS = 800

/**
 * Signs a user in with email and password.
 * DEMO ONLY: the arguments are intentionally unused (and never logged or stored).
 */
export async function signIn(_email: string, _password: string): Promise<SignInResult> {
  await new Promise((resolve) => setTimeout(resolve, STUB_DELAY_MS))
  return { ok: true, user: currentUser }
}
