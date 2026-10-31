import type { InternalReviewerAssignment, Sop } from '../data/mock/types'

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
