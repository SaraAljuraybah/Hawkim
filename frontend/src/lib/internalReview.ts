import { SYSTEM_ACTOR, type InternalReviewRound, type InternalReviewerAssignment, type Sop, type SopComment, type TimelineEvent } from '../data/mock/types'
import { hasCurrentCheck } from './compliance'
import { todayIsoDate } from './format'
import { eligibleReviewers, type ReviewEnvironment } from './reviewFlow'
import { canResubmit, isAuthor, parseDueDate } from './workflow'

export interface InternalReviewOptions {
  reviewerIds: string[]
  dueDate?: string
  reviewerDueDates?: Record<string, string>
  note?: string
}
let serial = 0
const id = (prefix: string) => prefix + '-' + Date.now().toString(36) + '-' + (++serial)
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
export function currentInternalRound(sop: Sop): InternalReviewRound | undefined { return sop.internalReviewRounds?.at(-1) }
export function isInternalReviewPending(sop: Sop, userId: string): boolean {
  const round = currentInternalRound(sop)
  return sop.status === 'in-review' && round?.version === sop.version && round.status === 'open' && round.assignments.some((person) => person.userId === userId && person.decision === 'pending')
}
function author(sop: Sop, actorId: string, env: ReviewEnvironment) {
  assert(isAuthor(sop, actorId) && env.users.some((user) => user.id === actorId && !user.deletedAt && user.permissions.includes('author') && !user.permissions.includes('admin')), 'Only the active main Author can manage internal review requests')
  assert(env.departments.some((department) => department.id === sop.departmentId && !department.removedAt), 'The SOP department is unavailable')
}
function active(sop: Sop, roundId: string, assignmentId: string) {
  const round = currentInternalRound(sop)
  assert(sop.status === 'in-review' && round?.id === roundId && round.version === sop.version && round.status === 'open', 'This internal review round is no longer open')
  const assignment = round.assignments.find((person) => person.id === assignmentId)
  assert(assignment?.decision === 'pending', 'This assignment is cancelled, decided, or no longer pending')
  return { round, assignment }
}
function reviewer(sop: Sop, actorId: string, assignment: InternalReviewerAssignment, env: ReviewEnvironment) {
  assert(assignment.userId === actorId && eligibleReviewers(sop, sop.departmentId, env.users).some((person) => person.id === actorId), 'Only the active assigned internal Reviewer can decide')
  assert(env.departments.some((department) => department.id === sop.departmentId && !department.removedAt), 'The SOP department is unavailable')
}
function event(round: InternalReviewRound, type: TimelineEvent['type'], actorId: string, extra: Partial<TimelineEvent> = {}): TimelineEvent {
  return { id: id('internal-event'), type, actorId, reviewRoundId: round.id, version: round.version, createdAt: new Date().toISOString(), ...extra }
}
function save(sop: Sop, round: InternalReviewRound, events: TimelineEvent[], extra: Partial<Sop> = {}): Sop {
  return { ...sop, ...extra, internalReviewRounds: [...sop.internalReviewRounds!.slice(0, -1), round], reviewers: round.assignments, lastUpdated: todayIsoDate(), timeline: [...sop.timeline, ...events] }
}
function date(isoDate?: string) {
  const trimmed = isoDate?.trim() || undefined
  const parsed = parseDueDate(trimmed ?? '')
  assert(parsed.valid, 'Choose an optional deadline from tomorrow through 30 days from today')
  return { dueDate: trimmed, assignedDueDays: parsed.days ?? null }
}
function plusDays(days: number): string {
  const now = new Date()
  return todayIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days))
}
function create(sop: Sop, actorId: string, options: InternalReviewOptions, kind: 'submitted' | 'resubmitted'): Sop {
  const now = new Date().toISOString()
  const timing = date(options.dueDate)
  const round: InternalReviewRound = { id: id('internal-round'), scope: 'internal', version: sop.version, status: 'open', requestedById: actorId, requestedAt: now, ...timing,
    assignments: options.reviewerIds.map((userId) => ({ id: id('internal-task'), userId, decision: 'pending', assignedAt: now, ...date(options.reviewerDueDates?.[userId]) })) }
  const recipientIds = round.assignments.map((person) => person.userId)
  const events = [event(round, kind, actorId, { recipientIds, ...(options.note?.trim() ? { note: options.note.trim() } : {}) })]
  if (round.dueDate) events.push(event(round, 'stage-due-date-set', actorId, { stage: 'review', dueAt: new Date(round.dueDate + 'T23:59:59.999').toISOString() }))
  return { ...sop, status: 'in-review', reviewFlow: undefined, internalReviewRounds: [...(sop.internalReviewRounds ?? []), round], reviewers: round.assignments, approvers: [],
    reviewDueDays: round.assignedDueDays ?? undefined, reviewDueAt: round.dueDate ? new Date(round.dueDate + 'T23:59:59.999').toISOString() : undefined,
    approvalDueDays: undefined, approvalDueAt: undefined, lastUpdated: todayIsoDate(), timeline: [...sop.timeline, ...events] }
}
function validate(sop: Sop, options: InternalReviewOptions, env: ReviewEnvironment) {
  assert(options.reviewerIds.length > 0 && new Set(options.reviewerIds).size === options.reviewerIds.length, 'Select one or more different eligible internal reviewers')
  const eligible = eligibleReviewers(sop, sop.departmentId, env.users)
  assert(options.reviewerIds.every((userId) => eligible.some((user) => user.id === userId)), 'Select eligible reviewers from the SOP home department; Authors and co-authors cannot review')
  assert(Object.keys(options.reviewerDueDates ?? {}).every((key) => options.reviewerIds.includes(key)), 'Task deadlines must belong to selected reviewers')
  assert(!options.note || options.note.trim().length <= 500, 'Submission notes must be at most 500 characters')
  date(options.dueDate)
  Object.values(options.reviewerDueDates ?? {}).forEach(date)
}
export function startInternalReview(sop: Sop, actorId: string, guidelineVersion: string, options: InternalReviewOptions, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  assert(sop.status === 'draft' && !sop.internalReviewRounds?.some((round) => round.status === 'open'), 'Only a Draft without an open request can be submitted')
  assert(hasCurrentCheck(sop, guidelineVersion), 'Run a completed compliance check against the current guideline first')
  validate(sop, options, env)
  return create(sop, actorId, options, 'submitted')
}
export function beginInternalReview(sop: Sop, actorId: string, roundId: string, assignmentId: string, env: ReviewEnvironment): Sop {
  const { round, assignment } = active(sop, roundId, assignmentId)
  reviewer(sop, actorId, assignment, env)
  assert(!assignment.startedAt, 'This review has already been started')
  const updated = { ...round, assignments: round.assignments.map((person) => person.id === assignmentId ? { ...person, startedAt: new Date().toISOString() } : person) }
  return save(sop, updated, [event(round, 'review-started', actorId, { reviewAssignmentId: assignmentId })])
}
function finishIfReady(sop: Sop, round: InternalReviewRound, events: TimelineEvent[]): Sop {
  if (round.assignments.some((person) => person.decision === 'pending')) return save(sop, round, events)
  const completed = round.assignments.some((person) => person.decision === 'completed')
  const updated: InternalReviewRound = { ...round, status: completed ? 'completed' : 'cancelled', closedAt: new Date().toISOString() }
  events.push(event(round, completed ? 'internal-review-completed' : 'review-request-cancelled', SYSTEM_ACTOR, { recipientIds: [sop.authorId!], ...(!completed ? { cancellationReason: 'author-cancelled' as const } : {}) }))
  return save(sop, updated, events, { status: completed ? 'in-review' : 'draft' })
}
export function decideInternalReview(sop: Sop, actorId: string, roundId: string, assignmentId: string, decision: 'completed' | 'returned', text: string | undefined, env: ReviewEnvironment): Sop {
  const { round, assignment } = active(sop, roundId, assignmentId)
  reviewer(sop, actorId, assignment, env)
  assert(decision === 'completed' || decision === 'returned', 'Choose a final review decision')
  const trimmed = text?.trim() ?? ''
  assert(trimmed.length <= 1000 && (decision !== 'returned' || !!trimmed), 'Rejection requires a non-empty reason; feedback must be at most 1000 characters')
  const now = new Date().toISOString()
  const comment: SopComment | undefined = trimmed ? { id: id('internal-comment'), authorUserId: actorId, role: 'reviewer', text: trimmed, version: round.version, createdAt: now, reviewRoundId: round.id, reviewAssignmentId: assignmentId } : undefined
  const updated: InternalReviewRound = { ...round, assignments: round.assignments.map((person) => person.id === assignmentId ? { ...person, decision, decidedAt: now, ...(comment ? { commentId: comment.id } : {}) } : person) }
  const commented = comment ? { ...sop, comments: [...sop.comments, comment] } : sop
  const events = [event(round, decision === 'returned' ? 'returned' : 'review-completed', actorId, { reviewAssignmentId: assignmentId, ...(comment ? { commentId: comment.id } : {}), ...(decision === 'returned' ? { recipientIds: [sop.authorId!, ...sop.coAuthorIds] } : {}) })]
  if (decision === 'returned') {
    updated.status = 'rejected'; updated.closedAt = now
    updated.assignments = updated.assignments.map((person) => {
      if (person.decision !== 'pending') return person
      events.push(event(round, 'review-cancelled', SYSTEM_ACTOR, { reviewAssignmentId: person.id, recipientIds: [person.userId], cancellationReason: 'round-rejected' }))
      return { ...person, decision: 'cancelled', cancelledAt: now, cancelledById: SYSTEM_ACTOR, cancellationReason: 'round-rejected' }
    })
    return save(commented, updated, events, { status: 'returned' })
  }
  return finishIfReady(commented, updated, events)
}
export function cancelInternalReview(sop: Sop, actorId: string, roundId: string, assignmentId: string, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  const { round } = active(sop, roundId, assignmentId)
  const now = new Date().toISOString()
  const updated: InternalReviewRound = { ...round, assignments: round.assignments.map((person) => person.id === assignmentId ? { ...person, decision: 'cancelled', cancelledAt: now, cancelledById: actorId, cancellationReason: 'author-cancelled' } : person) }
  return finishIfReady(sop, updated, [event(round, 'review-cancelled', actorId, { reviewAssignmentId: assignmentId, recipientIds: [round.assignments.find((person) => person.id === assignmentId)!.userId], cancellationReason: 'author-cancelled' })])
}
export function resubmitInternalReview(sop: Sop, actorId: string, guidelineVersion: string, env: ReviewEnvironment): Sop {
  author(sop, actorId, env)
  const round = currentInternalRound(sop)
  const approval = sop.approvalSubmissions?.at(-1)
  const returnedFromApproval = approval?.status === 'returned' && approval.internalReviewRoundId === round?.id && approval.version === round?.version
  assert(round && (round.status === 'rejected' || round.status === 'completed' && returnedFromApproval) && sop.version !== round.version && canResubmit(sop), 'Upload a new revised version after rejection before resubmitting')
  assert(hasCurrentCheck(sop, guidelineVersion), 'Complete a compliance check of the revised version against the current guideline first')
  const required = round.assignments.filter((person) => person.cancellationReason !== 'author-cancelled')
  const options: InternalReviewOptions = { reviewerIds: required.map((person) => person.userId),
    ...(round.assignedDueDays !== null ? { dueDate: plusDays(round.assignedDueDays) } : {}),
    reviewerDueDates: Object.fromEntries(required.filter((person) => person.assignedDueDays != null).map((person) => [person.userId, plusDays(person.assignedDueDays!)])) }
  validate(sop, options, env)
  return create(sop, actorId, options, 'resubmitted')
}
