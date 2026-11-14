import { SYSTEM_ACTOR, type InternalReviewRound, type InternalReviewerAssignment, type Sop, type SopComment, type TimelineEvent } from '../data/mock/types'
import { checkRequired, hasCurrentCheck } from './compliance'
import { fixedResponseDueDate } from './fixedResponseDeadline'
import { todayIsoDate } from './format'
import { isInactiveDecision, isOpenDecision, isUnsentVersion, isValidReviewDuration, isExpiryDue, latestAssignmentOf, latestAssignments, projectReviewers, requestDeadline, reviewDueDateFrom, expiryDueAt } from './internalReviewStatus'
import { previewPendingDuration, previewReviewDeadline } from './reviewDeadline'
import { assignableReviewers, eligibleReviewers, type ReviewEnvironment } from './reviewFlow'
import { WORKING_DAY_DEADLINES_ACTIVE } from './deadlinePolicy'
import { parseResponseDueDate } from './responseTime'
import { endOfRiyadhDay, reviewWorkingDueDateFrom, WORKING_DAY_POLICY } from './riyadhWorkingDays'
import { isAuthor, SUBMIT_COMMENT_MAX } from './workflow'

export interface InternalReviewOptions {
  reviewerIds: string[]
  /**
   * Used only if working-day deadlines are switched off (lib/deadlinePolicy.ts): an optional deadline
   * to accept or decline (YYYY-MM-DD, today or later; tomorrow or later from 4:00 PM). While they're
   * active the date is fixed at two working days and the server sets it, so this is ignored.
   */
  responseDueDate?: string
  /** Optional review duration (whole working days, 1–3,650; calendar days if the switch is off), counted from each reviewer's acceptance. */
  reviewDurationDays?: number
  note?: string
}
const HOME_MUST_FINISH = 'A reviewer from the SOP\'s department must finish this version first'
const REQUEST_EXPIRED = 'This review request expired because it was not accepted or declined by its response due date'
/** Decline reasons and review comments are limited like other comments. */
export const REVIEW_TEXT_MAX = 1000
let serial = 0
const id = (prefix: string) => prefix + '-' + Date.now().toString(36) + '-' + (++serial)
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
export function currentInternalRound(sop: Sop): InternalReviewRound | undefined { return sop.internalReviewRounds?.at(-1) }
/** The user has an open request (pending or accepted) on the current version. */
export function isInternalReviewPending(sop: Sop, userId: string): boolean {
  const round = currentInternalRound(sop)
  const assignment = latestAssignmentOf(round, userId)
  return sop.status === 'in-review' && round?.version === sop.version && round.status === 'open' && !!assignment && isOpenDecision(assignment.decision)
}
function author(sop: Sop, actorId: string, env: ReviewEnvironment) {
  assert(isAuthor(sop, actorId) && env.users.some((user) => user.id === actorId && !user.deletedAt && user.permissions.includes('author') && !user.permissions.includes('admin')), 'Only the active main Author can manage internal review requests')
  assert(env.departments.some((department) => department.id === sop.departmentId && !department.removedAt), 'The SOP department is unavailable')
}
/** The round and the reviewer's latest, still open request. */
function active(sop: Sop, roundId: string, assignmentId: string) {
  const round = currentInternalRound(sop)
  assert(sop.status === 'in-review' && round?.id === roundId && round.version === sop.version && round.status === 'open', 'This internal review round is no longer open')
  const assignment = round.assignments.find((person) => person.id === assignmentId)
  assert(assignment?.decision !== 'withdrawn', 'This review request was withdrawn because it was not accepted or declined by its response due date')
  assert(assignment?.decision !== 'expired', REQUEST_EXPIRED)
  assert(assignment && isOpenDecision(assignment.decision) && latestAssignmentOf(round, assignment.userId) === assignment, 'This assignment is cancelled, decided, or no longer open')
  assert(!isExpiryDue(assignment, Date.now()), REQUEST_EXPIRED)
  return { round, assignment }
}
/**
 * Applies the expiry rule (see expiryDueAt) to the open round: each pending request whose
 * response due date has ended expires, dated at that deadline, by System. It is locked, and
 * the main author and the reviewer are told. Returns the same SOP when nothing is due.
 */
