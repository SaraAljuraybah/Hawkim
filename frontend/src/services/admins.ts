/*
 * Manage Organization → Admins on the server. Who the Super Admin is, Edit Admin (name and phone),
 * Delete Admin and Make Super Admin are database functions (supabase/migrations/
 * 20261111120000_super_admin.sql) that check the caller, the target and the current Super Admin
 * themselves; the browser's checks only decide what is shown. Add Admin is the add-user Edge Function
 * with the Admin permission (services/people.ts addUserAccount), and an email change is the
 * update-user-email Edge Function (changeUserEmail), so the sign-in account changes with the profile.
 */

import type { AdminActionFailure } from '../content/types'
import { supabase } from './supabase'

export class AdminActionError extends Error {
  readonly reason: AdminActionFailure
  constructor(reason: AdminActionFailure) {
    super(`The administrator action was refused (${reason})`)
    this.reason = reason
  }
}

const HINTS: AdminActionFailure[] = ['invalid', 'super-admin-required', 'super-admin-protected', 'recipient-not-admin', 'recipient-self']

/** A database refusal as an AdminActionError: the hint when there is one, else the error code. */
export function adminActionError(error: { code?: string; hint?: string | null }): AdminActionError {
  const hinted = HINTS.find((reason) => reason === error.hint)
  if (hinted) return new AdminActionError(hinted)
  // PGRST30x: the session's token has expired or isn't valid.
  if (error.code === '42501' || error.code?.startsWith('PGRST30')) return new AdminActionError('forbidden')
  if (error.code === 'P0002') return new AdminActionError('not-found')
  if (error.code === '23514') return new AdminActionError('invalid')
  return new AdminActionError('failed')
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let response
  try {
    response = await supabase().rpc(name, args)
  } catch {
    throw new AdminActionError('failed')
  }
  if (response.error) throw adminActionError(response.error)
  return response.data as T
}

/** The current Super Admin's id, or null when none is assigned yet. Throws if it can't be read. */
export async function fetchSuperAdminId(): Promise<string | null> {
  const id = await call<unknown>('get_super_admin_id', {})
  if (id !== null && typeof id !== 'string') throw new AdminActionError('failed')
  return id
}

/** Saves an administrator's name and phone ("+9665XXXXXXXX"); their role never changes. */
export async function updateAdminDetails(userId: string, name: string, phone: string): Promise<{ name: string; initials: string; phone: string }> {
  const saved = await call<{ name?: unknown; initials?: unknown; phone?: unknown } | null>('update_admin', {
    p_user_id: userId, p_full_name: name, p_phone: phone,
  })
  if (typeof saved?.name !== 'string' || typeof saved.initials !== 'string' || typeof saved.phone !== 'string') {
    throw new AdminActionError('failed')
  }
  return { name: saved.name, initials: saved.initials, phone: saved.phone }
}

/** Deletes a regular Admin (Super Admin only): they can no longer sign in; their name stays on history. */
export async function deleteAdminAccount(userId: string): Promise<void> {
  await call<null>('delete_admin', { p_user_id: userId })
}

/** Makes another Admin the Super Admin; the caller becomes a regular Admin. Returns the new Super Admin's id. */
export async function transferSuperAdmin(recipientId: string): Promise<string> {
  const id = await call<unknown>('transfer_super_admin', { p_recipient: recipientId })
  if (typeof id !== 'string') throw new AdminActionError('failed')
  return id
}
