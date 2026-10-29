import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComplianceCheck, Department, Sop, User } from '../data/mock/types'
import { applyReviewAction, departmentsForScope, eligibleReviewers, keepsRoundDeadline, qualityController, startReview, validateWorkflowConfiguration, type ReviewAction, type ReviewEnvironment } from './reviewFlow'
import { approveAs, assertCanRunCheck, completeReview, currentReviewer, deleteVersion, publishAs, resubmit, returnAsApprover, routeToReviewer, uploadVersion } from './workflow'
import { reviewTasks } from './reviews'
import { deriveNotifications } from './notifications'

/** Fictional fixtures only: these identifiers are not approved organizational assignments. */
function person(id: string, departmentId: string, permissions: User['permissions']): User {
  return { id, departmentId, permissions, name: 'Test ' + id, email: id + '@test.invalid', initials: 'TT' }
}
function environment(): ReviewEnvironment {
  return {
    users: [person('author', 'origin', ['author']), person('coauthor', 'origin', ['author']), person('r1', 'origin', ['reviewer']), person('r2', 'origin', ['reviewer']),
      person('repA', 'a', ['reviewer']), person('assignedA', 'a', ['reviewer']), person('repB', 'b', ['reviewer']), person('assignedB', 'b', ['reviewer']),
      person('repC', 'c', ['reviewer']), person('assignedC', 'c', ['reviewer']), person('controller', 'quality', ['approver']), person('otherApprover', 'quality', ['approver']),
      person('admin', 'origin', ['admin'])],
    departments: [
      { id: 'origin', name: 'Test Origin', initials: 'TO', description: '', divisionId: 'test-division-1', qualityControllerId: 'controller' },
      { id: 'a', name: 'Test A', initials: 'TA', description: '', divisionId: 'test-division-1' },
      { id: 'b', name: 'Test B', initials: 'TB', description: '', divisionId: 'test-division-1' },
      { id: 'c', name: 'Test C', initials: 'TC', description: '', divisionId: 'test-division-2' },
      { id: 'unknown', name: 'Test Unknown', initials: 'TU', description: '' },
      { id: 'quality', name: 'Test Quality', initials: 'TQ', description: '' },
    ],
  }
}
function check(version: string): ComplianceCheck {
  return { id: 'check-' + version, sopId: 'test', version, status: 'completed', startedAt: '2026-10-18T08:00:00Z', guideline: { name: 'GVP', version: '4' }, findings: [] }
}
function draft(): Sop {
  return { id: 'test', code: 'TEST-001', title: 'Fixture SOP', departmentId: 'origin', authorId: 'author', coAuthorIds: ['coauthor'],
    status: 'draft', version: '1', lastUpdated: '2026-10-18', fileName: 'fixture.pdf', fileType: 'pdf', reviewers: [], approvers: [], comments: [], timeline: [],
    versions: [{ version: '1', uploadedAt: '2026-10-18T08:00:00Z', fileName: 'fixture.pdf', fileType: 'pdf', uploadedById: 'author' }], complianceChecks: [check('1')] }
}
const start = (env = environment()) => startReview(draft(), 'author', '4', 'r1', '2026-10-20', 'Submission note', env)
const action = (sop: Sop, act: ReviewAction, env = environment(), actor = sop.reviewFlow!.activeReviewerId) => applyReviewAction(sop, actor, act, env)
function initialReviews(env = environment()): Sop {
  return action(action(start(env), { type: 'forward', reviewerId: 'r2', dueDate: '2026-10-25' }, env), { type: 'complete', text: 'Initial content checked' }, env)
}
function readyForQuality(env = environment()): Sop {
  return action(action(initialReviews(env), { type: 'skip', scope: 'same-division' }, env), { type: 'skip', scope: 'cross-division' }, env)
}
function revised(sop: Sop): Sop {
  vi.advanceTimersByTime(1000)
  const uploaded = uploadVersion(sop, 'coauthor', { fileName: 'new.pdf', fileType: 'pdf' })
  return { ...uploaded, complianceChecks: [...uploaded.complianceChecks, check(uploaded.version)] }
}
function departmentDone(sop: Sop, reviewer: string, env = environment()): Sop {
  return action(action(sop, { type: 'forward', reviewerId: reviewer }, env), { type: 'complete' }, env)
}
beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 18, 12) }))
afterEach(() => vi.useRealTimers())

