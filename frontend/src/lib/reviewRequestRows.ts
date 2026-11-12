import type { InternalReviewerAssignment, InternalReviewRound, Sop, TimelineEvent } from '../data/mock/types'
import { latestAssignmentOf, PER_REVIEWER_RESPONSE_ACTIVE } from './internalReviewStatus'
import { commentForEvent, responseRecipients } from './workflow'

/** The database refused a response to this request: another tab removed the reviewer, say (this tab didn't know yet). */
export class ResponseNotAvailableError extends Error {}

/** Which message explains why a response wasn't sent. */
export function responseFailure(error: unknown): 'unavailable' | 'failed' {
  return error instanceof ResponseNotAvailableError ? 'unavailable' : 'failed'
}

/** What a reviewer or the main author wrote on a request, with its date. */
export interface ReviewNote {
  kind: 'comment' | 'decline' | 'removal'
  text: string
  date?: string
}

/**
 * The Review Timeline actions whose note opens from the author page's Preview eye: a removal's or
 * decline's reason, and a completed or returned review's comments.
 */
export const NOTE_EVENTS = {
  'reviewer-removed': 'removal', 'review-declined': 'decline', 'review-completed': 'comment', 'review-changes-requested': 'comment',
} as const
export type NoteEventType = keyof typeof NOTE_EVENTS

export interface TimelineNote {
  type: NoteEventType
  /** Whose it is: the reviewer removed, or the one who declined, completed or returned it. */
  reviewerId: string
  note: ReviewNote
  /** The review request it belongs to, when the event names one (for Response). */
  request?: InternalReviewerAssignment
}

/**
 * The note an action's Preview dialog shows. Undefined for any other action, or one with nothing
 * to show (a removal or decline saved without a reason, a review completed without comments).
 */
export function timelineNote(sop: Pick<Sop, 'comments' | 'internalReviewRounds'>, event: TimelineEvent): TimelineNote | undefined {
  if (!(event.type in NOTE_EVENTS)) return undefined
  const type = event.type as NoteEventType
  const kind = NOTE_EVENTS[type]
  const comment = kind === 'comment' ? commentForEvent(sop as Sop, event) : undefined
  const text = kind === 'comment' ? comment?.text : event.note
  if (!text) return undefined
  const reviewerId = (type === 'reviewer-removed' ? event.recipientIds?.[0] : event.actorId) ?? ''
  const request = event.reviewAssignmentId
    ? sop.internalReviewRounds?.flatMap((round) => round.assignments).find((item) => item.id === event.reviewAssignmentId)
    : undefined
  return { type, reviewerId, note: { kind, text, date: comment?.createdAt ?? event.createdAt }, ...(request ? { request } : {}) }
}

/**
 * The rows of a version's table: every request, except an expired one the reviewer has a newer
 * request after (Send Again). Declined and removed rows stay, for their reasons and comments.
 * Display only: the requests themselves don't change.
 */
export function visibleReviewRequests(round: InternalReviewRound): InternalReviewerAssignment[] {
  return round.assignments.filter((request) => request.decision !== 'expired' || latestAssignmentOf(round, request.userId) === request)
}

/** The Response Date column: when the reviewer accepted or declined the request. */
export function requestResponseDate(request: InternalReviewerAssignment): string | undefined {
  return request.acceptedAt ?? (request.declineReason ? request.decidedAt : undefined)
}

/** The Review Deadline column: the saved due date, which is set on acceptance. */
export function requestReviewDueDate(request: InternalReviewerAssignment): string | undefined {
  return request.acceptedAt ? request.reviewDueDate : undefined
}

/**
 * Who a response from this request's comments dialog goes to: only its reviewer. With
 * PER_REVIEWER_RESPONSE_ACTIVE off, everyone respond_to_comments reaches without a request.
 */
export function requestResponseRecipients(sop: Sop, request: InternalReviewerAssignment): string[] {
  return PER_REVIEWER_RESPONSE_ACTIVE ? [request.userId] : responseRecipients(sop)
}

/**
 * Whether a review comment's dialog (the Review Timeline's Preview) offers Response: its reviewer wrote a comment (returned,
 * or completed with one) and wasn't removed, the SOP isn't published, and the reviewer would
 * receive the response. Only the author and co-authors reach this dialog.
 */
export function canRespondToRequest(sop: Sop, request: InternalReviewerAssignment): boolean {
  return sop.status !== 'published' && request.decision !== 'removed' &&
    sop.comments.some((comment) => comment.id === request.commentId) &&
    requestResponseRecipients(sop, request).includes(request.userId)
}

/** Someone to respond to who isn't on a reviewer row: an approver, or a legacy SOP without review rounds. */
export function hasResponseOutsideReviewers(sop: Sop): boolean {
  const reviewerIds = new Set(sop.internalReviewRounds?.flatMap((round) => round.assignments.map((request) => request.userId)))
  return responseRecipients(sop).some((id) => !reviewerIds.has(id))
}
