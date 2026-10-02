/*
 * Authentication service.
 *
 * TODO: Connect to the backend. The planned provider is Supabase Auth
 * (e.g. supabase.auth.signInWithPassword). Until then, signIn() is a stub
 * that always reports that sign-in is not connected yet.
 *
 * Security: credentials must never be logged, stored (localStorage,
 * sessionStorage, cookies, etc.) or sent anywhere other than the auth provider.
 */

/** Why a sign-in attempt did not succeed. More reasons will be added with the backend. */
export type SignInFailureReason = 'not-connected'

export type SignInResult = { ok: true } | { ok: false; reason: SignInFailureReason }

/** Simulated network delay so the loading state can be seen and tested. */
const STUB_DELAY_MS = 800

/**
 * Signs a user in with email and password.
 * Stub: the arguments are intentionally unused (and never logged or stored).
 */
export async function signIn(_email: string, _password: string): Promise<SignInResult> {
  await new Promise((resolve) => setTimeout(resolve, STUB_DELAY_MS))
  return { ok: false, reason: 'not-connected' }
}
