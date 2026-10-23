import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalDecisionSnapshot, ExternalReviewGate, Sop, User } from '../data/mock/types'
import { approvalReadiness, submitForApproval, type ApprovalSubmissionOptions } from './approval'
import { beginInternalReview, cancelInternalReview, decideInternalReview, resubmitInternalReview, startInternalReview } from './internalReview'
import type { ReviewEnvironment } from './reviewFlow'
import { activeApprovalSubmission, approveAs, canResubmit, completeReview, currentDueAt, pendingPeople, publishAs, returnAsApprover, shiftDueDates, submitForReview, uploadVersion } from './workflow'

function person(id: string, permissions: User['permissions'], departmentId = 'home'): User {
  return { id, name: id, email: id + '@example.test', initials: 'TT', permissions, departmentId }
}
function environment(): ReviewEnvironment {
  return {
    users: [person('author', ['author', 'reviewer', 'approver']), person('coauthor', ['author', 'reviewer', 'approver']),
      person('a', ['reviewer']), person('b', ['reviewer']), person('controller', ['approver']), person('external', ['reviewer'], 'other')],
    departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', qualityControllerId: 'controller' },
      { id: 'other', name: 'Other', initials: 'OT', description: '' }],
  }
}
function check(version: string) {
  return { id: 'check-' + version, sopId: 'sop', version, status: 'completed' as const, startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] }
}
function draft(): Sop {
  return { id: 'sop', code: 'SOP-1', title: 'SOP', departmentId: 'home', version: '1', status: 'draft', authorId: 'author', coAuthorIds: ['coauthor'],
    description: 'Keep the existing\nSOP description.', lastUpdated: '2026-10-23', fileName: 'sop.pdf', fileType: 'pdf',
    versions: [{ version: '1', fileName: 'sop.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString() }],
    reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [check('1')] }
}
function requested() { return startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'] }, environment()) }
function decide(sop: Sop, userId: string, decision: 'completed' | 'returned' = 'completed', text?: string): Sop {
  const round = sop.internalReviewRounds!.at(-1)!
  return decideInternalReview(sop, userId, round.id, round.assignments.find((assignment) => assignment.userId === userId)!.id, decision, text, environment())
}
function cancel(sop: Sop, userId: string): Sop {
  const round = sop.internalReviewRounds!.at(-1)!
  return cancelInternalReview(sop, 'author', round.id, round.assignments.find((assignment) => assignment.userId === userId)!.id, environment())
}
function complete(text?: string): Sop { return decide(decide(requested(), 'b'), 'a', 'completed', text) }
function options(sop: Sop): ApprovalSubmissionOptions {
  return { version: sop.version, internalReviewRoundId: sop.internalReviewRounds!.at(-1)!.id, noExternalReviewsRequired: true }
}
function submit(sop = complete(), input: Partial<ApprovalSubmissionOptions> = {}, env = environment()): Sop {
  return submitForApproval(sop, 'author', { ...options(sop), ...input }, env)
}
function snapshot(sop: Sop): ApprovalDecisionSnapshot { return { version: sop.version, approvalSubmissionId: sop.approvalSubmissions!.at(-1)!.id } }
function externalGate(sop: Sop, decision: 'pending' | 'completed' | 'returned' | 'cancelled'): ExternalReviewGate {
  return { version: sop.version, internalReviewRoundId: sop.internalReviewRounds!.at(-1)!.id, requirement: 'required', departmentIds: ['other'],
    assignments: [{ id: 'external-task', departmentId: 'other', userId: 'external', version: sop.version, decision }] }
}
beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 23, 12) }))
afterEach(() => vi.useRealTimers())