export function expireUnanswered(sop: Sop, now = Date.now()): Sop {
  const round = currentInternalRound(sop)
  if (!round || round.status !== 'open' || sop.status !== 'in-review') return sop
  const due = latestAssignments(round).filter((person) => isExpiryDue(person, now))
  if (!due.length) return sop
  let updated = round
  const events: TimelineEvent[] = []
  for (const person of due) {
    const expiredAt = expiryDueAt(person)!
    updated = update(updated, person.id, { decision: 'expired', expiredAt })
    events.push(event(round, 'review-expired', SYSTEM_ACTOR, { reviewAssignmentId: person.id, createdAt: expiredAt, recipientIds: [sop.authorId!, person.userId] }))
  }
  return settleRound(sop, updated, events)
}
/** When the next expiry is due across these SOPs (epoch milliseconds), if any. */
export function nextExpiryAt(sops: Sop[]): number | undefined {
  const times = sops.flatMap((sop) => {
    const round = currentInternalRound(sop)
    if (!round || round.status !== 'open' || sop.status !== 'in-review') return []
    return latestAssignments(round).map((person) => expiryDueAt(person)).filter((dueAt) => dueAt !== undefined).map((dueAt) => new Date(dueAt).getTime())
  })
  return times.length ? Math.min(...times) : undefined
}
function reviewer(sop: Sop, actorId: string, assignment: InternalReviewerAssignment, env: ReviewEnvironment) {
  const actor = env.users.find((user) => user.id === actorId)
  assert(assignment.userId === actorId && !!actor && eligibleReviewers(sop, actor.departmentId, env.users).some((person) => person.id === actorId), 'Only the active assigned internal Reviewer can decide')
  assert(env.departments.some((department) => department.id === sop.departmentId && !department.removedAt), 'The SOP department is unavailable')
}
function event(round: InternalReviewRound, type: TimelineEvent['type'], actorId: string, extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id: id('internal-event'), type, actorId, reviewRoundId: round.id, version: round.version, createdAt: new Date().toISOString(), ...extra }
}
function save(sop: Sop, round: InternalReviewRound, events: TimelineEvent[], extra: Partial<Sop> = {}): Sop {
  return { ...sop, ...extra, internalReviewRounds: [...sop.internalReviewRounds!.slice(0, -1), round], reviewers: projectReviewers(round), lastUpdated: todayIsoDate(), timeline: [...sop.timeline, ...events] }
}
function update(round: InternalReviewRound, assignmentId: string, change: Partial<InternalReviewerAssignment>): InternalReviewRound {
  return { ...round, assignments: round.assignments.map((person) => person.id === assignmentId ? { ...person, ...change } : person) }
}
/**
 * The deadlines each new request gets, validated: the fixed two-working-day response date and a
 * duration in working days. With working-day deadlines switched off (lib/deadlinePolicy.ts): an
 * optional response date today or later (tomorrow or later from 4:00 PM, see lib/responseTime)
 * and a whole-day duration. Existing records are never rewritten.
 */
function deadlines(options: InternalReviewOptions, now = new Date()): Pick<InternalReviewerAssignment, 'responseDueDate' | 'responseDueAt' | 'reviewDurationDays' | 'deadlinePolicy'> {
  if (!WORKING_DAY_DEADLINES_ACTIVE) {
    const chosen = options.responseDueDate?.trim() || undefined
    assert(parseResponseDueDate(chosen ?? '', now).valid, 'Choose an optional response due date today or later (tomorrow or later from 4:00 PM)')
    assert(isValidReviewDuration(options.reviewDurationDays), 'Choose an optional review duration of 1 to 3,650 whole days')
    // The end of the chosen day in Riyadh, as send_review_requests saves it (riyadh_end_of_day).
    return { ...(chosen ? { responseDueDate: chosen, responseDueAt: endOfRiyadhDay(chosen) } : {}), ...(options.reviewDurationDays !== undefined ? { reviewDurationDays: options.reviewDurationDays } : {}) }
  }
  const responseDueDate = fixedResponseDueDate(now)
  assert(isValidReviewDuration(options.reviewDurationDays), 'Choose an optional review duration of 1 to 3,650 whole working days')
  return { responseDueDate, responseDueAt: endOfRiyadhDay(responseDueDate), deadlinePolicy: WORKING_DAY_POLICY,
    ...(options.reviewDurationDays !== undefined ? { reviewDurationDays: options.reviewDurationDays } : {}) }
}
/**
 * A Draft sent again whose current version already has a round (closed when nobody was left) reopens
 * that round, as submit_for_review does (one round per version): the new requests join the old ones,
 * which stay as history. Otherwise a new round.
 */
