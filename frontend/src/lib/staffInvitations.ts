import type { Department, User } from '../data/mock/types'
import type { StaffInvitation } from '../services/invitations'
import { staffCompare, type StaffSort } from './userAdmin'

/** Sent Invitations' statuses, and its Filter's choices (`?invitation=sent,expired`). */
export const INVITATION_STATUSES = ['sent', 'expired'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

/** A row of Sent Invitations: the staff member (their details as added) and their invitation. */
export interface InvitationRow {
  user: User
  invitation: StaffInvitation
}

/**
 * Sent: the link still works; Expired: its 24 hours are over. The database's verdict when the list was read,
 * or the clock passing the expiry since (the server checks again on Resend, so an early click is refused).
 */
export function invitationStatus(invitation: StaffInvitation, now: number): InvitationStatus {
  return invitation.expired || now >= Date.parse(invitation.expiresAt) ? 'expired' : 'sent'
}

/** How long a link works (the database's invitation_lifetime, Auth's Email OTP Expiration). */
export const INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000

/** After a successful Resend: Sent again, from the new sending, for another 24 hours. */
export function withResent(list: StaffInvitation[], userId: string, sentAt: string): StaffInvitation[] {
  const expiresAt = new Date(Date.parse(sentAt) + INVITATION_LIFETIME_MS).toISOString()
  return list.map((item) => (item.userId === userId ? { ...item, sentAt, expiresAt, expired: false } : item))
}

/** After a successful Cancel: kept (so the person stays off Active Staff), but no longer on Sent Invitations. */
export function withCancelled(list: StaffInvitation[], userId: string): StaffInvitation[] {
  return list.map((item) => (item.userId === userId ? { ...item, cancelled: true } : item))
}

/** Staff never on Active Staff: their invitation isn't activated (waiting, or cancelled). */
export function invitedIds(invitations: StaffInvitation[]): Set<string> {
  return new Set(invitations.map((invitation) => invitation.userId))
}

/**
 * Sent Invitations' rows: staff (never Admins, never deactivated) whose invitation is waiting (not cancelled),
 * matched with their profile. Invitations of people the list doesn't have are left out.
 */
export function invitationRows(users: User[], invitations: StaffInvitation[]): InvitationRow[] {
  const byId = new Map(users.map((user) => [user.id, user]))
  return invitations.flatMap((invitation) => {
    const user = byId.get(invitation.userId)
    return !invitation.cancelled && user && !user.deletedAt && !user.permissions.includes('admin') ? [{ user, invitation }] : []
  })
}

export interface InvitationFilter {
  /** Searched in the full name and the email, ignoring case. */
  query: string
  /** Selected statuses; none means All Statuses. */
  statuses: InvitationStatus[]
  /** The Staff page's sort; 'default' (or missing): the newest sent first. */
  sort?: StaffSort
}

/** Sent Invitations' rows matching the search and the status Filter, in the sort's order. */
export function filterInvitations(
  rows: InvitationRow[],
  getDepartment: (id: string) => Department | undefined,
  filter: InvitationFilter,
  now: number,
): InvitationRow[] {
  const text = filter.query.trim().toLowerCase()
  const sort = filter.sort ?? 'default'
  const byUser = staffCompare(sort, getDepartment)
  const newestFirst = (a: InvitationRow, b: InvitationRow) =>
    Date.parse(b.invitation.sentAt) - Date.parse(a.invitation.sentAt) || a.user.name.localeCompare(b.user.name)
  return rows
    .filter(({ user, invitation }) =>
      (!text || user.name.toLowerCase().includes(text) || user.email.toLowerCase().includes(text)) &&
      (filter.statuses.length === 0 || filter.statuses.includes(invitationStatus(invitation, now))))
    .sort(sort === 'default' ? newestFirst : (a, b) => byUser(a.user, b.user))
}