describe('selected initial reviewers', () => {
  it.each([500, 501, 1000])('preserves %i-character submission comments in the legacy review flow', (length) => {
    const note = 'x'.repeat(length)
    const sop = startReview(draft(), 'author', '4', 'r1', undefined, note, environment())
    expect(sop.timeline.at(-1)?.note).toBe(note)
  })
  it('rejects overlong legacy submission comments without changing the SOP', () => {
    const sop = draft(), before = structuredClone(sop)
    expect(() => startReview(sop, 'author', '4', 'r1', undefined, 'x'.repeat(1001), environment())).toThrow(/1000/)
    expect(sop).toEqual(before)
  })
  it('assigns only the selected first reviewer, optional deadline and comments; no approvers', () => {
    const sop = start()
    expect(sop.reviewers).toEqual([{ userId: 'r1', decision: 'pending', decidedAt: undefined, dueDate: '2026-10-20',
      assignedAt: new Date().toISOString(), reviewDueAt: '2026-10-20T20:59:59.999Z', assignedDueDays: 2 }])
    expect(sop.approvers).toEqual([])
    expect(sop.timeline.at(-1)).toMatchObject({ type: 'submitted', recipientIds: ['r1'], note: 'Submission note' })
    expect(deriveNotifications('r2', { sops: [sop], requests: [], now: Date.now() })).toEqual([])
    expect(startReview(draft(), 'author', '4', 'r1', undefined, undefined, environment()).reviewers[0].assignedDueDays).toBeNull()
  })
  it('requires the main author, current check and an eligible same-department reviewer', () => {
    for (const id of ['', 'repA', 'controller', 'coauthor', 'author']) expect(() => startReview(draft(), 'author', '4', id, undefined, undefined, environment())).toThrow()
    expect(() => startReview(draft(), 'coauthor', '4', 'r1', undefined, undefined, environment())).toThrow()
    expect(() => startReview({ ...draft(), complianceChecks: [] }, 'author', '4', 'r1', undefined, undefined, environment())).toThrow(/compliance/)
    const deniedAuthor = environment(); deniedAuthor.users.find((u) => u.id === 'author')!.permissions = []
    expect(() => start(deniedAuthor)).toThrow(/main author/)
    const env = environment(); env.users.find((u) => u.id === 'r1')!.deletedAt = '2026-01-01'
    expect(() => start(env)).toThrow()
    expect(() => startReview(draft(), 'author', '4', 'r1', '2026-02-30', undefined, environment())).toThrow(/deadline/)
  })
  it('requires Reviewer 1 to complete and select a different eligible Reviewer 2', () => {
    const sop = start()
    for (const id of ['r1', 'repA', 'controller', 'author']) expect(() => action(sop, { type: 'forward', reviewerId: id })).toThrow()
    expect(() => action(sop, { type: 'complete' })).toThrow()
    expect(() => action(sop, { type: 'forward', reviewerId: 'r2' }, environment(), 'r2')).toThrow(/active reviewer/)
    expect(() => completeReview(sop, 'r1')).toThrow(/current review step/)
    expect(() => routeToReviewer(sop, 'r1', environment().users.find((u) => u.id === 'repA')!)).toThrow(/current review step/)
    const next = action(sop, { type: 'forward', reviewerId: 'r2', text: 'First review done' })
    expect(currentReviewer(next)?.userId).toBe('r2')
    expect(next.reviewers.find((p) => p.userId === 'r1')?.decision).toBe('completed')
    expect(next.comments.at(-1)?.text).toBe('First review done')
    expect(deriveNotifications('r2', { sops: [next], requests: [], now: Date.now() }).at(0)).toMatchObject({ type: 'assigned-review', via: 'handoff' })
  })
  it('returns a review to Reviewer 1 with history, notifications and no file-edit permission', () => {
    const reviewed = action(start(), { type: 'forward', reviewerId: 'r2' })
    expect(() => action(reviewed, { type: 'return-review', text: ' ' })).toThrow(/comment/)
    const back = action(reviewed, { type: 'return-review', text: 'Please check the terminology' })
    expect(back.status).toBe('in-review')
    expect(currentReviewer(back)?.userId).toBe('r1')
    expect(back.timeline.at(-1)).toMatchObject({ type: 'review-returned', recipientIds: ['r1'] })
    expect(back.comments.at(-1)?.text).toBe('Please check the terminology')
    expect(() => uploadVersion(back, 'r1', { fileName: 'bad.pdf', fileType: 'pdf' })).toThrow()
    expect(() => assertCanRunCheck(back, 'r1')).toThrow()
    expect(reviewTasks('r1', [back])[0].group).toBe('todo')
    expect(deriveNotifications('r1', { sops: [back], requests: [], now: Date.now() })[0]).toMatchObject({ type: 'assigned-review', via: 'handoff' })
    expect(action(back, { type: 'forward', reviewerId: 'r2' }).reviewFlow?.stage).toBe('reviewer-2')
  })
})

