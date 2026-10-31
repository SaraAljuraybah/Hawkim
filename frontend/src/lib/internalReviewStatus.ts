import type { InternalReviewDecision, InternalReviewRound, InternalReviewerAssignment, ReviewerAssignment, ReviewerDecision, Sop } from '../data/mock/types'
import { addRiyadhCalendarDays, riyadhDate } from './riyadhWorkingDays'

/*
 * Status and deadline rules for internal review requests, shared by the workflow helpers
 * and the internal review transitions (no imports from either, so both can use them). Pure functions.
 */

/** A review duration is a whole number of days in this range (calendar days now; working days once activated). */
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

/**
 * The last day of the review: the Riyadh date of acceptance plus the duration in calendar days
 * (accepted Oct 25 at 3 PM + 5 days → "Oct 30"), as the approved accept_review does
 * (riyadh_today() + review_duration_days). Independent of the device's time zone.
 */
export function reviewDueDateFrom(acceptedAt: string, days: number): string {
  return addRiyadhCalendarDays(riyadhDate(new Date(acceptedAt)), days)
}

export type RequestDeadline = { phase: 'response' | 'review'; dueAt: string }

/**
 * The deadline that applies to a request: accepting or declining until it's accepted,
 * then finishing the review. Undefined when that deadline wasn't set.
 */
export function requestDeadline(assignment: Pick<InternalReviewerAssignment, 'acceptedAt' | 'responseDueDate' | 'reviewDueDate' | 'responseDueAt' | 'reviewDueAt'>): RequestDeadline | undefined {
  if (assignment.acceptedAt) {
    const dueAt = assignment.reviewDueAt ?? (assignment.reviewDueDate ? endOfLocalDay(assignment.reviewDueDate) : undefined)
    return dueAt ? { phase: 'review', dueAt } : undefined
  }
  const dueAt = assignment.responseDueAt ?? (assignment.responseDueDate ? endOfLocalDay(assignment.responseDueDate) : undefined)
  return dueAt ? { phase: 'response', dueAt } : undefined
}

/** Waiting for the reviewer: to accept or decline (pending), or to decide (accepted). */
export function isOpenDecision(decision: InternalReviewDecision): boolean {
  return decision === 'pending' || decision === 'accepted'
}

/** The reviewer no longer takes part in this round, so they don't count against completing it. */
export function isInactiveDecision(decision: InternalReviewDecision): boolean {
  return decision === 'declined' || decision === 'withdrawn' || decision === 'removed'
}

/**
 * During internal review the author can upload a new version only once everyone taking part has
 * finished reviewing the current one (returned it or completed it), or when nobody is taking part.
 */
export function reviewAllowsNewVersion(sop: Pick<Sop, 'status' | 'internalReviewRounds' | 'reviewFlow'>): boolean {
  const round = sop.internalReviewRounds?.at(-1)
  if (sop.status !== 'in-review' || sop.reviewFlow || !round) return false
  return round.status !== 'open' || activeAssignments(round).length === 0
}

/** The current version was uploaded during internal review and hasn't been sent to any reviewer yet. */
export function isUnsentVersion(sop: Pick<Sop, 'version' | 'internalReviewRounds' | 'reviewFlow'>): boolean {
  const round = sop.internalReviewRounds?.at(-1)
  return !sop.reviewFlow && !!round && round.version !== sop.version
}

/** The request is the reviewer's latest one in the current version's open round, still waiting for them. */
export function isActiveRequest(sop: Pick<Sop, 'status' | 'version' | 'internalReviewRounds'>, request: InternalReviewerAssignment): boolean {
  const round = sop.internalReviewRounds?.at(-1)
  return sop.status === 'in-review' && !!round && round.version === sop.version && round.status === 'open' &&
    round.assignments.includes(request) && latestAssignmentOf(round, request.userId) === request && isOpenDecision(request.decision)
}

/**
 * THE ONLY AUTOMATIC STEP in internal review: a request that is still pending when its
 * response due date has ended (the end of that local day) is withdrawn. Without a response
 * due date it never expires; once accepted, nothing happens automatically.
 * Returns when that happens, or undefined when it can't.
 * TODO: The real withdrawal must run on the backend (a scheduled job), not in the browser.
 */
export function withdrawalDueAt(assignment: Pick<InternalReviewerAssignment, 'decision' | 'responseDueDate' | 'responseDueAt'>): string | undefined {
  return assignment.decision === 'pending' ? assignment.responseDueAt ?? (assignment.responseDueDate ? endOfLocalDay(assignment.responseDueDate) : undefined) : undefined
}

/** Whether the request is due to be withdrawn at `now`. */
export function isWithdrawalDue(assignment: Pick<InternalReviewerAssignment, 'decision' | 'responseDueDate' | 'responseDueAt'>, now: number): boolean {
  const dueAt = withdrawalDueAt(assignment)
  return dueAt !== undefined && new Date(dueAt).getTime() <= now
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
  if (decision === 'declined' || decision === 'withdrawn' || decision === 'removed') return 'cancelled'
  return decision
}

/** `Sop.reviewers` for an internal round: each reviewer's latest request, with a shared-view decision. */
export function projectReviewers(round: InternalReviewRound): (ReviewerAssignment & InternalReviewerAssignment)[] {
  return latestAssignments(round).map((assignment) => ({ ...assignment, decision: legacyDecision(assignment.decision) })) as (ReviewerAssignment & InternalReviewerAssignment)[]
}
