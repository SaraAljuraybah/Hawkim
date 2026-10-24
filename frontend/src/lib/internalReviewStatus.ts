import type { InternalReviewDecision, InternalReviewRound, InternalReviewerAssignment, ReviewerAssignment, ReviewerDecision } from '../data/mock/types'

/*
 * Status rules for internal review requests, shared by the workflow helpers and the
 * internal review transitions (no imports from either, so both can use them). Pure functions.
 */

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