describe('department review decisions and assignments', () => {
  it('distinguishes configured divisions and excludes all unconfigured relationships', () => {
    const env = environment()
    expect(departmentsForScope(draft(), 'same-division', env.departments).map((d) => d.id)).toEqual(['a', 'b'])
    expect(departmentsForScope(draft(), 'cross-division', env.departments).map((d) => d.id)).toEqual(['c'])
    env.departments[0].divisionId = undefined
    expect(departmentsForScope(draft(), 'same-division', env.departments)).toEqual([])
    expect(() => action(initialReviews(), { type: 'department-review', scope: 'same-division', assignments: [{ departmentId: 'a', representativeId: 'repA' }] }, env)).toThrow(/division/)
  })
  it('supports multiple same-division departments followed by cross-division review and Quality', () => {
    let sop = action(initialReviews(), { type: 'department-review', scope: 'same-division', assignments: [{ departmentId: 'a', representativeId: 'repA' }, { departmentId: 'b', representativeId: 'repB' }] })
    expect(currentReviewer(sop)?.userId).toBe('repA')
    expect(reviewTasks('repB', [sop])[0].group).toBe('waiting')
    expect(deriveNotifications('repB', { sops: [sop], requests: [], now: Date.now() })).toEqual([])
    expect(() => action(sop, { type: 'complete' })).toThrow(/forwarded/)
    expect(() => action(sop, { type: 'forward', reviewerId: 'repA' })).toThrow(/another eligible/)
    expect(() => action(sop, { type: 'forward', reviewerId: 'assignedB' })).toThrow(/another eligible/)
    sop = departmentDone(sop, 'assignedA')
    expect(currentReviewer(sop)?.userId).toBe('repB')
    sop = departmentDone(sop, 'assignedB')
    expect(sop.reviewFlow?.stage).toBe('cross-division-decision')
    expect(currentReviewer(sop)?.userId).toBe('r2')
    expect(reviewTasks('r2', [sop])[0].group).toBe('todo')
    sop = action(sop, { type: 'department-review', scope: 'cross-division', assignments: [{ departmentId: 'c', representativeId: 'repC' }] })
    sop = departmentDone(sop, 'assignedC')
    expect(sop.reviewFlow?.stage).toBe('quality-routing')
    expect(sop.reviewFlow?.departments.every((d) => d.completed)).toBe(true)
    expect(publishAs(approveAs(action(sop, { type: 'quality' }), 'controller'), 'controller').status).toBe('published')
  })
  it('supports several cross-division departments and blocks Quality until the last one finishes', () => {
    const env = environment()
    env.departments.push({ id: 'd', name: 'Test D', initials: 'TD', description: '', divisionId: 'test-division-3' })
    env.users.push(person('repD', 'd', ['reviewer']), person('assignedD', 'd', ['reviewer']))
    let sop = action(initialReviews(env), { type: 'skip', scope: 'same-division' }, env)
    sop = action(sop, { type: 'department-review', scope: 'cross-division', assignments: [{ departmentId: 'c', representativeId: 'repC' }, { departmentId: 'd', representativeId: 'repD' }] }, env)
    sop = departmentDone(sop, 'assignedC', env)
    expect(currentReviewer(sop)?.userId).toBe('repD')
    expect(() => action(sop, { type: 'quality' }, env)).toThrow()
    sop = departmentDone(sop, 'assignedD', env)
    expect(action(sop, { type: 'quality' }, env).approvers.map((p) => p.userId)).toEqual(['controller'])
  })

  it('rejects wrong scope, repeated departments, ineligible representatives and inactive actors', () => {
    const sop = initialReviews()
    expect(() => action(sop, { type: 'skip', scope: 'cross-division' })).toThrow(/earlier/)
    for (const assignments of [[{ departmentId: 'c', representativeId: 'repC' }], [{ departmentId: 'a', representativeId: 'r1' }], [{ departmentId: 'unknown', representativeId: 'repA' }], [{ departmentId: 'a', representativeId: 'repA' }, { departmentId: 'a', representativeId: 'repA' }]]) {
      expect(() => action(sop, { type: 'department-review', scope: 'same-division', assignments })).toThrow()
    }
    const env = environment(); env.users.find((u) => u.id === 'r2')!.permissions = []
    expect(() => action(sop, { type: 'skip', scope: 'same-division' }, env)).toThrow(/Reviewer/)
    expect(eligibleReviewers(sop, 'origin', environment().users).map((u) => u.id)).toEqual(['r1', 'r2'])
  })
  it('allows a department reviewer to return document changes to the author', () => {
    const selected = action(initialReviews(), { type: 'department-review', scope: 'same-division', assignments: [{ departmentId: 'a', representativeId: 'repA' }] })
    const assigned = action(selected, { type: 'forward', reviewerId: 'assignedA' })
    const returned = action(assigned, { type: 'return-author', text: 'Revise the document' })
    expect(returned.status).toBe('returned')
    expect(returned.timeline.at(-1)).toMatchObject({ type: 'returned', recipientIds: ['author', 'coauthor'] })
    expect(returned.comments.at(-1)?.text).toBe('Revise the document')
    expect(() => action(assigned, { type: 'return-review', text: 'Wrong return' })).toThrow(/Reviewer 2/)
  })
})