function create(sop: Sop, actorId: string, options: InternalReviewOptions, kind: 'submitted' | 'resubmitted'): Sop {
  const requestedAt = new Date()
  const now = requestedAt.toISOString()
  const timing = deadlines(options, requestedAt)
  const requests = options.reviewerIds.map((userId): InternalReviewerAssignment => ({ id: id('internal-task'), userId, decision: 'pending', assignedAt: now, assignedDueDays: null, ...timing }))
  const closed = currentInternalRound(sop)
  const reopen = closed?.status === 'closed' && closed.version === sop.version
  // Deadlines belong to each request; the round keeps no shared deadline.
  const round: InternalReviewRound = reopen
    ? { ...closed, status: 'open', closedAt: undefined, assignments: [...closed.assignments, ...requests] }
    : { id: id('internal-round'), scope: 'internal', version: sop.version, status: 'open', requestedById: actorId, requestedAt: now, assignedDueDays: null, assignments: requests }
  const rounds = sop.internalReviewRounds ?? []
  const events = [event(round, kind, actorId, { createdAt: now, recipientIds: options.reviewerIds, ...(options.note?.trim() ? { note: options.note.trim() } : {}) })]
  return { ...sop, status: 'in-review', reviewFlow: undefined, internalReviewRounds: reopen ? [...rounds.slice(0, -1), round] : [...rounds, round], reviewers: projectReviewers(round), approvers: [],
    reviewDueDays: undefined, reviewDueAt: undefined,
    approvalDueDays: undefined, approvalDueAt: undefined, lastUpdated: todayIsoDate(), timeline: [...sop.timeline, ...events] }
}
function validate(sop: Sop, options: InternalReviewOptions, env: ReviewEnvironment, eligible = homeReviewers(sop, env)) {
  assert(options.reviewerIds.length > 0 && new Set(options.reviewerIds).size === options.reviewerIds.length, 'Select one or more different eligible internal reviewers')
  assert(options.reviewerIds.every((userId) => eligible.some((user) => user.id === userId)), 'Select eligible reviewers from the SOP home department; Authors and co-authors cannot review')
  assert(!options.note || options.note.trim().length <= SUBMIT_COMMENT_MAX, 'Submission notes must be at most 500 characters')
  deadlines(options)
}
export function startInternalReview(sop: Sop, actorId: string, guidelineVersion: string, options: InternalReviewOptions, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  assert(sop.status === 'draft' && !sop.internalReviewRounds?.some((round) => round.status === 'open'), 'Only a Draft without an open request can be submitted')
  // Only where the GVP guideline applies (Pharmacovigilance).
  assert(!checkRequired(sop, env.departments) || hasCurrentCheck(sop, guidelineVersion), 'Run a completed compliance check against the current guideline first')
  validate(sop, options, env)
  return create(sop, actorId, options, 'submitted')
}
/** Who the first send of a version can go to: reviewers from the SOP's department. */
export function homeReviewers(sop: Sop, env: ReviewEnvironment) {
  return assignableReviewers(sop, env).filter((user) => user.departmentId === sop.departmentId)
}
/** A reviewer from the SOP's department has finished the current version (completed or returned), by their current department. */
export function hasHomeFinished(sop: Sop, users: ReviewEnvironment['users']): boolean {
  const round = currentInternalRound(sop)
  if (round?.version !== sop.version) return false
  return latestAssignments(round).some((request) => (request.decision === 'completed' || request.decision === 'returned') &&
    users.find((user) => user.id === request.userId)?.departmentId === sop.departmentId)
}
/** Reviewers from the SOP's department now; from any department once one of them has finished the current version. */
function reviewersForNow(sop: Sop, env: ReviewEnvironment) {
  return hasHomeFinished(sop, env.users) ? assignableReviewers(sop, env) : homeReviewers(sop, env)
}
/** Reviewers who can be added now: not yet asked, or their latest request was declined, withdrawn or removed. An expired request is sent again instead. */
export function addableReviewers(sop: Sop, env: ReviewEnvironment) {
  const round = currentInternalRound(sop)
  return reviewersForNow(sop, env).filter((user) => {
    const latest = latestAssignmentOf(round?.version === sop.version ? round : undefined, user.id)
    return !latest || (isInactiveDecision(latest.decision) && latest.decision !== 'expired')
  })
}
/**
 * Whether the main author can add reviewers to the current version's review now, or send an expired
 * request again: also once it settled as Completed or Changes Requested (it reopens the round).
 */
