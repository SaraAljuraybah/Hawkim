import { describe, expect, it } from 'vitest'
import type { InternalReviewRound, Sop } from '../data/mock/types'
import { projectReviewers } from './internalReviewStatus'
import { deriveNotifications } from './notifications'
import { reviewTasks } from './reviews'
import { startReview } from './reviewFlow'
import { approveAs, completeReview, currentDueAt, currentReviewer, internalReviewsComplete, isReviewer, pendingPeople, publishAs, requiredReviewsComplete, resubmit, returnAsReviewer, reviewerDueAt, routeToReviewer, shiftDueDates, submitForReview } from './workflow'

function fixture(): Sop {
  const round: InternalReviewRound = { id: 'round', scope: 'internal', version: '1', status: 'open', requestedById: 'author', requestedAt: '2026-10-23T09:00:00Z', assignedDueDays: 5, dueDate: '2026-10-28', assignments: [
    { id: 'a', userId: 'a', decision: 'pending', assignedAt: '2026-10-23T09:00:00Z', dueDate: '2026-10-25', assignedDueDays: 2 },
    { id: 'b', userId: 'b', decision: 'pending', assignedAt: '2026-10-23T09:00:00Z', assignedDueDays: null },
  ] }
  return { id: 'test', code: 'TEST', title: 'Test', departmentId: 'home', authorId: 'author', coAuthorIds: [], version: '1', status: 'in-review', lastUpdated: '2026-10-23', fileName: 'test.pdf', fileType: 'pdf', versions: [], comments: [], timeline: [], complianceChecks: [], reviewers: projectReviewers(round), approvers: [], internalReviewRounds: [round], reviewDueAt: new Date('2026-10-28T23:59:59.999').toISOString() }
}

describe('internal parallel review compatibility boundaries', () => {
  it('reports all pending reviewers without assigning a single sequential owner', () => {
    const sop = fixture()
    expect(currentReviewer(sop)).toBeUndefined()
    expect(pendingPeople(sop)).toEqual([{ userId: 'a', role: 'reviewer' }, { userId: 'b', role: 'reviewer' }])
    sop.internalReviewRounds![0].assignments[0].decision = 'completed'
    expect(pendingPeople(sop)).toEqual([{ userId: 'b', role: 'reviewer' }])
  })
  it('keeps overall request deadlines independent of individual task dates and explicit blanks', () => {
    const sop = fixture()
    expect(currentDueAt(sop)).toBe(new Date('2026-10-28T23:59:59.999').toISOString())
    expect(reviewerDueAt(sop, sop.reviewers[0])).toBe(new Date('2026-10-25T23:59:59.999').toISOString())
    expect(reviewerDueAt(sop, sop.reviewers[1])).toBeUndefined()
    sop.internalReviewRounds![0].status = 'completed'
    expect(currentDueAt(sop)).toBeUndefined()
    expect(pendingPeople(sop)).toEqual([])
  })
  it('does not count an entirely cancelled request or the wrong document version as completed reviews', () => {
    const sop = fixture()
    const round = sop.internalReviewRounds![0]
    round.status = 'cancelled'
    round.assignments.forEach((assignment) => { assignment.decision = 'cancelled'; assignment.cancellationReason = 'author-cancelled' })
    sop.reviewers = projectReviewers(round)
    expect(requiredReviewsComplete(sop)).toBe(false)
    round.status = 'completed'
    expect(requiredReviewsComplete(sop)).toBe(false)
    round.assignments[0].decision = 'completed'
    sop.reviewers = projectReviewers(round)
    expect(requiredReviewsComplete(sop)).toBe(true)
    sop.version = '2'
    expect(requiredReviewsComplete(sop)).toBe(false)
  })
  it('retains read access for a prior assignee after a different request is created', () => {
    const sop = fixture()
    sop.reviewers = []
    expect(isReviewer(sop, 'a')).toBe(true)
    expect(isReviewer(sop, 'outsider')).toBe(false)
  })
  it('rejects legacy reviewer decisions and routing for parallel requests', () => {
    const sop = fixture()
    expect(() => completeReview(sop, 'a')).toThrow(/internal review/)
    expect(() => returnAsReviewer(sop, 'a', 'Changes')).toThrow(/internal review/)
    expect(() => routeToReviewer(sop, 'a', { id: 'other', departmentId: 'other', permissions: ['reviewer'] })).toThrow(/Internal review/)
  })
  it('prevents legacy submission or approval adapters from rewriting internal request history', () => {
    const sop = fixture()
    const env = { users: [], departments: [] }
    expect(() => submitForReview({ ...sop, status: 'draft' }, 'author', '4', ['a'], ['q'], undefined, undefined)).toThrow(/internal review/)
    expect(() => startReview({ ...sop, status: 'draft' }, 'author', '4', 'a', undefined, undefined, env)).toThrow(/internal parallel/)
    expect(() => resubmit({ ...sop, status: 'returned' }, 'author', '4')).toThrow(/internal review/)
    expect(() => approveAs({ ...sop, status: 'in-approval' }, 'q')).toThrow(/Author-controlled/)
    expect(() => publishAs({ ...sop, status: 'approved' }, 'q')).toThrow(/Internal review/)
  })
  it('shifts only the current round during demo simulation and preserves original allocations', () => {
    const sop = fixture()
    const old = { ...sop.internalReviewRounds![0], id: 'old', status: 'rejected' as const, version: '0' }
    sop.internalReviewRounds = [old, sop.internalReviewRounds![0]]
    const before = JSON.stringify(sop)
    const shifted = shiftDueDates(sop, 2)
    expect(JSON.stringify(sop)).toBe(before)
    expect(shifted.internalReviewRounds![0]).toBe(old)
    expect(shifted.internalReviewRounds![1].dueDate).toBe('2026-10-26')
    expect(shifted.reviewers[0].dueDate).toBe('2026-10-23')
    expect(shifted.reviewers[0].assignedDueDays).toBe(2)
    expect(shifted.internalReviewRounds![1].assignedDueDays).toBe(5)
    expect(shifted.reviewers[1].assignedDueDays).toBeNull()
  })
})

