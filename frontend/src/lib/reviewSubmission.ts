import { fixedResponseDueDate } from './fixedResponseDeadline'
import type { InternalReviewOptions } from './internalReview'
import { isValidReviewDuration } from './internalReviewStatus'
import { SUBMIT_COMMENT_MAX } from './workflow'

/** The editor and workflow transitions share the same submission-comment limit. */
export const REVIEW_NOTE_EDITOR_MAX = SUBMIT_COMMENT_MAX
export type ReviewSubmissionError = 'reviewers' | 'duration' | 'note'

/** Form validation only; authorization and all workflow transitions remain in the existing service. */
export function prepareReviewSubmission(
  reviewerIds: string[], eligibleReviewerIds: string[], duration: string, note: string, now = new Date(),
): { error: ReviewSubmissionError } | { options: InternalReviewOptions } {
  if (!reviewerIds.length || new Set(reviewerIds).size !== reviewerIds.length ||
    reviewerIds.some((id) => !eligibleReviewerIds.includes(id))) return { error: 'reviewers' }
  const trimmed = duration.trim()
  const days = !trimmed ? undefined : /^\d+$/.test(trimmed) ? Number(trimmed) : null
  if (days === null || !isValidReviewDuration(days)) return { error: 'duration' }
  if (note.trim().length > SUBMIT_COMMENT_MAX) return { error: 'note' }
  return { options: {
    reviewerIds: [...reviewerIds], responseDueDate: fixedResponseDueDate(now), reviewDurationDays: days,
    note: note.trim() || undefined,
  } }
}
