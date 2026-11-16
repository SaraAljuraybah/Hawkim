/*
 * Invitations (migrations 20261112130000 and 20261122120000, Edge Functions resend-invitation and
 * cancel-invitation): marking one's own account activated, the signed-in Admin's expired invitations (bell
 * notifications), the Staff page's Sent Invitations, Resend and Cancel invitation, and what became of a link.
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
  | 'cancelled' | 'forbidden' | 'email-failed' | 'failed'

/**
 * A staff member's invitation that isn't activated (get_staff_invitations): still waiting (shown on Sent
 * Invitations) or cancelled (shown on no Staff tab). `expired` is the database's verdict when it was read.
 */
export interface StaffInvitation {
  userId: string
  sentAt: string
  expiresAt: string
  expired: boolean
  cancelled: boolean
}

/** Why Cancel invitation didn't cancel (the Edge Function's error codes). */
export type CancelInvitationFailure =
  | 'already-activated' | 'not-found' | 'no-invitation' | 'admin-managed-separately' | 'forbidden' | 'cancel-failed' | 'failed'

/** What became of an invitation link (invitation_link_state). 'unknown': not an invitation's, or not known. */
export type InvitationLinkState = 'cancelled' | 'replaced' | 'expired' | 'used' | 'valid' | 'unknown'

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

/**
 * After the person saved their password from an invitation link: their invitation is used, so they move
 * from Sent Invitations to Active Staff. Waited for, and tried twice; never throws (if it still fails,
 * their next sign-in with the password marks it).
 */
export async function confirmAccountActivated(): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await supabase().rpc('mark_account_activated')
      if (!error) return
    } catch {
      // Not connected, or not configured: try once more, then leave it to the next sign-in.
    }
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

const REASONS: ResendFailureReason[] = ['already-activated', 'still-valid', 'not-found', 'no-invitation', 'account-blocked', 'cancelled', 'forbidden', 'email-failed']

/**
 * Sends the person a new activation link. The email address is the account's, chosen by the server.
 * `sentAt`: when the new link was recorded as sent (its 24 hours start then), when the server says.
 */
export async function resendInvitation(userId: string): Promise<{ ok: true; email: string; sentAt?: string } | { ok: false; reason: ResendFailureReason }> {
  try {
    const { data, error } = await supabase().functions.invoke('resend-invitation', { body: { userId } })
    if (!error && text(data?.email)) return { ok: true, email: data.email, ...(text(data?.sentAt) ? { sentAt: data.sentAt } : {}) }
    let code: unknown
    if (error instanceof FunctionsHttpError) code = (await error.context.json().catch(() => null))?.errorCode
    if (code === 'super-admin-required' || code === 'unauthorized') return { ok: false, reason: 'forbidden' }
    if (code === 'link-failed') return { ok: false, reason: 'email-failed' }
    return { ok: false, reason: REASONS.find((reason) => reason === code) ?? 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

/** The signed-in Admin's organization's staff invitations that aren't activated. Throws if they can't be read. */
export async function fetchStaffInvitations(): Promise<StaffInvitation[]> {
  const { data, error } = await supabase().rpc('get_staff_invitations')
  if (error || !Array.isArray(data)) throw new Error('Staff invitations could not be loaded')
  return data.flatMap((row: Record<string, unknown>) =>
    text(row.user_id) && text(row.sent_at) && text(row.expires_at) && typeof row.expired === 'boolean' && typeof row.cancelled === 'boolean'
      ? [{ userId: row.user_id, sentAt: row.sent_at, expiresAt: row.expires_at, expired: row.expired, cancelled: row.cancelled }]
      : [])
}

const CANCEL_REASONS: CancelInvitationFailure[] = ['already-activated', 'not-found', 'no-invitation', 'admin-managed-separately', 'forbidden', 'cancel-failed']

/**
 * Cancels a staff member's invitation: its link stops working and they can't sign in, while their staff
 * profile and details are kept (they aren't deactivated). A repeated request succeeds.
 */
export async function cancelInvitation(userId: string): Promise<{ ok: true } | { ok: false; reason: CancelInvitationFailure }> {
  try {
    const { data, error } = await supabase().functions.invoke('cancel-invitation', { body: { userId } })
    if (!error && text(data?.cancelledAt)) return { ok: true }
    let code: unknown
    if (error instanceof FunctionsHttpError) code = (await error.context.json().catch(() => null))?.errorCode
    if (code === 'unauthorized') return { ok: false, reason: 'forbidden' }
    return { ok: false, reason: CANCEL_REASONS.find((reason) => reason === code) ?? 'failed' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

const LINK_STATES: InvitationLinkState[] = ['cancelled', 'replaced', 'expired', 'used', 'valid']
const LINK_REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** What became of the invitation whose link carried this reference (`?invitation=`); 'unknown' if it can't be told. */
export async function fetchInvitationLinkState(linkRef: string): Promise<InvitationLinkState> {
  if (!LINK_REF.test(linkRef)) return 'unknown'
  try {
    // Through the public invitation-link-state Edge Function: signed out, the page reaches no database function.
    const { data, error } = await supabase().functions.invoke('invitation-link-state', { body: { linkRef } })
    if (error) return 'unknown'
    return LINK_STATES.find((state) => state === data?.state) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}
