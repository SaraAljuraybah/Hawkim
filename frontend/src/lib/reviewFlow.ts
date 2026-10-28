import type { Department, DepartmentReview, DepartmentWorkflowConfiguration, ReviewFlow, ReviewScope, Sop, TimelineEvent, User } from '../data/mock/types'
import { hasCurrentCheck } from './compliance'
import { todayIsoDate } from './format'
import { currentReviewer, isApprover, isAuthor, isAuthorOrCoAuthor, parseDueDate, requiredReviewsComplete, returnAsReviewer, SUBMIT_COMMENT_MAX } from './workflow'

export interface ReviewEnvironment { users: User[]; departments: Department[] }
export type ReviewAction =
  | { type: 'forward'; reviewerId: string; dueDate?: string; text?: string }
  | { type: 'complete'; text?: string }
  | { type: 'return-review'; text: string }
  | { type: 'return-author'; text: string }
  | { type: 'department-review'; scope: ReviewScope; assignments: { departmentId: string; representativeId: string }[] }
  | { type: 'skip'; scope: ReviewScope }
  | { type: 'quality' }
let serial = 0
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function record(sop: Sop, type: TimelineEvent['type'], actorId: string, extra: Partial<TimelineEvent> = {}): Sop {
  return { ...sop, lastUpdated: todayIsoDate(), timeline: [...sop.timeline, {
    id: 'flow-' + Date.now().toString(36) + '-' + (++serial), type, actorId, version: sop.version, createdAt: new Date().toISOString(), ...extra,
  }] }
}
function feedback(sop: Sop, actorId: string, text?: string): Sop {
  const trimmed = text?.trim()
  assert(!trimmed || trimmed.length <= 1000, 'Comments must be at most 1000 characters')
  if (!trimmed) return sop
  const comment = { id: 'flow-comment-' + (++serial), authorUserId: actorId, role: 'reviewer' as const, text: trimmed, createdAt: new Date().toISOString(), version: sop.version }
  return { ...sop, comments: [...sop.comments, comment] }
}
function withDecision(sop: Sop, userId: string, decision: 'pending' | 'completed'): Sop {
  return { ...sop, reviewers: sop.reviewers.map((p) => p.userId === userId ? { ...p, decision, decidedAt: decision === 'completed' ? new Date().toISOString() : undefined } : p) }
}
/** Eligibility uses the ordinary Reviewer permission, home department and separation of duties. */
export function eligibleReviewers(sop: Sop, departmentId: string, users: User[], excluded: string[] = []): User[] {
  return users.filter((user) => !user.deletedAt && !user.permissions.includes('admin') && user.permissions.includes('reviewer') && user.departmentId === departmentId &&
    !isAuthorOrCoAuthor(sop, user.id) && !isApprover(sop, user.id) && !excluded.includes(user.id))
}
/**
 * Within a review round, a reviewer keeps the deadline already set (e.g. when Reviewer 2
 * returns it to Reviewer 1 and it's forwarded again). Resubmit clears every deadline, so
 * in a new round the next reviewer can be given a new one.
 */
