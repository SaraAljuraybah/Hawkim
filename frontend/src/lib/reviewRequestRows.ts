import type { InternalReviewerAssignment, InternalReviewRound, Sop, TimelineEvent } from '../data/mock/types'
import { latestAssignmentOf, PER_REVIEWER_RESPONSE_ACTIVE } from './internalReviewStatus'
import { responseRecipients } from './workflow'

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

/** The Review Timeline actions whose note is a reviewer's reason (behind the author page's Preview eye). */
export const REASON_EVENTS = { 'reviewer-removed': 'removal', 'review-declined': 'decline' } as const
export type ReasonEventType = keyof typeof REASON_EVENTS

/**
 * A removal's or decline's reason as the Preview dialog shows it, with whose it is (the reviewer
 * removed, or the one who declined). Undefined for any other action, or one saved without a note.
 */
export function timelineReason(event: TimelineEvent): { type: ReasonEventType; reviewerId: string; note: ReviewNote } | undefined {
  if (!(event.type in REASON_EVENTS) || !event.note) return undefined
  const type = event.type as ReasonEventType
  const reviewerId = (type === 'reviewer-removed' ? event.recipientIds?.[0] : event.actorId) ?? ''
  return { type, reviewerId, note: { kind: REASON_EVENTS[type], text: event.note, date: event.createdAt } }
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

/** The reviewer's review comments for this request (the Reviewers table eye). */
export function reviewNotes(sop: Pick<Sop, 'comments'>, request: InternalReviewerAssignment): ReviewNote[] {
  const comment = sop.comments.find((item) => item.id === request.commentId)
  // Decline and removal reasons open from the Review Timeline's Preview column instead.
  return comment ? [{ kind: 'comment' as const, text: comment.text, date: comment.createdAt }] : []
}

/**
 * Who a response from this request's comments dialog goes to: only its reviewer. With
 * PER_REVIEWER_RESPONSE_ACTIVE off, everyone respond_to_comments reaches without a request.
 */
export function requestResponseRecipients(sop: Sop, request: InternalReviewerAssignment): string[] {
  return PER_REVIEWER_RESPONSE_ACTIVE ? [request.userId] : responseRecipients(sop)
}

/**
 * Whether this request's comments dialog offers Response: its reviewer wrote a comment (returned,
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