export function canAddReviewers(sop: Sop): boolean {
  const round = currentInternalRound(sop)
  return sop.status === 'in-review' && !sop.reviewFlow && !!round && round.version === sop.version &&
    (round.status === 'open' || round.status === 'completed' || round.status === 'changes-requested')
}
/**
 * The main author sends the current version to more reviewers, e.g. to replace one who declined,
 * expired or was removed. Each gets a new request; their earlier one stays in the history.
 */
export function addInternalReviewers(sop: Sop, actorId: string, options: InternalReviewOptions, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  assert(canAddReviewers(sop), 'Reviewers can only be added to the review of the current version')
  const candidates = assignableReviewers(sop, env)
  validate(sop, options, env, candidates)
  assert(hasHomeFinished(sop, env.users) || options.reviewerIds.every((userId) => candidates.find((user) => user.id === userId)?.departmentId === sop.departmentId), HOME_MUST_FINISH)
  const addable = addableReviewers(sop, env)
  assert(options.reviewerIds.every((userId) => addable.some((user) => user.id === userId)), 'These reviewers already have a request for this version')
  const round = currentInternalRound(sop)!
  const requestedAt = new Date()
  const now = requestedAt.toISOString()
  const timing = deadlines(options, requestedAt)
  const updated: InternalReviewRound = { ...round, assignments: [...round.assignments,
    ...options.reviewerIds.map((userId) => ({ id: id('internal-task'), userId, decision: 'pending' as const, assignedAt: now, assignedDueDays: null, ...timing }))] }
  return settleRound(sop, updated, [event(round, 'submitted', actorId, { createdAt: now, recipientIds: options.reviewerIds, ...(options.note?.trim() ? { note: options.note.trim() } : {}) })])
}
/** Why Send Again doesn't apply to a request: the review isn't open to it, it didn't expire, it was sent again, or the department rule. */
export type ResendBlocker = 'closed' | 'not-expired' | 'replaced' | 'home-first'
/** Why this request can't be sent again now (canResendRequest, then the department rule), or undefined when it can. */
export function resendBlocker(sop: Sop, round: InternalReviewRound, request: InternalReviewerAssignment, users: ReviewEnvironment['users']): ResendBlocker | undefined {
  if (!canAddReviewers(sop) || round !== currentInternalRound(sop)) return 'closed'
  if (request.decision !== 'expired') return 'not-expired'
  if (latestAssignmentOf(round, request.userId) !== request) return 'replaced'
  return resendIsTooEarly(sop, request, users) ? 'home-first' : undefined
}
/** Why a reviewer can't be removed on this request: the review isn't open to it, a newer request replaced it, or it already ended. */
export type RemoveBlocker = 'closed' | 'replaced' | 'removed' | 'declined' | 'withdrawn'
/**
 * Why the main author can't remove this request's reviewer now, or undefined when they can: the
 * reviewer's latest request in the current version's review of an SOP In Review, unless it was
 * removed, declined or withdrawn (an expired one can be removed).
 */