describe('Quality approval and publication', () => {
  it('blocks missing, deleted, unauthorized or conflicting controllers without guessing', () => {
    const sop = readyForQuality()
    for (const controller of [undefined, 'r1', 'author', 'missing']) {
      const env = environment(); env.departments[0].qualityControllerId = controller
      expect(qualityController(sop, env)).toBeUndefined()
      expect(() => action(sop, { type: 'quality' }, env)).toThrow(/configure/i)
    }
    for (const id of ['author', 'coauthor', 'r1']) {
      const conflict = environment(); conflict.users.find((u) => u.id === id)!.permissions.push('approver'); conflict.departments[0].qualityControllerId = id
      expect(qualityController(sop, conflict)).toBeUndefined()
    }
    const env = environment(); env.users.find((u) => u.id === 'controller')!.deletedAt = '2026-01-01'
    expect(() => action(sop, { type: 'quality' }, env)).toThrow()
    expect(sop.status).toBe('in-review')
  })
  it('requires all decisions and completed reviews, then only the configured controller approves and publishes', () => {
    expect(() => action(start(), { type: 'quality' })).toThrow()
    const awaiting = action(readyForQuality(), { type: 'quality' })
    expect(awaiting.status).toBe('in-approval')
    expect(awaiting.approvers).toEqual([{ userId: 'controller', decision: 'pending' }])
    expect(() => approveAs(awaiting, 'otherApprover')).toThrow()
    expect(() => publishAs(awaiting, 'controller')).toThrow()
    const approved = approveAs(awaiting, 'controller', 'Quality approved')
    expect(approved.status).toBe('approved')
    expect(() => publishAs(approved, 'otherApprover')).toThrow()
    expect(publishAs(approved, 'controller').status).toBe('published')
    const incomplete = { ...awaiting, reviewFlow: { ...awaiting.reviewFlow!, crossDivision: 'pending' as const } }
    expect(() => approveAs(incomplete, 'controller')).toThrow(/required reviews/)
    expect(deriveNotifications('controller', { sops: [awaiting], requests: [], now: Date.now() })[0].type).toBe('assigned-approval')
    expect(deriveNotifications('otherApprover', { sops: [awaiting], requests: [], now: Date.now() })).toEqual([])
  })
  it('allows the controller to return to the author with preserved feedback', () => {
    const sop = returnAsApprover(action(readyForQuality(), { type: 'quality' }), 'controller', 'Quality correction')
    expect(sop.status).toBe('returned')
    expect(sop.comments.at(-1)?.text).toBe('Quality correction')
    expect(() => resubmit(sop, 'author', '4')).toThrow(/new version/)
  })
})