describe('Author-controlled approval eligibility', () => {
  it('waits after parallel review, then creates exactly one pending configured controller task with an explicit Author audit', () => {
    const sop = complete()
    const before = JSON.stringify(sop)
    expect(sop.status).toBe('in-review')
    expect(approvalReadiness(sop, 'author', environment())).toMatchObject({ ready: false, requiresExternalConfirmation: true })
    const submitted = submit(sop)
    expect(JSON.stringify(sop)).toBe(before)
    expect(submitted.status).toBe('in-approval')
    expect(submitted.approvers).toEqual([{ id: snapshot(submitted).approvalSubmissionId, version: '1', assignedAt: new Date().toISOString(), userId: 'controller', decision: 'pending' }])
    expect(activeApprovalSubmission(submitted)).toMatchObject({ submittedById: 'author', approverId: 'controller', status: 'pending' })
    expect(submitted.externalReviewGate).toMatchObject({ requirement: 'not-required', confirmedById: 'author', version: '1', internalReviewRoundId: options(sop).internalReviewRoundId })
    expect(submitted.timeline.slice(-2)).toEqual([
      expect.objectContaining({ type: 'external-reviews-not-required', actorId: 'author', approvalSubmissionId: snapshot(submitted).approvalSubmissionId }),
      expect.objectContaining({ type: 'submitted-for-approval', actorId: 'author', recipientIds: ['controller'] }),
    ])
    expect(pendingPeople(submitted)).toEqual([{ userId: 'controller', role: 'approver' }])
    expect(submitted.internalReviewRounds).toEqual(sop.internalReviewRounds)
    expect(submitted.description).toBe(sop.description)
  })

  it('blocks pending, returned, empty and fully cancelled review rounds', () => {
    const pending = decide(requested(), 'a')
    const rejected = decide(requested(), 'a', 'returned', 'Revise the procedure')
    const cancelled = cancel(cancel(requested(), 'a'), 'b')
    const noDecisions = complete(); noDecisions.internalReviewRounds!.at(-1)!.assignments = []
    for (const sop of [pending, rejected, cancelled, noDecisions, { ...complete(), status: 'returned' as const }]) {
      expect(approvalReadiness(sop, 'author', environment(), options(sop)).ready).toBe(false)
      expect(() => submit(sop)).toThrow()
    }
  })

  it('accepts a manually cancelled assignment only after a different required reviewer completed', () => {
    const sop = cancel(decide(requested(), 'a'), 'b')
    expect(submit(sop).status).toBe('in-approval')
    expect(submit(sop).internalReviewRounds!.at(-1)!.assignments[1]).toMatchObject({ decision: 'cancelled', cancellationReason: 'author-cancelled' })
    const malformed = structuredClone(sop)
    malformed.internalReviewRounds!.at(-1)!.assignments[1].cancellationReason = 'round-rejected'
    expect(() => submit(malformed)).toThrow()
  })

  it('blocks a started but unfinished task and cannot infer completion from the pending count', () => {
    const sop = requested(); const round = sop.internalReviewRounds!.at(-1)!
    const started = beginInternalReview(sop, 'a', round.id, round.assignments[0].id, environment())
    expect(() => submit(decide(started, 'b'))).toThrow()
    const cancelled = cancel(cancel(started, 'a'), 'b')
    expect(pendingPeople(cancelled)).toEqual([])
    expect(() => submit(cancelled)).toThrow()
  })

  it('requires explicit feedback acknowledgment and records it without changing historical comments', () => {
    const sop = complete('Please verify the final wording')
    expect(approvalReadiness(sop, 'author', environment(), options(sop))).toMatchObject({ ready: false, requiresFeedbackConfirmation: true })
    expect(() => submit(sop)).toThrow(/feedback/)
    const submitted = submit(sop, { feedbackAddressed: true })
    expect(submitted.comments).toEqual(sop.comments)
    expect(submitted.approvalSubmissions!.at(-1)!.feedbackAddressed).toBe(true)
    expect(submitted.timeline.at(-1)!.note).toMatch(/feedback/)
    expect(approvalReadiness(sop, 'author', environment(), { ...options(sop), feedbackAddressed: true }).requiresFeedbackConfirmation).toBe(true)
  })

  it('requires the active main Author and an available originating department at the mutation boundary', () => {
    const sop = complete()
    for (const actor of ['coauthor', 'a', 'controller', 'missing']) expect(() => submitForApproval(sop, actor, options(sop), environment())).toThrow(/main Author/)
    for (const permissions of [[], ['reviewer'], ['author', 'admin']] satisfies User['permissions'][]) {
      const env = environment(); env.users[0].permissions = permissions
      expect(() => submit(sop, {}, env)).toThrow(/main Author/)
    }
    const deleted = environment(); deleted.users[0].deletedAt = new Date().toISOString()
    expect(() => submit(sop, {}, deleted)).toThrow(/main Author/)
    const removed = environment(); removed.departments[0].removedAt = new Date().toISOString()
    expect(() => submit(sop, {}, removed)).toThrow(/department/)
  })

  it('blocks missing, inactive, unprivileged and conflicted configured controllers', () => {
    const sop = complete()
    for (const id of [undefined, 'missing', 'author', 'coauthor', 'a']) {
      const env = environment(); env.departments[0].qualityControllerId = id
      expect(() => submit(sop, {}, env)).toThrow(/Quality Document Controller/)
    }
    for (const permissions of [[], ['reviewer'], ['approver', 'admin']] satisfies User['permissions'][]) {
      const env = environment(); env.users.find((user) => user.id === 'controller')!.permissions = permissions
      expect(() => submit(sop, {}, env)).toThrow(/Quality Document Controller/)
    }
    const env = environment(); env.users.find((user) => user.id === 'controller')!.deletedAt = new Date().toISOString()
    expect(() => submit(sop, {}, env)).toThrow(/Quality Document Controller/)
  })

  it('rejects stale version, stale round, absent snapshots and duplicate approval submission', () => {
    const sop = complete()
    for (const stale of [{ version: '0' }, { internalReviewRoundId: 'old' }, { version: '' }, { internalReviewRoundId: '' }]) expect(() => submit(sop, stale)).toThrow()
    const staleRound = { ...sop, version: '2' }
    expect(() => submit(staleRound)).toThrow()
    expect(() => submit(submit(sop))).toThrow(/already|stage/)
  })

  it('does not submit a version without a completed compliance check', () => {
    expect(() => submit({ ...complete(), complianceChecks: [] })).toThrow(/compliance/)
    expect(() => submit({ ...complete(), complianceChecks: [{ ...check('1'), status: 'running' }] })).toThrow(/compliance/)
  })
})

