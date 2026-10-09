import type { Sop, TimelineEvent, UserRequest } from '../data/mock/types'
import { mySopPath, reviewPath } from './routes'
import { isAuthorOrCoAuthor } from './workflow'

/*
 * In-app notifications (PBI 31), derived from the data that already exists (SOP
 * timeline events, decisions, due dates and request decisions) instead of stored
 * copies. Only the read state is stored (see state/NotificationsProvider.tsx).
 * Pure functions.
 */

export type NotificationType =
  /** Assigned to me: a reviewer (submitted, resubmitted or routed to them). */
  | 'assigned-review'
  /** Assigned to me: an approver, once every reviewer has completed. */
  | 'assigned-approval'
  /** Assigned to me: an approver, once every approver has approved. */
  | 'ready-to-publish'
  /** My SOP (author and co-authors). */
  | 'sop-returned'
  | 'sop-approved'
  | 'sop-published'
  /** My pending decision in the open stage. */
  | 'due-soon'
  | 'overdue'
  /** My request. */
  | 'request-approved'
  | 'request-rejected'

export interface AppNotification {
  /** Stable: the source (timeline event, due-date round or request) and the recipient. */
  id: string
  type: NotificationType
  /** ISO date and time it happened (for due notifications: when the threshold was crossed). */
  createdAt: string
  /** Where clicking it goes. */
  link: string
  // Parts of the text (the wording comes from the content file).
  sopId?: string
  sopCode?: string
  /** The SOP version the event was about. */
  version?: string
  /** Who acted (submitted, routed, returned). */
  actorId?: string
  /** assigned-review: how it reached them. */
  via?: 'submitted' | 'resubmitted' | 'routed'
  /** due-soon / overdue: the stage, and its due date. */
  stage?: 'review' | 'approval'
  dueAt?: string
  /** Request notifications. */
  request?: Pick<UserRequest, 'title' | 'type' | 'departmentId'>
}

/** Due-soon starts this long before the due date. */
export const DUE_SOON_MS = 24 * 60 * 60 * 1000

/** The notification types that are never counted as read just because they're old. */
export function isDueNotification(type: NotificationType): boolean {
  return type === 'due-soon' || type === 'overdue'
}

function fromEvent(sop: Sop, event: TimelineEvent, userId: string): AppNotification | undefined {
  const base = {
    id: `${event.id}:${userId}`,
    createdAt: event.createdAt,
    sopId: sop.id,
    sopCode: sop.code,
    version: event.version,
    actorId: event.actorId,
  }
  const isRecipient = !!event.recipientIds?.includes(userId) && event.actorId !== userId
  const isWriter = isAuthorOrCoAuthor(sop, userId)
  switch (event.type) {
    case 'submitted':
    case 'resubmitted':
    case 'routed':
      return isRecipient ? { ...base, type: 'assigned-review', via: event.type, link: reviewPath(sop.id) } : undefined
    case 'forwarded-to-approver':
      return isRecipient ? { ...base, type: 'assigned-approval', link: reviewPath(sop.id) } : undefined
    case 'approved':
      // Every approver can now publish; the author and co-authors learn it was approved.
      if (sop.approvers.some((person) => person.userId === userId)) {
        return { ...base, type: 'ready-to-publish', link: reviewPath(sop.id) }
      }
      return isWriter ? { ...base, type: 'sop-approved', link: mySopPath(sop.id) } : undefined
    case 'returned':
      return isRecipient ? { ...base, type: 'sop-returned', link: mySopPath(sop.id) } : undefined
    case 'published':
      return isWriter && event.actorId !== userId ? { ...base, type: 'sop-published', link: mySopPath(sop.id) } : undefined
    default:
      return undefined
  }
}

/**
 * "Due soon" (within 24 hours) or "overdue" for a user with a pending decision in the
 * SOP's open stage, when that stage has a due date. One of each per person per stage
 * round: the round is the stage's latest "due date set" event, so a resubmission
 * (a new round) can notify again, while moving the clock doesn't duplicate it.
 * Once overdue, the due-soon notification is no longer listed.
 */
function dueNotification(sop: Sop, userId: string, now: number): AppNotification | undefined {
  const stage = sop.status === 'in-review' ? 'review' : sop.status === 'in-approval' ? 'approval' : undefined
  if (!stage) return undefined
  const people = stage === 'review' ? sop.reviewers : sop.approvers
  if (!people.some((person) => person.userId === userId && person.decision === 'pending')) return undefined
  const dueAt = stage === 'review' ? sop.reviewDueAt : sop.approvalDueAt
  if (!dueAt) return undefined
  const due = new Date(dueAt).getTime()
  const round =
    [...sop.timeline].reverse().find((event) => event.type === 'stage-due-date-set' && event.stage === stage)?.id ??
    `${sop.id}-${stage}-${sop.version}`
  const base = { sopId: sop.id, sopCode: sop.code, version: sop.version, stage, dueAt, link: reviewPath(sop.id) } as const
  if (now >= due) return { ...base, id: `overdue:${round}:${userId}`, type: 'overdue', createdAt: dueAt }
  if (due - now <= DUE_SOON_MS) {
    return { ...base, id: `due-soon:${round}:${userId}`, type: 'due-soon', createdAt: new Date(due - DUE_SOON_MS).toISOString() }
  }
  return undefined
}

/** Every notification for the user, newest first. */
export function deriveNotifications(
  userId: string,
  { sops, requests, now }: { sops: Sop[]; requests: UserRequest[]; now: number },
): AppNotification[] {
  const notifications: AppNotification[] = []
  for (const sop of sops) {
    for (const event of sop.timeline) {
      const notification = fromEvent(sop, event, userId)
      if (notification) notifications.push(notification)
    }
    const due = dueNotification(sop, userId, now)
    if (due) notifications.push(due)
  }
  for (const request of requests) {
    if (request.requesterId !== userId || !request.decidedAt) continue
    if (request.status !== 'approved' && request.status !== 'rejected') continue
    notifications.push({
      id: `${request.id}:${request.status}:${userId}`,
      type: request.status === 'approved' ? 'request-approved' : 'request-rejected',
      createdAt: request.decidedAt,
      link: '/requests',
      request: { title: request.title, type: request.type, departmentId: request.departmentId },
    })
  }
  // Newest first. ISO dates with different offsets don't sort as strings, so compare
  // times; at the same moment, the later one in timeline order counts as newer.
  return notifications
    .map((notification, index) => ({ notification, index, time: new Date(notification.createdAt).getTime() }))
    .sort((a, b) => b.time - a.time || b.index - a.index)
    .map((item) => item.notification)
}

/**
 * Read: opened or marked as read, or it happened before this app session started
 * (the sample history), except due-soon and overdue, which stay unread until opened.
 */
export function isRead(notification: AppNotification, readIds: ReadonlySet<string>, sessionStartedAt: number): boolean {
  if (readIds.has(notification.id)) return true
  return !isDueNotification(notification.type) && new Date(notification.createdAt).getTime() < sessionStartedAt
}
