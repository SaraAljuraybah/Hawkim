import type { InternalReviewDecision, InternalReviewRound, InternalReviewerAssignment, ReviewerAssignment, ReviewerDecision } from '../data/mock/types'
import { todayIsoDate } from './format'

/*
 * Status and deadline rules for internal review requests, shared by the workflow helpers
 * and the internal review transitions (no imports from either, so both can use them). Pure functions.
 */

/** A review duration is a whole number of calendar days in this range. */
export const REVIEW_DURATION_MIN = 1
export const REVIEW_DURATION_MAX = 30

/** Whether a review duration is allowed (blank, i.e. undefined, means no review deadline). */
export function isValidReviewDuration(days: number | undefined): boolean {
  return days === undefined || Number.isInteger(days) && days >= REVIEW_DURATION_MIN && days <= REVIEW_DURATION_MAX
}

/** The end of a local calendar day ("2026-10-30" → 23:59:59.999 local time), as an ISO date and time. */
export function endOfLocalDay(isoDate: string): string {
  return new Date(`${isoDate}T23:59:59.999`).toISOString()
}

/** The last day of the review: the local date of acceptance plus the duration (accepted Oct 25 at 3 PM + 5 days → "Oct 30"). */
export function reviewDueDateFrom(acceptedAt: string, days: number): string {
  const accepted = new Date(acceptedAt)
  return todayIsoDate(new Date(accepted.getFullYear(), accepted.getMonth(), accepted.getDate() + days))
}

export type RequestDeadline = { phase: 'response' | 'review'; dueAt: string }

/**
 * The deadline that applies to a request: accepting or declining until it's accepted,
 * then finishing the review. Undefined when that deadline wasn't set.
 */
export function requestDeadline(assignment: Pick<InternalReviewerAssignment, 'acceptedAt' | 'responseDueDate' | 'reviewDueDate'>): RequestDeadline | undefined {
  if (assignment.acceptedAt) return assignment.reviewDueDate ? { phase: 'review', dueAt: endOfLocalDay(assignment.reviewDueDate) } : undefined
  return assignment.responseDueDate ? { phase: 'response', dueAt: endOfLocalDay(assignment.responseDueDate) } : undefined
}

/** Waiting for the reviewer: to accept or decline (pending), or to decide (accepted). */
export function isOpenDecision(decision: InternalReviewDecision): boolean {
  return decision === 'pending' || decision === 'accepted'
}

/** The reviewer no longer takes part in this round. */
export function isInactiveDecision(decision: InternalReviewDecision): boolean {
  return decision === 'declined' || decision === 'cancelled'
}

/** Each reviewer's latest request in the round (a later request replaces an earlier one), in first-sent order. */
export function latestAssignments(round: InternalReviewRound): InternalReviewerAssignment[] {
  const latest = new Map<string, InternalReviewerAssignment>()
  for (const assignment of round.assignments) {
    latest.delete(assignment.userId)
    latest.set(assignment.userId, assignment)
  }
  return [...latest.values()]
}

/** The user's latest request in the round, if any. */
export function latestAssignmentOf(round: InternalReviewRound | undefined, userId: string): InternalReviewerAssignment | undefined {
  return round?.assignments.filter((assignment) => assignment.userId === userId).at(-1)
}

/** Reviewers still taking part: their latest request isn't declined or cancelled. */
export function activeAssignments(round: InternalReviewRound): InternalReviewerAssignment[] {
  return latestAssignments(round).filter((assignment) => !isInactiveDecision(assignment.decision))
}

/** The decision shared views (people list, user administration, legacy helpers) understand. */
export function legacyDecision(decision: InternalReviewDecision): ReviewerDecision {
  if (decision === 'accepted') return 'pending'
  if (decision === 'declined') return 'cancelled'
  return decision
}

/** `Sop.reviewers` for an internal round: each reviewer's latest request, with a shared-view decision. */
export function projectReviewers(round: InternalReviewRound): (ReviewerAssignment & InternalReviewerAssignment)[] {
  return latestAssignments(round).map((assignment) => ({ ...assignment, decision: legacyDecision(assignment.decision) })) as (ReviewerAssignment & InternalReviewerAssignment)[]
}