describe('retained internal history and subsequent passive workflow consumers', () => {
  function completed(): Sop {
    const sop = fixture()
    sop.internalReviewRounds![0].status = 'completed'
    sop.internalReviewRounds![0].assignments.forEach((person) => { person.decision = 'completed' })
    // Sop.reviewers is a projection of the round, so refresh it after changing the round.
    sop.reviewers = projectReviewers(sop.internalReviewRounds![0])
    return sop
  }
  it('does not hide a later assigned approver task or reminder behind internal history', () => {
    const sop = completed()
    sop.status = 'in-approval'
    sop.approvers = [{ userId: 'q', decision: 'pending' }]
    sop.approvalDueAt = '2026-10-29T09:00:00Z'
    expect(reviewTasks('q', [sop])[0]).toMatchObject({ role: 'approver', group: 'todo', need: 'approval', dueAt: sop.approvalDueAt })
    expect(deriveNotifications('q', { sops: [sop], requests: [], now: Date.parse('2026-10-30T09:00:00Z') })).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'overdue', stage: 'approval' })]))
    expect(pendingPeople(sop)).toEqual([{ userId: 'q', role: 'approver' }])
    // Historical participation must not overshadow an explicitly current assignment.
    sop.approvers = [{ userId: 'a', decision: 'pending' }]
    expect(reviewTasks('a', [sop])[0]).toMatchObject({ role: 'approver', group: 'todo', need: 'approval' })
    // Passive compatibility never authorizes an out-of-scope entry or approval action.
    expect(() => approveAs(sop, 'q')).toThrow(/Author-controlled/)
  })
  it('does not confuse internal completion with an additional pending assignment, including the same user', () => {
    for (const userId of ['external', 'a']) {
      const sop = completed()
      sop.reviewers = [...sop.reviewers, { userId, decision: 'pending' }]
      expect(internalReviewsComplete(sop)).toBe(true)
      expect(requiredReviewsComplete(sop)).toBe(false)
      sop.reviewers.at(-1)!.decision = 'completed'
      expect(requiredReviewsComplete(sop)).toBe(true)
    }
  })
  it('accepts only an explicit Author waiver as successful-round cancellation evidence', () => {
    const sop = completed()
    const assignment = sop.internalReviewRounds![0].assignments[1]
    assignment.decision = 'cancelled'
    assignment.cancellationReason = 'round-rejected'
    expect(internalReviewsComplete(sop)).toBe(false)
    assignment.cancellationReason = 'author-cancelled'
    expect(requiredReviewsComplete(sop)).toBe(true)
    sop.reviewers = [...sop.reviewers, { userId: 'b', decision: 'cancelled' }]
    expect(requiredReviewsComplete(sop)).toBe(false)
  })
  it('lets an explicit subsequent review plan supply its active task and deadline without changing history', () => {
    const sop = completed()
    const history = JSON.stringify(sop.internalReviewRounds)
    sop.reviewers = [...sop.reviewers, { userId: 'external', decision: 'pending', dueDate: '2026-10-29', assignedDueDays: 6 }]
    sop.reviewFlow = { stage: 'same-division-reviewer', activeReviewerId: 'external', reviewer1Id: 'a', reviewer2Id: 'b', sameDivision: 'required', crossDivision: 'pending', departments: [] }
    expect(currentReviewer(sop)?.userId).toBe('external')
    expect(pendingPeople(sop)).toEqual([{ userId: 'external', role: 'reviewer' }])
    expect(currentDueAt(sop)).toBe(new Date('2026-10-29T23:59:59.999').toISOString())
    expect(reviewTasks('external', [sop])[0]).toMatchObject({ group: 'todo', need: 'review' })
    expect(deriveNotifications('external', { sops: [sop], requests: [], now: Date.parse('2026-10-31T09:00:00Z') })).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'overdue' })]))
    expect(deriveNotifications('author', { sops: [sop], requests: [], now: Date.parse('2026-10-31T09:00:00Z') }).some((item) => item.type === 'request-overdue')).toBe(false)
    expect(requiredReviewsComplete(sop)).toBe(false)
    expect(JSON.stringify(sop.internalReviewRounds)).toBe(history)
    sop.reviewers.at(-1)!.decision = 'cancelled'
    expect(currentReviewer(sop)).toBeUndefined()
    expect(pendingPeople(sop)).toEqual([])
    expect(reviewTasks('external', [sop])[0]).toMatchObject({ group: 'done', decision: 'cancelled' })
    expect(deriveNotifications('external', { sops: [sop], requests: [], now: Date.parse('2026-10-31T09:00:00Z') })).toEqual([])
  })
})
