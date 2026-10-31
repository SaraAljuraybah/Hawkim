/*
 * The Supabase client for the browser (sign-in, data and file storage).
 *
 * It uses the project URL and the PUBLISHABLE key from frontend/.env.local
 * (see .env.example). The publishable key is safe in the browser: what each
 * user can read or change is decided by the database's row level security.
 *
 * Security: the secret (service_role) key bypasses row level security and must
 * never be used here or in any VITE_ variable, which ends up in the browser.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Why the client can't be created: no URL or key, a URL that isn't only the project
 * address (e.g. ".../rest/v1/" copied from the Data API page), or the secret key.
 */
export type SupabaseConfigProblem = 'missing' | 'url-format' | 'secret-key'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

/** Set when the app can't connect; App.tsx then shows the "not configured" screen instead. */
export const supabaseConfigProblem = configProblem(url, key)

/** What's wrong with the configured URL and key, if anything. */
export function configProblem(url: string | undefined, key: string | undefined): SupabaseConfigProblem | undefined {
  if (!url || !key) return 'missing'
  if (!isProjectAddress(url)) return 'url-format'
  if (isSecretKey(key)) return 'secret-key'
  return undefined
}

/** Only "https://<project>.supabase.co" (or another origin): no path, not even a trailing "/", no query. */
function isProjectAddress(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && value === parsed.origin
  } catch {
    return false
  }
}

/**
 * The session lives in sessionStorage: one account per browser tab, and it ends when the
 * tab closes. Storage can be unavailable (private mode, blocked); the session then only
 * lasts until reload.
 */
const tabStorage = {
  getItem: (name: string) => {
    try {
      return sessionStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name: string, value: string) => {
    try {
      sessionStorage.setItem(name, value)
    } catch {
      // Without storage the session only lasts until reload.
    }
  },
  removeItem: (name: string) => {
    try {
      sessionStorage.removeItem(name)
    } catch {
      // Nothing was stored.
    }
  },
}

const client = supabaseConfigProblem
  ? undefined
  : createClient(url!, key!, { auth: { storage: tabStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })

/** The client. Only called once the app is configured (App.tsx checks supabaseConfigProblem first). */
export function supabase(): SupabaseClient {
  if (!client) throw new Error('Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend/.env.local')
  return client
}

/** A secret key ("sb_secret_…"), or a legacy key whose role is service_role. */
export function isSecretKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true
  const payload = value.split('.')[1]
  if (!payload) return false
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'
  } catch {
    return false
  }
}
