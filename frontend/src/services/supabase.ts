/*
 * The Supabase client for the browser (sign-in, data and file storage).
 *
 * It uses the project URL and the PUBLISHABLE key from frontend/.env.local
 * (see .env.example). The publishable key is safe in the browser: what each
 * user can read or change is decided by the database's row level security.
 *
 * Security: the secret (service_role) key bypasses row level security and must
 * never be used here or in any VITE_ variable, which ends up in the browser.
 *
 * Not used by any screen yet; the stores move to it feature by feature.
 */

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

if (!url || !key) {
  throw new Error('Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in frontend/.env.local')
}
if (isSecretKey(key)) {
  throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must be the publishable key, never the secret (service_role) key')
}

export const supabase = createClient(url, key)

/** A secret key ("sb_secret_…"), or a legacy key whose role is service_role. */
function isSecretKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true
  const payload = value.split('.')[1]
  if (!payload) return false
  try {
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'
  } catch {
    return false
  }
}