export function removeBlocker(sop: Sop, round: InternalReviewRound, request: InternalReviewerAssignment): RemoveBlocker | undefined {
  const current = currentInternalRound(sop)
  if (sop.status !== 'in-review' || current?.version !== sop.version || round !== current) return 'closed'
  if (latestAssignmentOf(round, request.userId) !== request) return 'replaced'
  return request.decision === 'removed' || request.decision === 'declined' || request.decision === 'withdrawn' ? request.decision : undefined
}
/** Whether the main author can send this expired request again: the reviewer's latest, in the current version's review. */
export function canResendRequest(sop: Sop, round: InternalReviewRound, request: InternalReviewerAssignment): boolean {
  return canAddReviewers(sop) && round === currentInternalRound(sop) && request.decision === 'expired' && latestAssignmentOf(round, request.userId) === request
}
/** An other-department reviewer can only be sent it again once a same-department reviewer has finished this version. */
export function resendIsTooEarly(sop: Sop, request: InternalReviewerAssignment, users: ReviewEnvironment['users']): boolean {
  return users.find((user) => user.id === request.userId)?.departmentId !== sop.departmentId && !hasHomeFinished(sop, users)
}
/**
 * The main author sends an expired request to the same reviewer again, with the same review
 * duration and a new response deadline. It is a new request: the expired one stays in the
 * history, and a settled round reopens.
 */
export function resendInternalReview(sop: Sop, actorId: string, assignmentId: string, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  const round = currentInternalRound(sop)
  const request = round?.assignments.find((person) => person.id === assignmentId)
  assert(round && request && canResendRequest(sop, round, request), 'This review request can\'t be sent again')
  const options = { reviewerIds: [request.userId], reviewDurationDays: request.reviewDurationDays }
  validate(sop, options, env, assignableReviewers(sop, env))
  assert(!resendIsTooEarly(sop, request, env.users), HOME_MUST_FINISH)
  const requestedAt = new Date()
  const now = requestedAt.toISOString()
  const updated: InternalReviewRound = { ...round, assignments: [...round.assignments,
    { id: id('internal-task'), userId: request.userId, decision: 'pending', assignedAt: now, assignedDueDays: null, ...deadlines(options, requestedAt) }] }
  return settleRound(sop, updated, [event(round, 'review-request-resent', actorId, { createdAt: now, recipientIds: [request.userId] })])
}
/** The reviewer takes the task; a decision is only possible after accepting. */
export function acceptInternalReview(sop: Sop, actorId: string, roundId: string, assignmentId: string, env: ReviewEnvironment): Sop {
  const { round, assignment } = active(sop, roundId, assignmentId)
  reviewer(sop, actorId, assignment, env)
  assert(assignment.decision === 'pending', 'This review has already been accepted')
  const acceptedAt = new Date().toISOString()
  // The review duration starts now; its last day is fixed so history and the demo clock stay consistent.
  const workingDays = assignment.deadlinePolicy === WORKING_DAY_POLICY
  const reviewDueDate = assignment.reviewDurationDays !== undefined
    ? (workingDays ? reviewWorkingDueDateFrom : reviewDueDateFrom)(acceptedAt, assignment.reviewDurationDays) : undefined
  const updated = update(round, assignmentId, { decision: 'accepted', acceptedAt,
    ...(reviewDueDate ? { reviewDueDate, ...(workingDays ? { reviewDueAt: endOfRiyadhDay(reviewDueDate) } : {}) } : {}) })
  return save(sop, updated, [event(round, 'review-accepted', actorId, { reviewAssignmentId: assignmentId })])
}
/** The reviewer turns the task down with a required reason; the author can ask someone else. */
export function declineInternalReview(sop: Sop, actorId: string, roundId: string, assignmentId: string, reason: string, env: ReviewEnvironment): Sop {
  const { round, assignment } = active(sop, roundId, assignmentId)
  reviewer(sop, actorId, assignment, env)
  assert(assignment.decision === 'pending', 'Only a review that has not been accepted can be declined')
  const trimmed = reason.trim()
  assert(trimmed && trimmed.length <= REVIEW_TEXT_MAX, 'A reason of up to 1000 characters is required to decline')
  const now = new Date().toISOString()
  const updated = update(round, assignmentId, { decision: 'declined', declineReason: trimmed, decidedAt: now })
  return settleRound(sop, updated, [event(round, 'review-declined', actorId, { reviewAssignmentId: assignmentId, note: trimmed, recipientIds: [sop.authorId!, ...sop.coAuthorIds] })])
}
/**
 * Recalculates the round after any change: open while someone taking part hasn't finished; once they
 * all have, completed, or changes-requested if anyone returned it. With nobody taking part (no pending
 * or accepted request, and nobody who completed or returned it), the round closes and the SOP goes back
 * to Draft, as settle_review_round does; no event is added for it.
 */
