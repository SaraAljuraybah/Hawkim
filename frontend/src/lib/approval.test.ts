import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApprovalDecisionSnapshot, Sop, User } from '../data/mock/types'
import { approvalButtonBlocker, approvalReadiness, eligibleApprovers, submitForApproval, type ApprovalSubmissionOptions } from './approval'
import { acceptInternalReview, decideInternalReview, canSendNewVersion, removeInternalReviewer, sendNewVersionForReview, startInternalReview } from './internalReview'
import type { ReviewEnvironment } from './reviewFlow'
import { activeApprovalSubmission, approveAs, completeReview, currentDueAt, publishAs, returnAsApprover, submitForReview, uploadVersion } from './workflow'

function person(id: string, permissions: User['permissions'], departmentId = 'home'): User {
  return { id, name: id, email: id + '@example.test', initials: 'TT', permissions, departmentId }
}
function environment(): ReviewEnvironment {
  return {
    users: [person('author', ['author', 'reviewer', 'approver']), person('coauthor', ['author', 'reviewer', 'approver']),
      person('a', ['reviewer']), person('b', ['reviewer']), person('controller', ['approver'], 'quality'), person('second', ['approver'], 'quality'),
      person('external', ['reviewer'], 'other')],
    departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true },
      { id: 'other', name: 'Other', initials: 'OT', description: '' }, { id: 'quality', name: 'Quality Assurance', initials: 'QA', description: '', isQuality: true }],
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
/** Reviewers accept before deciding. */
function accept(sop: Sop, userId: string): Sop {
  const round = sop.internalReviewRounds!.at(-1)!, assignment = round.assignments.find((item) => item.userId === userId)!
  return assignment.decision === 'pending' ? acceptInternalReview(sop, userId, round.id, assignment.id, environment()) : sop
}
function decide(source: Sop, userId: string, decision: 'completed' | 'returned' = 'completed', text?: string): Sop {
  const sop = accept(source, userId)
  const round = sop.internalReviewRounds!.at(-1)!
  return decideInternalReview(sop, userId, round.id, round.assignments.find((assignment) => assignment.userId === userId)!.id, decision, text, environment())
}
function cancel(sop: Sop, userId: string): Sop {
  const round = sop.internalReviewRounds!.at(-1)!
  return removeInternalReviewer(sop, 'author', round.id, round.assignments.find((assignment) => assignment.userId === userId)!.id, 'No longer needed', environment())
}
function complete(text?: string): Sop { return decide(decide(requested(), 'b'), 'a', 'completed', text) }
function options(sop: Sop): ApprovalSubmissionOptions {
  return { version: sop.version, internalReviewRoundId: sop.internalReviewRounds!.at(-1)!.id, approverId: 'controller' }
}
function submit(sop = complete(), input: Partial<ApprovalSubmissionOptions> = {}, env = environment()): Sop {
  return submitForApproval(sop, 'author', { ...options(sop), ...input }, env)
}
function snapshot(sop: Sop): ApprovalDecisionSnapshot { return { version: sop.version, approvalSubmissionId: sop.approvalSubmissions!.at(-1)!.id } }
beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 23, 12) }))
afterEach(() => vi.useRealTimers())

