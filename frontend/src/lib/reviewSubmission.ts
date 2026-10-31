import { WORKING_DAY_DEADLINES_ACTIVE } from './deadlinePolicy'
import { fixedResponseDueDate } from './fixedResponseDeadline'
import type { InternalReviewOptions } from './internalReview'
import { isValidReviewDuration } from './internalReviewStatus'
import { parseResponseDueDate } from './responseTime'
import { SUBMIT_COMMENT_MAX } from './workflow'

/** The editor and workflow transitions share the same submission-comment limit. */
export const REVIEW_NOTE_EDITOR_MAX = SUBMIT_COMMENT_MAX
export type ReviewSubmissionError = 'reviewers' | 'responseDate' | 'duration' | 'note'

/**
 * Form validation only; authorization and all workflow transitions remain in the existing service.
 * `responseDueDate` is the author's optional choice while working-day deadlines are pending
 * activation (lib/deadlinePolicy.ts); once active it is ignored and the fixed date is used.
 */
export function prepareReviewSubmission(
  reviewerIds: string[], eligibleReviewerIds: string[], duration: string, note: string, now = new Date(), responseDueDate = '',
): { error: ReviewSubmissionError } | { options: InternalReviewOptions } {
  if (!reviewerIds.length || new Set(reviewerIds).size !== reviewerIds.length ||
    reviewerIds.some((id) => !eligibleReviewerIds.includes(id))) return { error: 'reviewers' }
  const chosenDate = responseDueDate.trim()
  if (!WORKING_DAY_DEADLINES_ACTIVE && !parseResponseDueDate(chosenDate, now).valid) return { error: 'responseDate' }
  const trimmed = duration.trim()
  const days = !trimmed ? undefined : /^\d+$/.test(trimmed) ? Number(trimmed) : null
  if (days === null || !isValidReviewDuration(days)) return { error: 'duration' }
  if (note.trim().length > SUBMIT_COMMENT_MAX) return { error: 'note' }
  return { options: {
    reviewerIds: [...reviewerIds],
    responseDueDate: WORKING_DAY_DEADLINES_ACTIVE ? fixedResponseDueDate(now) : chosenDate || undefined,
    reviewDurationDays: days,
    note: note.trim() || undefined,
  } }
}