function settleRound(sop: Sop, round: InternalReviewRound, events: TimelineEvent[]): Sop {
  const taking = latestAssignments(round).filter((person) => !isInactiveDecision(person.decision))
  if (!taking.length) return save(sop, { ...round, status: 'closed', closedAt: new Date().toISOString() }, events, { status: 'draft' })
  if (taking.some((person) => isOpenDecision(person.decision))) return save(sop, { ...round, status: 'open', closedAt: undefined }, events)
  const status = taking.every((person) => person.decision === 'completed') ? 'completed' : 'changes-requested'
  if (round.status === status) return save(sop, round, events)
  if (status === 'completed') events.push(event(round, 'internal-review-completed', SYSTEM_ACTOR, { recipientIds: [sop.authorId!] }))
  return save(sop, { ...round, status, closedAt: new Date().toISOString() }, events)
}
/**
 * An accepted reviewer completes the review (optional comments), or returns it to the author with
 * required comments. A return affects only this reviewer; the SOP stays In Review.
 */
export function decideInternalReview(sop: Sop, actorId: string, roundId: string, assignmentId: string, decision: 'completed' | 'returned', text: string | undefined, env: ReviewEnvironment): Sop {
  const { round, assignment } = active(sop, roundId, assignmentId)
  reviewer(sop, actorId, assignment, env)
  assert(assignment.decision === 'accepted', 'Accept the review before deciding')
  assert(decision === 'completed' || decision === 'returned', 'Choose a final review decision')
  const trimmed = text?.trim() ?? ''
  assert(trimmed.length <= REVIEW_TEXT_MAX && (decision !== 'returned' || !!trimmed), 'Returning to the author requires comments; comments must be at most 1000 characters')
  const now = new Date().toISOString()
  const comment: SopComment | undefined = trimmed ? { id: id('internal-comment'), authorUserId: actorId, role: 'reviewer', text: trimmed, version: round.version, createdAt: now, reviewRoundId: round.id, reviewAssignmentId: assignmentId } : undefined
  const updated = update(round, assignmentId, { decision, decidedAt: now, ...(comment ? { commentId: comment.id } : {}) })
  const commented = comment ? { ...sop, comments: [...sop.comments, comment] } : sop
  const events = [event(round, decision === 'returned' ? 'review-changes-requested' : 'review-completed', actorId, { reviewAssignmentId: assignmentId, ...(comment ? { commentId: comment.id } : {}), recipientIds: decision === 'returned' ? [sop.authorId!, ...sop.coAuthorIds] : [sop.authorId!] })]
  return settleRound(commented, updated, events)
}
/**
 * The main author removes a reviewer from the current round at any time, whatever their status,
 * with a required reason. The reviewer is told; their decision and comments stay in the history.
 */
export function removeInternalReviewer(sop: Sop, actorId: string, roundId: string, assignmentId: string, reason: string, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  const round = currentInternalRound(sop)
  assert(sop.status === 'in-review' && round?.id === roundId && round.version === sop.version, 'This review round is no longer current')
  const assignment = round.assignments.find((person) => person.id === assignmentId)
  assert(assignment && latestAssignmentOf(round, assignment.userId) === assignment && assignment.decision !== 'removed', 'This reviewer is no longer part of the review')
  const trimmed = reason.trim()
  assert(trimmed && trimmed.length <= REVIEW_TEXT_MAX, 'A reason of up to 1000 characters is required to remove a reviewer')
  const now = new Date().toISOString()
  const updated = update(round, assignmentId, { decision: 'removed', removedAt: now, removedById: actorId, removalReason: trimmed })
  return settleRound(sop, updated, [event(round, 'reviewer-removed', actorId, { reviewAssignmentId: assignmentId, note: trimmed, recipientIds: [assignment.userId] })])
}
/** Why a request's review deadline or duration can't be changed: the review is over for it, or the request has ended. */
export type DeadlineEditBlocker = 'closed' | 'removed' | 'declined' | 'withdrawn' | 'expired' | 'completed' | 'returned'