describe('resubmission and configuration', () => {
  it('requires a new version and current compliance check, protects submitted versions and clears earlier deadlines', () => {
    const returned = action(initialReviews(), { type: 'return-author', text: 'Change content' })
    expect(() => resubmit(returned, 'author', '4')).toThrow(/new version/)
    vi.advanceTimersByTime(1000)
    const uploaded = uploadVersion(returned, 'coauthor', { fileName: 'v2.pdf', fileType: 'pdf' })
    expect(() => resubmit(uploaded, 'author', '4')).toThrow(/compliance/)
    expect(() => deleteVersion(uploaded, 'author', '1')).toThrow(/previously submitted/)
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    const again = resubmit({ ...uploaded, complianceChecks: [...uploaded.complianceChecks, check('2')] }, 'author', '4', undefined, '2026-10-30')
    expect(again.reviewFlow?.stage).toBe('reviewer-1')
    expect(currentReviewer(again)?.userId).toBe('r1')
    // Only Reviewer 1 gets the new date; Reviewer 2's earlier deadline isn't reused.
    expect(again.reviewers.map((p) => p.assignedDueDays)).toEqual([2, null])
    expect(again.reviewers.map((p) => p.dueDate)).toEqual(['2026-10-30', undefined])
    expect(again.reviewers.every((p) => p.decision === 'pending' && p.decidedAt === undefined)).toBe(true)
    expect(again.approvers).toEqual([])
    expect(again.comments).toEqual(returned.comments)
  })
  it('lets Reviewer 1 give the saved Reviewer 2 a new deadline after a resubmit, but keeps it within a round', () => {
    const returned = action(initialReviews(), { type: 'return-author', text: 'Change content' })
    vi.setSystemTime(new Date(2026, 9, 28, 12))
    const again = resubmit(revised(returned), 'author', '4')
    expect(again.reviewers.every((p) => p.dueDate === undefined && p.assignedDueDays === null)).toBe(true)
    expect(keepsRoundDeadline(again, 'r2')).toBe(false) // the Forward dialog's date field is enabled
    const forwarded = action(again, { type: 'forward', reviewerId: 'r2', dueDate: '2026-11-02' })
    expect(forwarded.reviewers.find((p) => p.userId === 'r2')).toMatchObject({ dueDate: '2026-11-02', assignedDueDays: 5 })
    // Within the round: Reviewer 2 returns it to Reviewer 1, who forwards it again.
    const back = action(forwarded, { type: 'return-review', text: 'Check section 2 again' })
    expect(keepsRoundDeadline(back, 'r2')).toBe(true) // the date field is disabled, with the note
    expect(() => action(back, { type: 'forward', reviewerId: 'r2', dueDate: '2026-11-05' })).toThrow(/already set/)
    const kept = action(back, { type: 'forward', reviewerId: 'r2' })
    expect(kept.reviewers.find((p) => p.userId === 'r2')?.dueDate).toBe('2026-11-02')
  })
  it('replays every required department review after Quality returns and cannot skip saved requirements', () => {
    let sop = action(initialReviews(), { type: 'department-review', scope: 'same-division', assignments: [{ departmentId: 'a', representativeId: 'repA' }, { departmentId: 'b', representativeId: 'repB' }] })
    sop = departmentDone(departmentDone(sop, 'assignedA'), 'assignedB')
    sop = action(sop, { type: 'department-review', scope: 'cross-division', assignments: [{ departmentId: 'c', representativeId: 'repC' }] })
    sop = departmentDone(sop, 'assignedC')
    const returned = returnAsApprover(action(sop, { type: 'quality' }), 'controller', 'Update needed')
    let again = resubmit(revised(returned), 'author', '4')
    expect(again.reviewFlow?.departments.every((d) => !d.completed)).toBe(true)
    again = action(action(again, { type: 'forward', reviewerId: 'r2' }), { type: 'complete' })
    expect(currentReviewer(again)?.userId).toBe('repA')
    expect(() => action(again, { type: 'skip', scope: 'same-division' })).toThrow()
    again = departmentDone(departmentDone(again, 'assignedA'), 'assignedB')
    expect(currentReviewer(again)?.userId).toBe('repC')
    again = departmentDone(again, 'assignedC')
    expect(again.reviewFlow?.stage).toBe('quality-routing')
  })
  it('reconsiders previously skipped scopes after document changes without losing required departments', () => {
    const returned = returnAsApprover(action(readyForQuality(), { type: 'quality' }), 'controller', 'New content needed')
    const again = resubmit(revised(returned), 'author', '4')
    const reviewed = action(action(again, { type: 'forward', reviewerId: 'r2' }), { type: 'complete' })
    expect(reviewed.reviewFlow?.stage).toBe('same-division-decision')
    expect(reviewed.reviewFlow?.crossDivision).toBe('pending')
  })

  it('validates explicit configuration without assigning organizational data', () => {
    expect(validateWorkflowConfiguration({}, environment().users)).toEqual({ divisionId: undefined, qualityControllerId: undefined })
    expect(validateWorkflowConfiguration({ divisionId: '  approved-id  ', qualityControllerId: 'controller' }, environment().users)).toEqual({ divisionId: 'approved-id', qualityControllerId: 'controller' })
    expect(() => validateWorkflowConfiguration({ qualityControllerId: 'r1' }, environment().users)).toThrow(/Approver/)
    expect(() => validateWorkflowConfiguration({ divisionId: 'a'.repeat(81) }, environment().users)).toThrow()
    const unknown: Department = { id: 'new', name: 'Test', initials: 'TT', description: '' }
    expect(unknown.divisionId).toBeUndefined()
  })
})
