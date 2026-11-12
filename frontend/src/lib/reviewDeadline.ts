import type { InternalReviewerAssignment } from '../data/mock/types'
import { fixedResponseDueDate } from './fixedResponseDeadline'
import { isValidReviewDuration, REVIEW_DURATION_CONFIRM_ABOVE, requestDeadline } from './internalReviewStatus'
import { addRiyadhCalendarDays, addRiyadhWorkingDays, endOfRiyadhDay, reviewWorkingDueDateFrom, WORKING_DAY_POLICY } from './riyadhWorkingDays'

/** The database refused a change of deadline: this tab was behind (the reviewer finished, say). */
export class ReviewDeadlineUnavailableError extends Error {}

/** Which message explains why a deadline wasn't changed. */
export function reviewDeadlineFailure(error: unknown): 'unavailable' | 'failed' {
  return error instanceof ReviewDeadlineUnavailableError ? 'unavailable' : 'failed'
}

/** A typed review duration as a valid number of days, or undefined while it is blank or invalid. */
function durationDays(duration: string): number | undefined {
  const trimmed = duration.trim()
  const days = /^\d+$/.test(trimmed) ? Number(trimmed) : undefined
  return days !== undefined && isValidReviewDuration(days) ? days : undefined
}

/**
 * Submit for Review's latest possible due date: the reviewer accepts on the last day of the fixed
 * response window (lib/fixedResponseDeadline.ts), then has the duration, counted as accept_review
 * will (working days from the Riyadh date of acceptance, that date not counted; calendar days with
 * the working-day policy off). A reviewer can't accept later: the request expires. Undefined while
 * the duration is blank or invalid.
 */
export function latestReviewDueDate(duration: string, now = new Date(), workingDays = true): string | undefined {
  const days = durationDays(duration)
  if (days === undefined) return undefined
  const lastDayToAccept = fixedResponseDueDate(now)
  return workingDays ? addRiyadhWorkingDays(lastDayToAccept, days) : addRiyadhCalendarDays(lastDayToAccept, days)
}

export interface PendingDurationPreview {
  /** Why it can't be used. */
  problem?: 'invalid' | 'unchanged'
  /** The latest the review can be due: the reviewer accepts on the last day of their response window. */
  latestDueDate?: string
  /** Above the number of working days the author confirms. */
  long: boolean
}

/**
 * A pending request's new review duration: it starts when the reviewer accepts, so there is no
 * deadline yet, only the latest it can be (accepted on the last day to accept), counted as
 * accept_review will. The same duration under the working-day policy is no change.
 */
export function previewPendingDuration(request: Pick<InternalReviewerAssignment, 'responseDueDate' | 'reviewDurationDays' | 'deadlinePolicy'>, duration: string): PendingDurationPreview {
  const days = durationDays(duration)
  if (days === undefined) return { problem: 'invalid', long: false }
  const latestDueDate = request.responseDueDate ? addRiyadhWorkingDays(request.responseDueDate, days) : undefined
  const unchanged = days === request.reviewDurationDays && request.deadlinePolicy === WORKING_DAY_POLICY
  return { ...(unchanged ? { problem: 'unchanged' as const } : {}), ...(latestDueDate ? { latestDueDate } : {}), long: days > REVIEW_DURATION_CONFIRM_ABOVE }
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
  const days = durationDays(duration)
  if (days === undefined || !request.acceptedAt) return { problem: 'invalid', shorter: false, long: false }
  const dueDate = reviewWorkingDueDateFrom(request.acceptedAt, days)
  const dueAt = endOfRiyadhDay(dueDate)
  const due = new Date(dueAt).getTime()
  const currentAt = requestDeadline(request)?.dueAt
  const current = currentAt ? new Date(currentAt).getTime() : undefined
  const problem = due < now.getTime() ? 'past' : due === current ? 'unchanged' : undefined
  return { ...(problem ? { problem } : {}), dueDate, dueAt, shorter: current !== undefined && due < current, long: days > REVIEW_DURATION_CONFIRM_ABOVE }
}