/**
 * Whether the main author can change this request's review time, as change_review_deadline allows:
 * the reviewer's latest request, pending (its review duration, before it starts) or accepted (its
 * review deadline), in the open round of the current version of an SOP In Review.
 */
export function deadlineEditBlocker(sop: Sop, round: InternalReviewRound, assignment: InternalReviewerAssignment): DeadlineEditBlocker | undefined {
  if (sop.status !== 'in-review' || round !== currentInternalRound(sop) || round.version !== sop.version || round.status !== 'open') return 'closed'
  if (assignment.decision === 'pending' || assignment.decision === 'accepted') return latestAssignmentOf(round, assignment.userId) === assignment ? undefined : 'closed'
  return assignment.decision
}
/** The reviewer's latest request is pending or accepted in the current version's open round, so its review time can change. */
export function canChangeReviewDeadline(sop: Sop, round: InternalReviewRound, assignment: InternalReviewerAssignment): boolean {
  return !deadlineEditBlocker(sop, round, assignment)
}
/**
 * The main author changes a reviewer's review time: for an accepted request its review deadline (or
 * sets one), a number of working days from acceptance; for a pending one the review duration it will
 * start with once they accept. The request then follows the working-day policy, whichever one it was
 * sent under. The response deadline never changes.
 */
export function changeInternalReviewDeadline(sop: Sop, actorId: string, roundId: string, assignmentId: string, days: number, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  const round = currentInternalRound(sop)
  const assignment = round?.assignments.find((person) => person.id === assignmentId)
  assert(round?.id === roundId && assignment && canChangeReviewDeadline(sop, round, assignment), "This reviewer isn't reviewing this version any more")
  if (assignment.decision === 'pending') {
    const planned = previewPendingDuration(assignment, String(days))
    assert(planned.problem !== 'invalid', 'Choose a review duration of 1 to 3,650 working days')
    assert(planned.problem !== 'unchanged', 'That is already the review duration')
    const updated = update(round, assignmentId, { reviewDurationDays: days, deadlinePolicy: WORKING_DAY_POLICY })
    return save(sop, updated, [event(round, 'review-duration-changed', actorId, { reviewAssignmentId: assignmentId, recipientIds: [assignment.userId],
      ...(assignment.reviewDurationDays !== undefined ? { previousReviewDurationDays: assignment.reviewDurationDays } : {}), newReviewDurationDays: days })])
  }
  const preview = previewReviewDeadline(assignment, String(days))
  assert(preview.problem !== 'invalid', 'Choose a review duration of 1 to 3,650 working days')
  assert(preview.problem !== 'past', 'That deadline has already passed')
  assert(preview.problem !== 'unchanged', 'That is already the review deadline')
  const updated = update(round, assignmentId, { reviewDurationDays: days, reviewDueDate: preview.dueDate, reviewDueAt: preview.dueAt, deadlinePolicy: WORKING_DAY_POLICY })
  return save(sop, updated, [event(round, 'review-deadline-changed', actorId, { reviewAssignmentId: assignmentId, recipientIds: [assignment.userId],
    previousReviewDueAt: requestDeadline(assignment)?.dueAt, newReviewDueAt: preview.dueAt })])
}
/** A new version, uploaded once everyone finished (or after an approver return), is ready to be sent to reviewers. */
export function canSendNewVersion(sop: Sop): boolean {
  return (sop.status === 'in-review' || sop.status === 'returned') && isUnsentVersion(sop)
}
/** The main author sends the new version to the reviewers they choose (all, some, or new ones) as a new round. */
export function sendNewVersionForReview(sop: Sop, actorId: string, guidelineVersion: string, options: InternalReviewOptions, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  assert(canSendNewVersion(sop), 'Add a new version once every reviewer has finished before sending it for review')
  assert(!checkRequired(sop, env.departments) || hasCurrentCheck(sop, guidelineVersion), 'Complete a compliance check of the new version against the current guideline first')
  validate(sop, options, env)
  return create(sop, actorId, options, 'resubmitted')
}