describe('Submit for approval: one completed review of the current version', () => {
  it('is available as soon as one reviewer completed, and leaves the other requests open', () => {
    const sop = decide(accept(requested(), 'b'), 'a') // a completed; b accepted and still reviewing
    expect(approvalButtonBlocker(sop)).toBeUndefined()
    const before = JSON.stringify(sop)
    const submitted = submit(sop)
    expect(JSON.stringify(sop)).toBe(before)
    expect(submitted.status).toBe('in-approval')
    expect(submitted.approvers).toEqual([{ id: snapshot(submitted).approvalSubmissionId, version: '1', assignedAt: new Date().toISOString(), userId: 'controller', decision: 'pending' }])
    expect(activeApprovalSubmission(submitted)).toMatchObject({ submittedById: 'author', approverId: 'controller', status: 'pending' })
    expect(submitted.internalReviewRounds).toEqual(sop.internalReviewRounds)
    expect(submitted.internalReviewRounds!.at(-1)!.assignments.find((item) => item.userId === 'b')!.decision).toBe('accepted')
    expect(submitted.externalReviewGate).toBeUndefined()
    expect(submitted.timeline.at(-1)).toMatchObject({ type: 'submitted-for-approval', actorId: 'author', recipientIds: ['controller'] })
    expect(submitted.description).toBe(sop.description)
    // The approver can decide while the other reviewer is still reviewing.
    expect(approveAs(submitted, 'controller', undefined, snapshot(submitted)).status).toBe('approved')
  })

  it('also works with a pending reviewer, a return with comments, no compliance check and unconfirmed feedback', () => {
    const pending = decide(requested(), 'a')
    const returned = decide(decide(requested(), 'a', 'completed', 'Tidy the wording'), 'b', 'returned', 'Revise section 4')
    const unchecked = { ...complete(), complianceChecks: [] }
    for (const sop of [pending, returned, unchecked]) {
      expect(approvalButtonBlocker(sop)).toBeUndefined()
      expect(submit(sop).status).toBe('in-approval')
    }
  })

  it('needs a completed review of the current version', () => {
    const removedAfterCompleting = cancel(decide(requested(), 'a'), 'a')
    const onlyReturned = decide(requested(), 'a', 'returned', 'Revise')
    vi.advanceTimersByTime(1000)
    const newVersion = uploadVersion(decide(decide(requested(), 'a'), 'b', 'returned', 'Revise'), 'author', { fileName: 'v2.pdf', fileType: 'pdf' })
    const oldRoundCompleted = { ...complete(), version: '2', versions: [...complete().versions, { version: '2', fileName: 'v2.pdf', fileType: 'pdf' as const, uploadedAt: new Date().toISOString() }] }
    for (const sop of [draft(), requested(), accept(requested(), 'a'), removedAfterCompleting, onlyReturned, newVersion, oldRoundCompleted]) {
      expect(approvalButtonBlocker(sop)).toBe('no-completed-review')
      expect(() => submitForApproval(sop, 'author', { version: sop.version, internalReviewRoundId: sop.internalReviewRounds?.at(-1)?.id ?? 'none', approverId: 'controller' }, environment()))
        .toThrow(/At least one reviewer must complete/)
    }
  })

  it('is refused once sent, including a version this browser remembers sending', () => {
    const submitted = submit()
    expect(approvalButtonBlocker(submitted)).toBe('already-requested')
    expect(() => submit(submitted)).toThrow(/Already sent for approval/)
    expect(approvalButtonBlocker(complete(), true)).toBe('already-requested')
    expect(() => submit(complete(), { sentBefore: true })).toThrow(/Already sent for approval/)
    const approved = approveAs(submitted, 'controller', undefined, snapshot(submitted))
    expect(approvalButtonBlocker(approved)).toBe('already-requested')
  })

  it('can be sent again after the approver returns the same version', () => {
    const submitted = submit()
    const returned = returnAsApprover(submitted, 'controller', 'Revise the controls', snapshot(submitted))
    expect(approvalButtonBlocker(returned)).toBeUndefined()
    const again = submit(returned)
    expect(again.status).toBe('in-approval')
    expect(again.approvalSubmissions).toHaveLength(2)
    expect(approveAs(again, 'controller', undefined, snapshot(again)).status).toBe('approved')
  })

  it('offers only active Approvers of the Quality department who are not an author, co-author, reviewer or admin', () => {
    const sop = complete()
    expect(eligibleApprovers(sop, environment()).map((user) => user.id)).toEqual(['controller', 'second'])
    const env = environment()
    env.users.push(person('home-approver', ['approver']), person('admin-approver', ['approver', 'admin'], 'quality'), person('quality-reviewer', ['reviewer'], 'quality'))
    env.users.find((user) => user.id === 'second')!.deletedAt = new Date().toISOString()
    const reviewer = env.users.find((user) => user.id === 'a')!
    reviewer.departmentId = 'quality'
    reviewer.permissions = ['reviewer', 'approver']
    env.users.find((user) => user.id === 'coauthor')!.departmentId = 'quality'
    // A reviewer of the SOP (a), the co-author, an admin, a deleted user and other departments are left out.
    expect(eligibleApprovers(sop, env).map((user) => user.id)).toEqual(['controller'])
  })

  it('uses the chosen approver, and refuses a missing or ineligible choice', () => {
    const sop = complete()
    const chosen = submit(sop, { approverId: 'second' })
    expect(activeApprovalSubmission(chosen)).toMatchObject({ approverId: 'second' })
    expect(chosen.approvers).toMatchObject([{ userId: 'second', decision: 'pending' }])
    expect(chosen.timeline.at(-1)).toMatchObject({ type: 'submitted-for-approval', recipientIds: ['second'] })
    expect(approvalReadiness(sop, 'author', environment(), { ...options(sop), approverId: '' }).blockers).toEqual(['approver-required'])
    expect(() => submit(sop, { approverId: undefined })).toThrow('Select an approver.')
    for (const approverId of ['a', 'author', 'external', 'missing']) {
      expect(approvalReadiness(sop, 'author', environment(), { ...options(sop), approverId }).blockers).toEqual(['approver-not-eligible'])
      expect(() => submit(sop, { approverId })).toThrow(/approve this SOP/)
    }
  })

  it('assumes an approver for the button, but the submit step refuses when nobody is eligible', () => {
    const sop = complete()
    const invalid: ReviewEnvironment[] = []
    const noQuality = environment(); noQuality.departments[2].isQuality = false; invalid.push(noQuality)
    const removed = environment(); removed.departments[2].removedAt = new Date().toISOString(); invalid.push(removed)
    const nobody = environment(); nobody.users = nobody.users.filter((user) => user.departmentId !== 'quality'); invalid.push(nobody)
    expect(approvalButtonBlocker(sop)).toBeUndefined()
    for (const env of invalid) {
      expect(approvalReadiness(sop, 'author', env, options(sop)).blockers).toEqual(['no-approver'])
      expect(() => submit(sop, {}, env)).toThrow('No approver is available. Contact your admin.')
    }
  })

  it('requires the active main Author at the mutation boundary', () => {
    const sop = complete()
    for (const actor of ['coauthor', 'a', 'controller', 'missing']) expect(() => submitForApproval(sop, actor, options(sop), environment())).toThrow(/main Author/)
    for (const permissions of [[], ['reviewer'], ['author', 'admin']] satisfies User['permissions'][]) {
      const env = environment(); env.users[0].permissions = permissions
      expect(() => submit(sop, {}, env)).toThrow(/main Author/)
    }
    const deleted = environment(); deleted.users[0].deletedAt = new Date().toISOString()
    expect(() => submit(sop, {}, deleted)).toThrow(/main Author/)
  })

  it('rejects a stale version or round and absent snapshots', () => {
    const sop = complete()
    for (const stale of [{ version: '0' }, { internalReviewRoundId: 'old' }, { version: '' }, { internalReviewRoundId: '' }]) expect(() => submit(sop, stale)).toThrow()
    expect(approvalReadiness(sop, 'author', environment(), { ...options(sop), version: '9' }).blockers).toEqual(['version-changed'])
  })

  it('gives one code per reason, in the same order', () => {
    for (const sop of [draft(), requested(), complete(), submit()]) {
      const result = approvalReadiness(sop, 'author', environment(), { approverId: 'missing', note: 'x'.repeat(501) })
      expect(result.blockers).toHaveLength(result.reasons.length)
    }
    expect(approvalReadiness(complete(), 'author', environment())).toMatchObject({ ready: true, blockers: [], reasons: [] })
    const ready = complete()
    expect(approvalReadiness(ready, 'author', environment(), { ...options(ready), note: 'x'.repeat(501) }).blockers).toEqual(['note-too-long'])
  })
})

