import type { InternalReviewerAssignment } from '../data/mock/types'
import { isValidReviewDuration, REVIEW_DURATION_CONFIRM_ABOVE, requestDeadline } from './internalReviewStatus'
import { endOfRiyadhDay, reviewWorkingDueDateFrom } from './riyadhWorkingDays'

/** The database refused a change of deadline: this tab was behind (the reviewer finished, say). */
export class ReviewDeadlineUnavailableError extends Error {}

/** Which message explains why a deadline wasn't changed. */
export function reviewDeadlineFailure(error: unknown): 'unavailable' | 'failed' {
  return error instanceof ReviewDeadlineUnavailableError ? 'unavailable' : 'failed'
}

export interface ReviewDeadlinePreview {
  /** Why it can't be used; the dates are left out when the number itself is invalid. */
  problem?: 'invalid' | 'past' | 'unchanged'
  dueDate?: string
  dueAt?: string
  /** Earlier than the current deadline, so the author confirms it. */
  shorter: boolean
  /** Above the number of working days the author confirms. */
  long: boolean
}

/**
 * The review deadline a number of working days gives: counted from the Riyadh date of acceptance
 * (that date not counted), ending at the end of the day in Riyadh, as change_review_deadline does.
 */
export function previewReviewDeadline(
  request: Pick<InternalReviewerAssignment, 'acceptedAt' | 'responseDueDate' | 'responseDueAt' | 'reviewDueDate' | 'reviewDueAt'>,
  duration: string,
  now = new Date(),
): ReviewDeadlinePreview {
  const trimmed = duration.trim()
  const days = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined
  if (days === undefined || !isValidReviewDuration(days) || !request.acceptedAt) return { problem: 'invalid', shorter: false, long: false }
  const dueDate = reviewWorkingDueDateFrom(request.acceptedAt, days)
  const dueAt = endOfRiyadhDay(dueDate)
  const due = new Date(dueAt).getTime()
  const currentAt = requestDeadline(request)?.dueAt
  const current = currentAt ? new Date(currentAt).getTime() : undefined
  const problem = due < now.getTime() ? 'past' : due === current ? 'unchanged' : undefined
  return { ...(problem ? { problem } : {}), dueDate, dueAt, shorter: current !== undefined && due < current, long: days > REVIEW_DURATION_CONFIRM_ABOVE }
}
