import { SYSTEM_ACTOR, type InternalReviewRound, type InternalReviewerAssignment, type Sop, type SopComment, type TimelineEvent } from '../data/mock/types'
import { checkRequired, hasCurrentCheck } from './compliance'
import { todayIsoDate } from './format'
import { isInactiveDecision, isOpenDecision, isUnsentVersion, isValidReviewDuration, isWithdrawalDue, latestAssignmentOf, latestAssignments, projectReviewers, reviewDueDateFrom, withdrawalDueAt } from './internalReviewStatus'
import { eligibleReviewers, type ReviewEnvironment } from './reviewFlow'
import { parseResponseDueDate } from './responseTime'
import { isAuthor } from './workflow'

export interface InternalReviewOptions {
  reviewerIds: string[]
  /** Optional deadline to accept or decline (YYYY-MM-DD, today or later), the same for every request sent. */
  responseDueDate?: string
  /** Optional review duration (whole calendar days, 1–30), counted from each reviewer's acceptance. */
  reviewDurationDays?: number
  note?: string
}
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
  assert(assignment && isOpenDecision(assignment.decision) && latestAssignmentOf(round, assignment.userId) === assignment, 'This assignment is cancelled, decided, or no longer open')
  assert(!isWithdrawalDue(assignment, Date.now()), 'This review request was withdrawn because it was not accepted or declined by its response due date')
  return { round, assignment }
}
/**
 * Applies the automatic withdrawal rule (see withdrawalDueAt) to the open round: each pending
 * request whose response due date has ended is withdrawn, dated at that deadline, by System.
 * The author and the reviewer are told. Returns the same SOP when nothing is due.
 */