describe('external review integration boundary', () => {
  it('does not infer no external reviews from absent assignments and preserves independent confirmations', () => {
    const sop = complete()
    expect(() => submit(sop, { noExternalReviewsRequired: false })).toThrow(/external/)
    expect(submit(sop).externalReviewGate).toMatchObject({ requirement: 'not-required', confirmedById: 'author' })
  })

  it.each(['pending', 'returned', 'cancelled'] as const)('blocks required external review evidence marked %s even if the Author checks no external reviews', (decision) => {
    const sop = complete(); sop.externalReviewGate = externalGate(sop, decision)
    expect(() => submit(sop)).toThrow(/external/)
  })

  it('accepts a completed external integration fixture without creating or altering external assignments', () => {
    const sop = complete(); sop.externalReviewGate = externalGate(sop, 'completed')
    const submitted = submit(sop, { noExternalReviewsRequired: false })
    expect(submitted.status).toBe('in-approval')
    expect(submitted.externalReviewGate).toEqual(sop.externalReviewGate)
    expect(submitted.timeline.some((event) => event.type === 'external-reviews-not-required')).toBe(false)
    expect(activeApprovalSubmission(submitted)).toBeDefined()
  })

  it('blocks incomplete, stale or ineligible external evidence and unresolved external feedback', () => {
    const base = complete()
    const gate = externalGate(base, 'completed')
    if (gate.requirement !== 'required') throw new Error('Expected required fixture')
    const invalid: ExternalReviewGate[] = [
      { ...gate, assignments: [] }, { ...gate, departmentIds: [] }, { ...gate, version: '0' },
      { ...gate, internalReviewRoundId: 'old' }, { ...gate, departmentIds: ['other', 'other'] },
      { ...gate, assignments: [{ ...gate.assignments[0], version: '0' }] },
      { ...gate, assignments: [{ ...gate.assignments[0], userId: 'author' }] },
      { ...gate, assignments: [{ ...gate.assignments[0], feedbackRequired: true }] },
    ]
    for (const externalReviewGate of invalid) expect(() => submit({ ...base, externalReviewGate })).toThrow(/external/)
    const env = environment(); env.users.find((user) => user.id === 'external')!.permissions = []
    expect(() => submit({ ...base, externalReviewGate: gate }, {}, env)).toThrow(/external/)
  })

  it('requires a fresh confirmation for a stale not-required gate, but never silently waives an old required plan', () => {
    const sop = complete()
    sop.externalReviewGate = { requirement: 'not-required', version: '0', internalReviewRoundId: 'old', confirmedById: 'author', confirmedAt: new Date().toISOString() }
    expect(() => submit(sop, { noExternalReviewsRequired: false })).toThrow(/external/)
    expect(submit(sop).externalReviewGate).toMatchObject({ version: sop.version, internalReviewRoundId: options(sop).internalReviewRoundId })
    sop.externalReviewGate = { ...externalGate(sop, 'completed'), version: '0' }
    expect(() => submit(sop)).toThrow(/external/)
  })
})