export function keepsRoundDeadline(sop: Sop, userId: string): boolean {
  return !!sop.reviewers.find((p) => p.userId === userId)?.dueDate
}
function assign(sop: Sop, userId: string, dueDate?: string): Sop {
  const existing = sop.reviewers.find((p) => p.userId === userId)
  const date = dueDate?.trim()
  const parsed = parseDueDate(date ?? '')
  assert(!keepsRoundDeadline(sop, userId) || !date || date === existing?.dueDate, 'A reviewer keeps the deadline already set in this review round')
  assert(parsed.valid, 'Choose an optional review deadline of today or a future date')
  const assignment = { ...existing, userId, decision: 'pending' as const, decidedAt: undefined,
    ...(date ? { dueDate: date, assignedDueDays: parsed.days } : existing ? {} : { assignedDueDays: null }) }
  return { ...sop, reviewers: existing ? sop.reviewers.map((p) => p.userId === userId ? assignment : p) : [...sop.reviewers, assignment] }
}
function handoff(sop: Sop, flow: ReviewFlow, actorId: string, userId: string, departmentId?: string): Sop {
  return record({ ...sop, reviewFlow: { ...flow, activeReviewerId: userId } }, 'review-assigned', actorId, { recipientIds: [userId], departmentId })
}
export function startReview(sop: Sop, actorId: string, guidelineVersion: string, reviewerId: string, dueDate: string | undefined, note: string | undefined, env: ReviewEnvironment): Sop {
  assert(!sop.internalReviewRounds?.length, 'Use the internal parallel review request for this SOP')
  const author = env.users.find((u) => u.id === actorId && !u.deletedAt && u.permissions.includes('author') && !u.permissions.includes('admin'))
  assert(author && sop.status === 'draft' && isAuthor(sop, actorId), 'Only the active main author can submit a draft')
  assert(hasCurrentCheck(sop, guidelineVersion), 'Run a compliance check against the current guideline first')
  assert(env.departments.some((d) => d.id === sop.departmentId && !d.removedAt), 'The SOP department is unavailable')
  assert(eligibleReviewers(sop, sop.departmentId, env.users).some((u) => u.id === reviewerId), 'Select exactly one eligible reviewer from the SOP department')
  assert(!note || note.trim().length <= SUBMIT_COMMENT_MAX, 'Submission comments must be at most 1000 characters')
  const flow: ReviewFlow = { stage: 'reviewer-1', reviewer1Id: reviewerId, activeReviewerId: reviewerId, sameDivision: 'pending', crossDivision: 'pending', departments: [] }
  const submitted = assign({ ...sop, status: 'in-review', reviewFlow: flow, reviewers: [], approvers: [], reviewDueDays: undefined, approvalDueDays: undefined, reviewDueAt: undefined, approvalDueAt: undefined }, reviewerId, dueDate)
  return record(submitted, 'submitted', actorId, { recipientIds: [reviewerId], ...(note?.trim() ? { note: note.trim() } : {}) })
}
/** Unconfigured division links never count as a match or a different division. */
export function departmentsForScope(sop: Sop, scope: ReviewScope, departments: Department[]): Department[] {
  const source = departments.find((d) => d.id === sop.departmentId && !d.removedAt)
  if (!source?.divisionId) return []
  return departments.filter((d) => !d.removedAt && d.id !== source.id && !!d.divisionId &&
    (scope === 'same-division' ? d.divisionId === source.divisionId : d.divisionId !== source.divisionId))
}
export function qualityController(sop: Sop, env: ReviewEnvironment): User | undefined {
  const id = env.departments.find((d) => d.id === sop.departmentId && !d.removedAt)?.qualityControllerId
  return env.users.find((u) => u.id === id && !u.deletedAt && !u.permissions.includes('admin') && u.permissions.includes('approver') &&
    !isAuthorOrCoAuthor(sop, u.id) && !sop.reviewers.some((p) => p.userId === u.id))
}
/** Validates explicit administrative configuration without inventing organizational relationships. */
export function validateWorkflowConfiguration(input: DepartmentWorkflowConfiguration, users: User[]): DepartmentWorkflowConfiguration {
  const divisionId = input.divisionId?.trim() || undefined
  assert(!divisionId || divisionId.length <= 80, 'Division identifiers must be at most 80 characters')
  const qualityControllerId = input.qualityControllerId || undefined
  assert(!qualityControllerId || users.some((u) => u.id === qualityControllerId && !u.deletedAt && u.permissions.includes('approver')), 'Select an active user with Approver permission')
  return { divisionId, qualityControllerId }
}
function decisionStage(scope: ReviewScope): 'same-division-decision' | 'cross-division-decision' { return scope === 'same-division' ? 'same-division-decision' : 'cross-division-decision' }
function nextScope(sop: Sop, actorId: string, env: ReviewEnvironment, scope: ReviewScope): Sop {
  const flow = sop.reviewFlow!
  const configured = scope === 'same-division' ? flow.sameDivision : flow.crossDivision
  const pending = flow.departments.find((d) => d.scope === scope && !d.completed)
  if (configured === 'required' && pending) {
    // Revalidate saved plans on every handoff, including resubmission.
    assert(departmentsForScope(sop, scope, env.departments).some((d) => d.id === pending.departmentId), 'Configure the required department division relationship before routing')
    assert(eligibleReviewers(sop, pending.departmentId, env.users).some((u) => u.id === pending.representativeId), 'The selected representative is no longer eligible')
    return handoff(assign(sop, pending.representativeId), { ...flow, stage: scope === 'same-division' ? 'same-division-representative' : 'cross-division-representative' }, actorId, pending.representativeId, pending.departmentId)
  }
  if (configured === 'skipped' || configured === 'required') {
    if (scope === 'same-division') return nextScope(sop, actorId, env, 'cross-division')
    return handoff(sop, { ...flow, stage: 'quality-routing' }, actorId, flow.reviewer2Id!)
  }
  return handoff(sop, { ...flow, stage: decisionStage(scope) }, actorId, flow.reviewer2Id!)
}
function activeDepartmentReview(sop: Sop): DepartmentReview | undefined {
  const flow = sop.reviewFlow
  if (!flow || !(flow.stage.endsWith('-representative') || flow.stage.endsWith('-reviewer'))) return undefined
  const scope = flow.stage.startsWith('same-division') ? 'same-division' : 'cross-division'
  return flow?.departments.find((d) => d.scope === scope && !d.completed)
}
export function currentDepartmentReview(sop: Sop): DepartmentReview | undefined { return activeDepartmentReview(sop) }
export function applyReviewAction(sop: Sop, actorId: string, action: ReviewAction, env: ReviewEnvironment): Sop {
  const flow = sop.reviewFlow
  assert(flow && sop.status === 'in-review' && flow.activeReviewerId === actorId && currentReviewer(sop)?.userId === actorId, 'Only the active reviewer can perform this action')
  const actor = env.users.find((u) => u.id === actorId && !u.deletedAt)
  assert(actor && actor.permissions.includes('reviewer') && !actor.permissions.includes('admin') && !isAuthorOrCoAuthor(sop, actorId), 'An active Reviewer account is required')
  const expectedDepartment = activeDepartmentReview(sop)?.departmentId ?? sop.departmentId
  assert(actor.departmentId === expectedDepartment && env.departments.some((d) => d.id === expectedDepartment && !d.removedAt), 'The active reviewer must still belong to the assigned department')
  if (action.type === 'return-author') {
    assert(action.text.trim() && action.text.length <= 1000, 'A return comment of up to 1000 characters is required')
    return returnAsReviewer(sop, actorId, action.text)
  }
  if (action.type === 'return-review') {
    assert(flow.stage === 'reviewer-2', 'Only Reviewer 2 can request another initial review')
    assert(action.text.trim() && action.text.length <= 1000, 'A return comment of up to 1000 characters is required')
    const commented = feedback(sop, actorId, action.text)
    const comment = commented.comments.at(-1)!
    const updated = withDecision(withDecision(commented, flow.reviewer1Id, 'pending'), actorId, 'pending')
    return record({ ...updated, reviewFlow: { ...flow, stage: 'reviewer-1', activeReviewerId: flow.reviewer1Id } }, 'review-returned', actorId, { recipientIds: [flow.reviewer1Id], commentId: comment.id })
  }
  if (action.type === 'forward') {
    const initial = flow.stage === 'reviewer-1'
    assert(initial || flow.stage === 'same-division-representative' || flow.stage === 'cross-division-representative', 'This step cannot forward to an assigned reviewer')
    const departmentReview = initial ? undefined : activeDepartmentReview(sop)
    const departmentId = initial ? sop.departmentId : departmentReview?.departmentId
    assert(departmentId, 'No department review is active')
    const savedReviewerId = initial ? flow.reviewer2Id : departmentReview?.reviewerId
    assert(!savedReviewerId || action.reviewerId === savedReviewerId, 'Repeat the saved reviewer assignment when restarting a review plan')
    const selectedElsewhere = sop.reviewers.filter((p) => p.userId !== (initial ? flow.reviewer2Id : departmentReview?.reviewerId)).map((p) => p.userId)
    assert(eligibleReviewers(sop, departmentId, env.users, selectedElsewhere).some((u) => u.id === action.reviewerId), 'Select another eligible reviewer from the department')
    let updated = feedback(sop, actorId, action.text)
    updated = record(withDecision(updated, actorId, 'completed'), 'review-completed', actorId, { commentId: action.text?.trim() ? updated.comments.at(-1)?.id : undefined })
    updated = assign(updated, action.reviewerId, action.dueDate)
    const nextFlow: ReviewFlow = initial
      ? { ...flow, reviewer2Id: action.reviewerId, stage: 'reviewer-2' }
      : { ...flow, stage: departmentReview!.scope === 'same-division' ? 'same-division-reviewer' : 'cross-division-reviewer', departments: flow.departments.map((d) => d === departmentReview ? { ...d, reviewerId: action.reviewerId } : d) }
    return handoff(updated, nextFlow, actorId, action.reviewerId, departmentId)
  }
  if (action.type === 'complete') {
    assert(flow.stage === 'reviewer-2' || flow.stage === 'same-division-reviewer' || flow.stage === 'cross-division-reviewer', 'This review must be forwarded to its assigned reviewer first')
    let updated = feedback(sop, actorId, action.text)
    updated = record(withDecision(updated, actorId, 'completed'), 'review-completed', actorId, { commentId: action.text?.trim() ? updated.comments.at(-1)?.id : undefined })
    if (flow.stage === 'reviewer-2') return nextScope(updated, actorId, env, 'same-division')
    const departmentReview = activeDepartmentReview(sop)!
    updated = { ...updated, reviewFlow: { ...flow, departments: flow.departments.map((d) => d === departmentReview ? { ...d, completed: true } : d) } }
    return nextScope(updated, actorId, env, departmentReview.scope)
  }
  if (action.type === 'skip' || action.type === 'department-review') {
    assert(flow.stage === decisionStage(action.scope), 'Complete the earlier review steps first')
    const saved = flow.departments.filter((d) => d.scope === action.scope)
    assert(saved.length === 0, 'Required department reviews cannot be skipped or removed on resubmission')
    const entries: DepartmentReview[] = []
    if (action.type === 'department-review') {
      assert(action.assignments.length > 0, 'Select at least one department and its representative')
      const allowed = departmentsForScope(sop, action.scope, env.departments)
      const selectedUsers = new Set(sop.reviewers.map((p) => p.userId))
      for (const assignment of action.assignments) {
        assert(allowed.some((d) => d.id === assignment.departmentId), 'The selected department needs a configured matching division relationship')
        assert(!entries.some((d) => d.departmentId === assignment.departmentId), 'A department can only be selected once')
        assert(eligibleReviewers(sop, assignment.departmentId, env.users, [...selectedUsers]).some((u) => u.id === assignment.representativeId), 'Choose an eligible representative from the selected department')
        selectedUsers.add(assignment.representativeId)
        entries.push({ ...assignment, scope: action.scope, completed: false })
      }
    }
    const nextFlow = { ...flow, [action.scope === 'same-division' ? 'sameDivision' : 'crossDivision']: entries.length ? 'required' : 'skipped', departments: [...flow.departments, ...entries] } as ReviewFlow
    let updated: Sop = { ...sop, reviewFlow: nextFlow }
    for (const entry of entries) updated = assign(updated, entry.representativeId)
    updated = record(updated, 'review-scope-decided', actorId, { reviewScope: action.scope, reviewsRequired: entries.length > 0, recipientIds: entries.map((e) => e.representativeId) })
    return nextScope(updated, actorId, env, action.scope)
  }
  assert(action.type === 'quality' && flow.stage === 'quality-routing', 'All required reviews must finish before quality approval')
  assert(requiredReviewsComplete(sop), 'Required reviews are incomplete')
  const controller = qualityController(sop, env)
  assert(controller, 'Configure an eligible Quality Document Controller before final approval')
  return record({ ...sop, status: 'in-approval', approvers: [{ userId: controller.id, decision: 'pending' }], reviewFlow: { ...flow, stage: 'quality-approval', qualityControllerId: controller.id } }, 'forwarded-to-approver', actorId, { recipientIds: [controller.id] })
}
