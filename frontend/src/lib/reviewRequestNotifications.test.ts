import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sop, User } from '../data/mock/types'
import { acceptInternalReview, currentInternalRound, decideInternalReview, declineInternalReview, removeInternalReviewer, startInternalReview, withdrawUnanswered } from './internalReview'
import { latestAssignmentOf } from './internalReviewStatus'
import { endOfRiyadhDay } from './riyadhWorkingDays'
import { deriveNotifications, isDueNotification, type AppNotification } from './notifications'

function person(id: string, permissions: User['permissions']): User {
  return { id, name: id, email: id + '@example.test', initials: 'TT', permissions, departmentId: 'home' }
}
const env = () => ({ users: [person('author', ['author']), person('coauthor', ['author']), person('a', ['reviewer']), person('b', ['reviewer'])], departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }] })
function draft(): Sop {
  return { id: 'test', code: 'TEST', title: 'Notifications', version: '1', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'], status: 'draft', lastUpdated: '2026-10-23', fileName: 'test.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString() }], reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [{ id: 'check', sopId: 'test', version: '1', status: 'completed', startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] }] }
}
const start = () => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'], reviewDurationDays: 2 }, env())
const id = (sop: Sop, userId: string) => latestAssignmentOf(currentInternalRound(sop), userId)!.id
const accept = (sop: Sop, userId: string) => acceptInternalReview(sop, userId, currentInternalRound(sop)!.id, id(sop, userId), env())
function of(userId: string, sop: Sop, type: AppNotification['type'], now = Date.now()) {
  return deriveNotifications(userId, { sops: [sop], requests: [], now }).filter((item) => item.type === type)
}
beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-23T12:00:00+03:00') }))
afterEach(() => vi.useRealTimers())

describe('internal review request notifications', () => {
  it('tells the author and co-authors when a reviewer declines, with the reason', () => {
    const started = start()
    const sop = declineInternalReview(started, 'a', currentInternalRound(started)!.id, id(started, 'a'), 'On leave', env())
    for (const user of ['author', 'coauthor']) expect(of(user, sop, 'review-declined')).toEqual([expect.objectContaining({ actorId: 'a', reason: 'On leave', link: '/my-sops/test' })])
    expect(of('b', sop, 'review-declined')).toEqual([])
  })
  it('tells the author and the reviewer when a request is withdrawn', () => {
    const sop = withdrawUnanswered(start(), Date.parse(endOfRiyadhDay('2026-10-26')))
    expect(of('author', sop, 'review-withdrawn')).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: 'a', forReviewer: false }), expect.objectContaining({ actorId: 'b', forReviewer: false })]))
    expect(of('a', sop, 'review-withdrawn')).toEqual([expect.objectContaining({ actorId: 'a', forReviewer: true, link: '/reviews/test' })])
    expect(of('coauthor', sop, 'review-withdrawn')).toEqual([])
  })
  it('tells a removed reviewer who removed them and why', () => {
    const started = start()
    const sop = removeInternalReviewer(started, 'author', currentInternalRound(started)!.id, id(started, 'a'), 'Asked someone else', env())
    expect(of('a', sop, 'reviewer-removed')).toEqual([expect.objectContaining({ actorId: 'author', reason: 'Asked someone else' })])
    expect(of('b', sop, 'reviewer-removed')).toEqual([])
  })
  it('tells the author about each completion and the phase being done, and author and co-authors about a return', () => {
    let sop = accept(accept(start(), 'a'), 'b')
    sop = decideInternalReview(sop, 'a', currentInternalRound(sop)!.id, id(sop, 'a'), 'completed', undefined, env())
    expect(of('author', sop, 'review-completed')).toEqual([expect.objectContaining({ actorId: 'a' })])
    expect(of('coauthor', sop, 'review-completed')).toEqual([])
    expect(of('author', sop, 'internal-review-completed')).toEqual([])
    const done = decideInternalReview(sop, 'b', currentInternalRound(sop)!.id, id(sop, 'b'), 'completed', undefined, env())
    expect(of('author', done, 'review-completed')).toHaveLength(2)
    expect(of('author', done, 'internal-review-completed')).toHaveLength(1)
    const returned = decideInternalReview(sop, 'b', currentInternalRound(sop)!.id, id(sop, 'b'), 'returned', 'Please revise', env())
    for (const user of ['author', 'coauthor']) expect(of(user, returned, 'review-returned')).toEqual([expect.objectContaining({ actorId: 'b' })])
  })
  it('reminds reviewers 24 hours before the response due date and before the review due date', () => {
    const sop = start()
    expect(of('a', sop, 'due-soon', new Date('2026-10-25T23:00:00+03:00').getTime())).toHaveLength(0)
    expect(of('a', sop, 'due-soon', new Date('2026-10-26T08:00:00+03:00').getTime())).toEqual([expect.objectContaining({ phase: 'response' })])
    const accepted = accept(sop, 'a')
    expect(of('a', accepted, 'due-soon', new Date('2026-10-26T08:00:00+03:00').getTime())).toEqual([expect.objectContaining({ phase: 'review' })])
  })
  it('tells the author and the reviewer once an accepted review is overdue', () => {
    const accepted = accept(start(), 'a')
    const late = Date.parse(endOfRiyadhDay('2026-10-26'))
    expect(of('author', accepted, 'review-overdue', late)).toEqual([expect.objectContaining({ actorId: 'a', link: '/my-sops/test' })])
    expect(of('a', accepted, 'overdue', late)).toEqual([expect.objectContaining({ phase: 'review' })])
    expect(of('author', accepted, 'review-overdue', late - 1)).toEqual([])
    expect(isDueNotification('review-overdue')).toBe(true)
  })
})