describe('approval phase transitions with retained parallel review history', () => {
  it('sends the comment with the request, sets no approval deadline and keeps review history intact', () => {
    const sop = complete()
    const submitted = submit(sop, { note: '  Please check the labels.  ' })
    expect(activeApprovalSubmission(submitted)).toMatchObject({ note: 'Please check the labels.', assignedDueDays: null })
    expect(activeApprovalSubmission(submitted)).not.toHaveProperty('dueDate')
    expect(submitted.timeline.at(-1)).toMatchObject({ type: 'submitted-for-approval', note: 'Please check the labels.' })
    expect(submitted.timeline.some((event) => event.type === 'stage-due-date-set')).toBe(false)
    expect(submitted.approvalDueDays).toBeUndefined()
    expect(currentDueAt(submitted)).toBeUndefined()
    expect(submitted.internalReviewRounds).toEqual(sop.internalReviewRounds)
    const plain = submit(sop, { note: '   ' })
    expect(activeApprovalSubmission(plain)).not.toHaveProperty('note')
    expect(plain.timeline.at(-1)).not.toHaveProperty('note')
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

  it('rejects forged phases that lack an explicit handoff or no longer have a completed review', () => {
    expect(() => approveAs({ ...complete(), status: 'in-approval', approvers: [{ userId: 'controller', decision: 'pending' }] }, 'controller')).toThrow(/Author-controlled/)
    const submitted = submit(decide(requested(), 'a'))
    // Forged: the only completed request is no longer completed.
    const forged = structuredClone(submitted)
    forged.internalReviewRounds!.at(-1)!.assignments[0].decision = 'removed'
    expect(() => approveAs(forged, 'controller', undefined, snapshot(submitted))).toThrow(/stale/)
  })

  it('returns with a required reason, then sends a revised checked version to the chosen reviewers as a new round', () => {
    const sop = submit()
    const token = snapshot(sop)
    expect(() => returnAsApprover(sop, 'controller', ' ', token)).toThrow(/comment/)
    const returned = returnAsApprover(sop, 'controller', 'Revise the controls', token)
    expect(returned.status).toBe('returned')
    expect(returned.approvalSubmissions!.at(-1)).toMatchObject({ status: 'returned', commentId: returned.comments.at(-1)!.id })
    expect(activeApprovalSubmission(returned)).toBeUndefined()
    expect(canSendNewVersion(returned)).toBe(false)
    vi.advanceTimersByTime(1000)
    const revised = uploadVersion(returned, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    expect(canSendNewVersion(revised)).toBe(true)
    expect(() => sendNewVersionForReview(revised, 'author', '4.0', { reviewerIds: ['a', 'b'] }, environment())).toThrow(/compliance/)
    const checked = { ...revised, complianceChecks: [...revised.complianceChecks, check(revised.version)] }
    const next = sendNewVersionForReview(checked, 'author', '4.0', { reviewerIds: ['a', 'b'] }, environment())
    expect(next.status).toBe('in-review')
    expect(next.internalReviewRounds).toHaveLength(2)
    expect(next.internalReviewRounds!.at(-1)!.assignments.every((assignment) => assignment.decision === 'pending')).toBe(true)
    expect(next.approvalSubmissions).toEqual(returned.approvalSubmissions)
    expect(() => approveAs(next, 'controller', undefined, token)).toThrow()
    const reviewed = decide(decide(next, 'a'), 'b')
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
