/*
 * Invitations (migration 20261112130000, Edge Function resend-invitation): marking one's own account
 * activated, the signed-in Admin's expired invitations (bell notifications), and Resend invitation.
 */

import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

/** An invitation whose link expired before the person activated their account. */
export interface ExpiredInvitation {
  userId: string
  name: string
  email: string
  /** Which details page the notification opens. */
  kind: 'staff' | 'admin'
  sentAt: string
  expiredAt: string
}

/** Why Resend invitation didn't send (the Edge Function's error codes). */
export type ResendFailureReason =
  | 'already-activated' | 'still-valid' | 'not-found' | 'no-invitation' | 'account-blocked'
  | 'forbidden' | 'email-failed' | 'failed'

/**
 * After the person saved a password or signed in with one: their invitation is used. Fire and forget:
 * it never delays or fails signing in or saving the password (a later sign-in marks it again).
 */
export function markAccountActivated(): void {
  try {
    void Promise.resolve(supabase().rpc('mark_account_activated')).catch(() => {})
  } catch {
    // Not connected, or not configured: nothing to do.
  }
}

const text = (value: unknown): value is string => typeof value === 'string'

/** The signed-in Admin's expired invitations (only those they are notified of). Throws if they can't be read. */
export async function fetchMyExpiredInvitations(): Promise<ExpiredInvitation[]> {
  const { data, error } = await supabase().rpc('get_my_expired_invitations')
  if (error || !Array.isArray(data)) throw new Error('Expired invitations could not be loaded')
  return data.flatMap((row: Record<string, unknown>) =>
    text(row.user_id) && text(row.name) && text(row.email) && (row.kind === 'staff' || row.kind === 'admin') && text(row.sent_at) && text(row.expired_at)
      ? [{ userId: row.user_id, name: row.name, email: row.email, kind: row.kind, sentAt: row.sent_at, expiredAt: row.expired_at }]
      : [])
}

const REASONS: ResendFailureReason[] = ['already-activated', 'still-valid', 'not-found', 'no-invitation', 'account-blocked', 'forbidden', 'email-failed']

/** Sends the person a new activation link. The email address is the account's, chosen by the server. */
export async function resendInvitation(userId: string): Promise<{ ok: true; email: string } | { ok: false; reason: ResendFailureReason }> {
  try {
    const { data, error } = await supabase().functions.invoke('resend-invitation', { body: { userId } })
    if (!error && text(data?.email)) return { ok: true, email: data.email }
    let code: unknown
    if (error instanceof FunctionsHttpError) code = (await error.context.json().catch(() => null))?.errorCode
    if (code === 'super-admin-required' || code === 'unauthorized') return { ok: false, reason: 'forbidden' }
    if (code === 'link-failed') return { ok: false, reason: 'email-failed' }
    return { ok: false, reason: REASONS.find((reason) => reason === code) ?? 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
