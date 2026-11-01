import type { InternalReviewerAssignment, Sop } from '../data/mock/types'
import { PER_REVIEWER_RESPONSE_ACTIVE } from './internalReviewStatus'
import { responseRecipients } from './workflow'

/** What a reviewer or the main author wrote on a request, with its date. */
export interface ReviewNote {
  kind: 'comment' | 'decline' | 'removal'
  text: string
  date?: string
}

/** The Decision Date column: when the reviewer accepted or declined the request. */
export function requestDecisionDate(request: InternalReviewerAssignment): string | undefined {
  return request.acceptedAt ?? (request.declineReason ? request.decidedAt : undefined)
}

/** The Review Deadline column: the saved due date, which is set on acceptance. */
export function requestReviewDueDate(request: InternalReviewerAssignment): string | undefined {
  return request.acceptedAt ? request.reviewDueDate : undefined
}

/** The request's comments, decline reason and removal reason, oldest first. */
export function reviewNotes(sop: Pick<Sop, 'comments'>, request: InternalReviewerAssignment): ReviewNote[] {
  const comment = sop.comments.find((item) => item.id === request.commentId)
  return [
    ...(request.declineReason ? [{ kind: 'decline' as const, text: request.declineReason, date: request.decidedAt }] : []),
    ...(comment ? [{ kind: 'comment' as const, text: comment.text, date: comment.createdAt }] : []),
    ...(request.removalReason ? [{ kind: 'removal' as const, text: request.removalReason, date: request.removedAt }] : []),
  ]
}

/**
 * Who a response from this request's comments dialog goes to: only its reviewer once
 * PER_REVIEWER_RESPONSE_ACTIVE is on; until then everyone respond_to_comments reaches.
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