describe('approval phase transitions with retained parallel review history', () => {
  it('starts the independent approval deadline and keeps review allocations and history intact', () => {
    const sop = complete()
    const submitted = submit(sop, { dueDate: '2026-10-28' })
    expect(submitted.approvalDueDays).toBe(5)
    expect(currentDueAt(submitted)).toBe(new Date('2026-10-28T23:59:59.999').toISOString())
    const shifted = shiftDueDates(submitted, 2)
    expect(currentDueAt(shifted)).toBe(new Date('2026-10-26T23:59:59.999').toISOString())
    expect(shifted.internalReviewRounds).toEqual(sop.internalReviewRounds)
    expect(shifted.approvalDueDays).toBe(5)
    for (const dueDate of ['2026-10-23', '2026-12-01', 'not-a-date']) expect(() => submit(sop, { dueDate })).toThrow(/deadline/)
  })

  it('approves and publishes only the current assigned request and records its history', () => {
    const sop = submit()
    const token = snapshot(sop)
    expect(() => approveAs(sop, 'controller')).toThrow(/Author-controlled/)
    expect(() => approveAs(sop, 'author', undefined, token)).toThrow()
    expect(() => approveAs(sop, 'controller', undefined, { ...token, version: '0' })).toThrow(/stale/)
    expect(() => approveAs(sop, 'controller', undefined, { ...token, approvalSubmissionId: 'old' })).toThrow(/stale/)
    const approved = approveAs(sop, 'controller', 'Ready for publication', token)
    expect(approved.status).toBe('approved')
    expect(approved.approvalSubmissions!.at(-1)).toMatchObject({ status: 'approved', commentId: approved.comments.at(-1)!.id })
    expect(() => approveAs(approved, 'controller', undefined, token)).toThrow()
    expect(() => publishAs(approved, 'controller')).toThrow(/Author-controlled/)
    const published = publishAs(approved, 'controller', token)
    expect(published.status).toBe('published')
    expect(published.approvalSubmissions!.at(-1)!.status).toBe('published')
    expect(published.internalReviewRounds).toEqual(sop.internalReviewRounds)
    expect(published.timeline.at(-1)).toMatchObject({ type: 'published', approvalSubmissionId: token.approvalSubmissionId })
  })

  it('rejects forged phases that lack an explicit handoff or no longer have completed prerequisites', () => {
    expect(() => approveAs({ ...complete(), status: 'in-approval', approvers: [{ userId: 'controller', decision: 'pending' }] }, 'controller')).toThrow(/Author-controlled/)
    const submitted = submit()
    const changedGate = { ...submitted, externalReviewGate: externalGate(submitted, 'pending') }
    expect(() => approveAs(changedGate, 'controller', undefined, snapshot(submitted))).toThrow(/stale/)
  })

  it('returns with a required reason, then requires a revised checked version and a new internal round', () => {
    const sop = submit()
    const token = snapshot(sop)
    expect(() => returnAsApprover(sop, 'controller', ' ', token)).toThrow(/comment/)
    const returned = returnAsApprover(sop, 'controller', 'Revise the controls', token)
    expect(returned.status).toBe('returned')
    expect(returned.approvalSubmissions!.at(-1)).toMatchObject({ status: 'returned', commentId: returned.comments.at(-1)!.id })
    expect(activeApprovalSubmission(returned)).toBeUndefined()
    expect(canResubmit(returned)).toBe(false)
    vi.advanceTimersByTime(1000)
    const revised = uploadVersion(returned, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    expect(canResubmit(revised)).toBe(true)
    expect(() => resubmitInternalReview(revised, 'author', '4.0', environment())).toThrow(/compliance/)
    const checked = { ...revised, complianceChecks: [...revised.complianceChecks, check(revised.version)] }
    const next = resubmitInternalReview(checked, 'author', '4.0', environment())
    expect(next.status).toBe('in-review')
    expect(next.internalReviewRounds).toHaveLength(2)
    expect(next.internalReviewRounds!.at(-1)!.assignments.every((assignment) => assignment.decision === 'pending')).toBe(true)
    expect(next.approvalSubmissions).toEqual(returned.approvalSubmissions)
    expect(() => approveAs(next, 'controller', undefined, token)).toThrow()
    const reviewed = decide(decide(next, 'a'), 'b')
    expect(() => submit(reviewed, { noExternalReviewsRequired: false })).toThrow(/external/)
    const resubmitted = submit(reviewed)
    expect(resubmitted.approvalSubmissions).toHaveLength(2)
    expect(() => approveAs(resubmitted, 'controller', undefined, token)).toThrow(/stale/)
    expect(approveAs(resubmitted, 'controller', undefined, snapshot(resubmitted)).status).toBe('approved')
  })

  it('preserves the legacy sequential review and parallel approval behavior without request snapshots', () => {
    const submitted = submitForReview(draft(), 'author', '4.0', ['a', 'b'], ['controller'], undefined, 5)
    const inApproval = completeReview(completeReview(submitted, 'a'), 'b')
    expect(inApproval.status).toBe('in-approval')
    const approved = approveAs(inApproval, 'controller')
    expect(publishAs(approved, 'controller').status).toBe('published')
    expect(returnAsApprover(inApproval, 'controller', 'Revise').status).toBe('returned')
  })
})
