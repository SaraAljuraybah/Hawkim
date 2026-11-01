import type { InternalReviewDecision, InternalReviewRound, InternalReviewerAssignment, ReviewerAssignment, ReviewerDecision, Sop } from '../data/mock/types'
import { addRiyadhCalendarDays, riyadhDate } from './riyadhWorkingDays'

/*
 * Status and deadline rules for internal review requests, shared by the workflow helpers
 * and the internal review transitions (no imports from either, so both can use them). Pure functions.
 */

/**
 * A review duration is a whole number of working days in this range. The maximum is a technical
 * limit, far above real use, so the date stays one the database and the browser can handle.
 */
export const REVIEW_DURATION_MIN = 1
export const REVIEW_DURATION_MAX = 3650

/** Above this many working days the author confirms the number, in case of a typing mistake. */
export const REVIEW_DURATION_CONFIRM_ABOVE = 60

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

/**
 * Changing a saved review deadline, through change_review_deadline
 * (supabase/migrations/20261101170100_change_review_deadline.sql, applied first). Off: the author's
 * Reviewers table has no action for it. To roll back, set it to false before running
 * supabase/scripts/rollback_change_review_deadline.sql.
 */
export const REVIEW_DEADLINE_EDITING_ACTIVE: boolean = true

/**
 * A response to one reviewer's request, through respond_to_comments' p_request_id
 * (supabase/migrations/20261101150000_respond_to_one_reviewer.sql, applied first). Off: a response
 * reaches all current recipients (responseRecipients). To roll back, set it to false before running
 * supabase/scripts/rollback_respond_to_one_reviewer.sql.
 */
export const PER_REVIEWER_RESPONSE_ACTIVE: boolean = true

/** Waiting for the reviewer: to accept or decline (pending), or to decide (accepted). */
export function isOpenDecision(decision: InternalReviewDecision): boolean {
  return decision === 'pending' || decision === 'accepted'
}

/** The reviewer no longer takes part in this round, so they don't count against completing it. */
export function isInactiveDecision(decision: InternalReviewDecision): boolean {
  return decision === 'declined' || decision === 'withdrawn' || decision === 'expired' || decision === 'removed'
}

/** The database refused a reviewer's action because the request expired: this tab was behind. */
export class RequestExpiredError extends Error {}

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
 * response due date has ended (the end of that local day) expires. Without a response
 * due date it never expires; once accepted, nothing happens automatically.
 * Returns when that happens, or undefined when it can't.
 * The database expires it when anyone who can see the SOP loads it or acts on it.
 */
export function expiryDueAt(assignment: Pick<InternalReviewerAssignment, 'decision' | 'responseDueDate' | 'responseDueAt'>): string | undefined {
  return assignment.decision === 'pending' ? assignment.responseDueAt ?? (assignment.responseDueDate ? endOfLocalDay(assignment.responseDueDate) : undefined) : undefined
}

/** Whether the request is due to expire at `now`. */
export function isExpiryDue(assignment: Pick<InternalReviewerAssignment, 'decision' | 'responseDueDate' | 'responseDueAt'>, now: number): boolean {
  const dueAt = expiryDueAt(assignment)
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
  if (decision === 'declined' || decision === 'withdrawn' || decision === 'expired' || decision === 'removed') return 'cancelled'
  return decision
}

/** `Sop.reviewers` for an internal round: each reviewer's latest request, with a shared-view decision. */
export function projectReviewers(round: InternalReviewRound): (ReviewerAssignment & InternalReviewerAssignment)[] {
  return latestAssignments(round).map((assignment) => ({ ...assignment, decision: legacyDecision(assignment.decision) })) as (ReviewerAssignment & InternalReviewerAssignment)[]
}