export function withdrawUnanswered(sop: Sop, now = Date.now()): Sop {
  const round = currentInternalRound(sop)
  if (!round || round.status !== 'open' || sop.status !== 'in-review') return sop
  const due = latestAssignments(round).filter((person) => isWithdrawalDue(person, now))
  if (!due.length) return sop
  let updated = round
  const events: TimelineEvent[] = []
  for (const person of due) {
    const withdrawnAt = withdrawalDueAt(person)!
    updated = update(updated, person.id, { decision: 'withdrawn', withdrawnAt })
    events.push(event(round, 'review-withdrawn', SYSTEM_ACTOR, { reviewAssignmentId: person.id, createdAt: withdrawnAt, recipientIds: [sop.authorId!, person.userId] }))
  }
  return settleRound(sop, updated, events)
}
/** When the next automatic withdrawal is due across these SOPs (epoch milliseconds), if any. */
export function nextWithdrawalAt(sops: Sop[]): number | undefined {
  const times = sops.flatMap((sop) => {
    const round = currentInternalRound(sop)
    if (!round || round.status !== 'open' || sop.status !== 'in-review') return []
    return latestAssignments(round).map((person) => withdrawalDueAt(person)).filter((dueAt) => dueAt !== undefined).map((dueAt) => new Date(dueAt).getTime())
  })
  return times.length ? Math.min(...times) : undefined
}
function reviewer(sop: Sop, actorId: string, assignment: InternalReviewerAssignment, env: ReviewEnvironment) {
  assert(assignment.userId === actorId && eligibleReviewers(sop, sop.departmentId, env.users).some((person) => person.id === actorId), 'Only the active assigned internal Reviewer can decide')
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
/** The deadlines each new request gets, validated: a response date today or later (tomorrow or later from 4:00 PM, see lib/responseTime), and a whole-day duration. */
function deadlines(options: InternalReviewOptions, now = new Date()): Pick<InternalReviewerAssignment, 'responseDueDate' | 'reviewDurationDays'> {
  const responseDueDate = options.responseDueDate?.trim() || undefined
  assert(parseResponseDueDate(responseDueDate ?? '', now).valid, 'Choose an optional response due date today or later (tomorrow or later from 4:00 PM)')
  assert(isValidReviewDuration(options.reviewDurationDays), 'Choose an optional review duration of 1 to 30 whole days')
  return { ...(responseDueDate ? { responseDueDate } : {}), ...(options.reviewDurationDays !== undefined ? { reviewDurationDays: options.reviewDurationDays } : {}) }
}
function create(sop: Sop, actorId: string, options: InternalReviewOptions, kind: 'submitted' | 'resubmitted'): Sop {
  const requestedAt = new Date()
  const now = requestedAt.toISOString()
  const timing = deadlines(options, requestedAt)
  // Deadlines belong to each request; the round keeps no shared deadline.
  const round: InternalReviewRound = { id: id('internal-round'), scope: 'internal', version: sop.version, status: 'open', requestedById: actorId, requestedAt: now, assignedDueDays: null,
    assignments: options.reviewerIds.map((userId) => ({ id: id('internal-task'), userId, decision: 'pending', assignedAt: now, assignedDueDays: null, ...timing })) }
  const recipientIds = round.assignments.map((person) => person.userId)
  const events = [event(round, kind, actorId, { createdAt: now, recipientIds, ...(options.note?.trim() ? { note: options.note.trim() } : {}) })]
  return { ...sop, status: 'in-review', reviewFlow: undefined, internalReviewRounds: [...(sop.internalReviewRounds ?? []), round], reviewers: projectReviewers(round), approvers: [],
    reviewDueDays: undefined, reviewDueAt: undefined,
    approvalDueDays: undefined, approvalDueAt: undefined, lastUpdated: todayIsoDate(), timeline: [...sop.timeline, ...events] }
}
function validate(sop: Sop, options: InternalReviewOptions, env: ReviewEnvironment) {
  assert(options.reviewerIds.length > 0 && new Set(options.reviewerIds).size === options.reviewerIds.length, 'Select one or more different eligible internal reviewers')
  const eligible = eligibleReviewers(sop, sop.departmentId, env.users)
  assert(options.reviewerIds.every((userId) => eligible.some((user) => user.id === userId)), 'Select eligible reviewers from the SOP home department; Authors and co-authors cannot review')
  assert(!options.note || options.note.trim().length <= 500, 'Submission notes must be at most 500 characters')
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
/** Reviewers who can be sent the current version now: not yet asked, or their latest request was declined, withdrawn or removed. */
export function addableReviewers(sop: Sop, users: ReviewEnvironment['users']) {
  const round = currentInternalRound(sop)
  return eligibleReviewers(sop, sop.departmentId, users).filter((user) => {
    const latest = latestAssignmentOf(round?.version === sop.version ? round : undefined, user.id)
    return !latest || isInactiveDecision(latest.decision)
  })
}
/** Whether the main author can add reviewers to the current version's review now (it reopens a settled round). */
export function canAddReviewers(sop: Sop): boolean {
  const round = currentInternalRound(sop)
  return sop.status === 'in-review' && !sop.reviewFlow && !!round && round.version === sop.version && (round.status === 'open' || round.status === 'completed')
}
/**
 * The main author sends the current version to more reviewers, e.g. to replace one who declined,
 * was withdrawn or was removed. Each gets a new request; their earlier one stays in the history.
 */
export function addInternalReviewers(sop: Sop, actorId: string, options: InternalReviewOptions, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  assert(canAddReviewers(sop), 'Reviewers can only be added to the review of the current version')
  validate(sop, options, env)
  const addable = addableReviewers(sop, env.users)
  assert(options.reviewerIds.every((userId) => addable.some((user) => user.id === userId)), 'These reviewers already have a request for this version')
  const round = currentInternalRound(sop)!
  const now = new Date().toISOString()
  const timing = deadlines(options)
  const updated: InternalReviewRound = { ...round, assignments: [...round.assignments,
    ...options.reviewerIds.map((userId) => ({ id: id('internal-task'), userId, decision: 'pending' as const, assignedAt: now, assignedDueDays: null, ...timing }))] }
  return settleRound(sop, updated, [event(round, 'submitted', actorId, { createdAt: now, recipientIds: options.reviewerIds, ...(options.note?.trim() ? { note: options.note.trim() } : {}) })])
}
/** The reviewer takes the task; a decision is only possible after accepting. */
export function acceptInternalReview(sop: Sop, actorId: string, roundId: string, assignmentId: string, env: ReviewEnvironment): Sop {
  const { round, assignment } = active(sop, roundId, assignmentId)
  reviewer(sop, actorId, assignment, env)
  assert(assignment.decision === 'pending', 'This review has already been accepted')
  const acceptedAt = new Date().toISOString()
  // The review duration starts now; its last day is fixed so history and the demo clock stay consistent.
  const reviewDueDate = assignment.reviewDurationDays !== undefined ? reviewDueDateFrom(acceptedAt, assignment.reviewDurationDays) : undefined
  const updated = update(round, assignmentId, { decision: 'accepted', acceptedAt, ...(reviewDueDate ? { reviewDueDate } : {}) })
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
 * Recalculates the round after any change: open while someone taking part hasn't finished (or nobody
 * is taking part); once they all have, completed, or changes-requested if anyone returned it.
 */
function settleRound(sop: Sop, round: InternalReviewRound, events: TimelineEvent[]): Sop {
  const taking = latestAssignments(round).filter((person) => !isInactiveDecision(person.decision))
  // With nobody taking part, the round stays open (and the SOP In Review) until the author asks someone else.
  if (!taking.length || taking.some((person) => isOpenDecision(person.decision))) return save(sop, { ...round, status: 'open', closedAt: undefined }, events)
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
/** A new version, uploaded once everyone finished (or after an approver return), is ready to be sent to reviewers. */
export function canSendNewVersion(sop: Sop): boolean {
  return (sop.status === 'in-review' || sop.status === 'returned') && isUnsentVersion(sop)
}
/** The main author sends the new version to the reviewers they choose (all, some, or new ones) as a new round. */
export function sendNewVersionForReview(sop: Sop, actorId: string, guidelineVersion: string, options: InternalReviewOptions, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  assert(canSendNewVersion(sop), 'Upload a new version once every reviewer has finished before sending it for review')
  assert(!checkRequired(sop, env.departments) || hasCurrentCheck(sop, guidelineVersion), 'Complete a compliance check of the new version against the current guideline first')
  validate(sop, options, env)
  return create(sop, actorId, options, 'resubmitted')
}
/** What stands between the review phase and Submit for approval, one item per reviewer still taking part. */
export type ReviewPhaseItem =
  | { kind: 'no-reviewers' }
  | { kind: 'respond'; userId: string }
  | { kind: 'finish'; userId: string; version: string }
  | { kind: 'returned'; userId: string; version: string }

/**
 * The review phase is done only when every reviewer taking part has completed the latest version.
 * Lists what is still missing (empty once done). Nobody taking part, or a version not yet sent, is missing reviewers.
 */
export function reviewPhaseMissing(sop: Sop): ReviewPhaseItem[] {
  const round = currentInternalRound(sop)
  if (!round || round.version !== sop.version) return [{ kind: 'no-reviewers' }]
  const taking = latestAssignments(round).filter((person) => !isInactiveDecision(person.decision))
  if (!taking.length) return [{ kind: 'no-reviewers' }]
  return taking.flatMap((person): ReviewPhaseItem[] => {
    if (person.decision === 'pending') return [{ kind: 'respond', userId: person.userId }]
    if (person.decision === 'accepted') return [{ kind: 'finish', userId: person.userId, version: round.version }]
    if (person.decision === 'returned') return [{ kind: 'returned', userId: person.userId, version: round.version }]
    return []
  })
}
