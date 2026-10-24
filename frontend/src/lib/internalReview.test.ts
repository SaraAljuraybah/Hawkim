import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sop, User } from '../data/mock/types'
import { acceptInternalReview, cancelInternalReview, currentInternalRound, decideInternalReview, declineInternalReview, isInternalReviewPending, resubmitInternalReview, startInternalReview } from './internalReview'
import { deriveNotifications } from './notifications'
import { reviewTasks } from './reviews'
import { deleteBlockers, permissionChangeBlockers, sopsUsing } from './userAdmin'
import { canResubmit, dueAtOfDate, isOverdue, pendingPeople, requiredReviewsComplete, reviewAssignedMilliseconds, reviewerAssignedDays, reviewerAssignedMilliseconds, reviewerDeadlinePassed, reviewerRemainingDays, reviewerRemainingMilliseconds, shiftDueDates, uploadVersion } from './workflow'

function person(id: string, permissions: User['permissions'] = ['reviewer'], departmentId = 'home'): User {
  return { id, name: id, email: id + '@example.test', initials: 'TT', permissions, departmentId }
}
const env = () => ({ users: [person('author', ['author', 'reviewer']), person('coauthor', ['author', 'reviewer']), person('a'), person('b'), person('c'), person('other', ['reviewer'], 'other'), person('admin', ['admin', 'reviewer'])], departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }] })
const check = (version: string) => ({ id: 'check-' + version, sopId: 'test', version, status: 'completed' as const, startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] })
function draft(): Sop {
  return { id: 'test', code: 'TEST', title: 'Test SOP', version: '1', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'], status: 'draft', lastUpdated: '2026-10-23', fileName: 'test.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString() }], reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [check('1')] }
}
const start = () => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b', 'c'], dueDate: '2026-10-28' }, env())
function task(sop: Sop, userId: string) { return currentInternalRound(sop)!.assignments.find((assignment) => assignment.userId === userId)! }
function accept(sop: Sop, userId: string) { return acceptInternalReview(sop, userId, currentInternalRound(sop)!.id, task(sop, userId).id, env()) }
function decline(sop: Sop, userId: string, reason = 'Busy this week') { return declineInternalReview(sop, userId, currentInternalRound(sop)!.id, task(sop, userId).id, reason, env()) }
/** Accepts first when needed: a decision is only possible on an accepted request. */
function decide(sop: Sop, userId: string, decision: 'completed' | 'returned' = 'completed', text?: string) {
  const accepted = task(sop, userId).decision === 'pending' ? accept(sop, userId) : sop
  return decideInternalReview(accepted, userId, currentInternalRound(accepted)!.id, task(accepted, userId).id, decision, text, env())
}
function cancel(sop: Sop, userId: string, actor = 'author') { return cancelInternalReview(sop, actor, currentInternalRound(sop)!.id, task(sop, userId).id, env()) }
function revise(sop: Sop) { vi.advanceTimersByTime(1000); const updated = uploadVersion(sop, 'author', { fileName: 'revised.pdf', fileType: 'pdf' }); return { ...updated, complianceChecks: [...updated.complianceChecks, check(updated.version)] } }
beforeEach(() => vi.useFakeTimers({ now: new Date(2026, 9, 23, 12) }))
afterEach(() => vi.useRealTimers())

describe('internal parallel review requests', () => {
  it('activates every selected reviewer and notifies each simultaneously', () => {
    const sop = start()
    expect(pendingPeople(sop).map((person) => person.userId)).toEqual(['a', 'b', 'c'])
    expect(new Set(currentInternalRound(sop)!.assignments.map((assignment) => assignment.assignedAt)).size).toBe(1)
    for (const user of ['a', 'b', 'c']) {
      expect(isInternalReviewPending(sop, user)).toBe(true)
      expect(reviewTasks(user, [sop])[0].group).toBe('todo')
      expect(deriveNotifications(user, { sops: [sop], requests: [], now: Date.now() }).filter((item) => item.type === 'assigned-review')).toHaveLength(1)
    }
    expect(sop.approvers).toEqual([])
    expect(sop.reviewFlow).toBeUndefined()
  })
  it.each([['a', 'b', 'c'], ['c', 'a', 'b'], ['b', 'c', 'a']])('allows independent decisions in order %s %s %s', (...order) => {
    let sop = start()
    for (const user of order) sop = decide(sop, user, 'completed', 'Reviewed by ' + user)
    expect(sop.status).toBe('in-review')
    expect(currentInternalRound(sop)!.status).toBe('completed')
    expect(requiredReviewsComplete(sop)).toBe(true)
    expect(pendingPeople(sop)).toEqual([])
    expect(sop.comments).toHaveLength(3)
    expect(sop.timeline.some((event) => event.type === 'forwarded-to-approver')).toBe(false)
    expect(deriveNotifications('author', { sops: [sop], requests: [], now: Date.now() }).some((item) => item.type === 'internal-review-completed')).toBe(true)
  })
  it('requires the main Author and excludes all writers, admins, inactive and other-department reviewers', () => {
    for (const actor of ['coauthor', 'a', 'admin', 'missing']) expect(() => startInternalReview(draft(), actor, '4.0', { reviewerIds: ['a'] }, env())).toThrow()
    for (const selected of ['author', 'coauthor', 'other', 'admin', 'missing']) expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: [selected] }, env())).toThrow()
    const inactive = env(); inactive.users.find((user) => user.id === 'a')!.deletedAt = new Date().toISOString()
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'] }, inactive)).toThrow()
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'a'] }, env())).toThrow()
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: [] }, env())).toThrow()
    expect(() => startInternalReview({ ...draft(), complianceChecks: [] }, 'author', '4.0', { reviewerIds: ['a'] }, env())).toThrow(/compliance/)
  })
  it('shares one request deadline and keeps its original allocation separate from elapsed time', () => {
    const sop = start()
    expect(currentInternalRound(sop)).toMatchObject({ assignedDueDays: 5, dueDate: '2026-10-28' })
    expect(sop.reviewers.every((reviewer) => reviewer.dueDate === '2026-10-28' && reviewer.assignedDueDays === 5)).toBe(true)
    expect(reviewerAssignedDays(sop, task(sop, 'a'))).toBe(5)
    const remaining = reviewerRemainingMilliseconds(sop, task(sop, 'a'))!
    expect(remaining).toBe(new Date(dueAtOfDate('2026-10-28')).getTime() - Date.now())
    expect(reviewerRemainingDays(sop, task(sop, 'a'))).toBe(remaining / (24 * 60 * 60 * 1000))
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(reviewerAssignedDays(sop, task(sop, 'a'))).toBe(5)
    expect(reviewerRemainingMilliseconds(sop, task(sop, 'a'))).toBe(remaining - 24 * 60 * 60 * 1000)
    const noDeadline = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'] }, env())
    expect(noDeadline.reviewers.every((reviewer) => reviewer.assignedDueDays === null && reviewer.dueDate === undefined)).toBe(true)
    expect(reviewTasks('a', [noDeadline])[0].dueAt).toBeUndefined()
    for (const dueDate of ['2026-10-22', '2026-02-30', 'invalid']) expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'], dueDate }, env())).toThrow(/deadline/)
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'], reviewerDueDates: { other: '2026-10-26' } }, env())).toThrow()
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'], dueDate: '2026-10-28', reviewerDueDates: { a: '2026-10-27' } }, env())).toThrow(/shared/)
  })
  it('accepts today and dates beyond 30 days, preserving precise request time and same-day expiry', () => {
    const now = new Date(2026, 9, 23, 15, 20, 30, 123)
    vi.setSystemTime(now)
    const sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'], dueDate: '2026-10-23' }, env())
    const round = currentInternalRound(sop)!
    expect(round.requestedAt).toBe(now.toISOString())
    expect(round.assignments.every((assignment) => assignment.assignedAt === round.requestedAt && assignment.dueDate === round.dueDate && assignment.assignedDueDays === 0)).toBe(true)
    const deadline = new Date(2026, 9, 23, 23, 59, 59, 999).getTime()
    const allocation = deadline - now.getTime()
    expect(reviewerAssignedMilliseconds(sop, task(sop, 'a'))).toBe(allocation)
    expect(reviewAssignedMilliseconds(sop)).toBe(allocation)
    expect(allocation).toBeGreaterThan(8 * 60 * 60 * 1000)
    expect(allocation).toBeLessThan(9 * 60 * 60 * 1000)
    const shifted = shiftDueDates(sop, 3)
    expect(reviewerAssignedMilliseconds(shifted, task(shifted, 'a'))).toBe(allocation)
    expect(reviewAssignedMilliseconds(shifted)).toBe(allocation)
    expect(reviewerDeadlinePassed(sop, task(sop, 'a'), deadline - 1)).toBe(false)
    expect(reviewerDeadlinePassed(sop, task(sop, 'a'), deadline)).toBe(true)
    expect(isOverdue(sop, 'review', deadline)).toBe(true)
    expect(reviewerRemainingMilliseconds(sop, task(sop, 'a'), deadline)).toBe(0)
    expect(reviewerRemainingMilliseconds(sop, task(sop, 'a'), deadline + 1)).toBe(-1)
    const distant = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'], dueDate: '2027-01-15' }, env())
    expect(currentInternalRound(distant)!.assignedDueDays).toBeGreaterThan(30)
    expect(distant.reviewers.every((assignment) => assignment.dueDate === '2027-01-15')).toBe(true)
  })
  it('supports accepting without a final decision and author cancellation while in progress', () => {
    const sop = start()
    const accepted = accept(sop, 'a')
    expect(task(accepted, 'a').decision).toBe('accepted')
    expect(task(accepted, 'a').acceptedAt).toBe(new Date().toISOString())
    expect(accepted.timeline.at(-1)).toMatchObject({ type: 'review-accepted', actorId: 'a', reviewAssignmentId: task(sop, 'a').id })
    expect(isInternalReviewPending(accepted, 'a')).toBe(true)
    expect(reviewTasks('a', [accepted])[0].group).toBe('todo')
    expect(task(cancel(accepted, 'a'), 'a').cancellationReason).toBe('author-cancelled')
    expect(() => accept(accepted, 'a')).toThrow(/already/)
  })
})

describe('accepting and declining review requests', () => {
  it('requires accepting before completing or returning the review', () => {
    const sop = start(); const round = currentInternalRound(sop)!
    for (const decision of ['completed', 'returned'] as const) {
      expect(() => decideInternalReview(sop, 'a', round.id, task(sop, 'a').id, decision, 'Comments', env())).toThrow(/Accept/)
    }
    expect(task(decide(sop, 'a'), 'a').decision).toBe('completed')
  })
  it('requires a reason to decline, notifies the author and co-authors, and keeps the other requests open', () => {
    const sop = start()
    for (const reason of ['', '   ', 'x'.repeat(1001)]) expect(() => decline(sop, 'a', reason)).toThrow(/reason/)
    const declined = decline(sop, 'a', '  On leave until next month  ')
    expect(task(declined, 'a')).toMatchObject({ decision: 'declined', declineReason: 'On leave until next month', decidedAt: new Date().toISOString() })
    expect(declined.timeline.at(-1)).toMatchObject({ type: 'review-declined', actorId: 'a', note: 'On leave until next month', recipientIds: ['author', 'coauthor'] })
    expect(isInternalReviewPending(declined, 'a')).toBe(false)
    expect(pendingPeople(declined).map((person) => person.userId)).toEqual(['b', 'c'])
    expect(declined.reviewers.find((person) => person.userId === 'a')!.decision).toBe('cancelled')
    expect(sopsUsing('reviewer', 'a', [declined])).toEqual([])
  })
  it('only allows accepting or declining a pending request, by the assigned reviewer', () => {
    const sop = start()
    expect(() => decline(accept(sop, 'a'), 'a')).toThrow(/not been accepted/)
    expect(() => accept(decline(sop, 'a'), 'a')).toThrow()
    expect(() => decline(decline(sop, 'a'), 'a')).toThrow()
    const round = currentInternalRound(sop)!
    expect(() => acceptInternalReview(sop, 'b', round.id, task(sop, 'a').id, env())).toThrow()
    expect(() => declineInternalReview(sop, 'b', round.id, task(sop, 'a').id, 'Busy', env())).toThrow()
  })
  it('counts declined reviewers as finished when the others complete', () => {
    const sop = decide(decide(decline(start(), 'a'), 'b'), 'c')
    expect(currentInternalRound(sop)!.status).toBe('completed')
    expect(requiredReviewsComplete(sop)).toBe(true)
  })
})

describe('rejection, cancellation and immutable history', () => {
  it('requires a non-empty rejection reason and validates the assigned actor at the transition boundary', () => {
    const sop = start(); const round = currentInternalRound(sop)!
    for (const reason of ['', '   ', 'x'.repeat(1001)]) expect(() => decide(sop, 'a', 'returned', reason)).toThrow()
    expect(() => decideInternalReview(sop, 'b', round.id, task(sop, 'a').id, 'completed', undefined, env())).toThrow()
    const revoked = env(); revoked.users.find((user) => user.id === 'a')!.permissions = []
    expect(() => decideInternalReview(sop, 'a', round.id, task(sop, 'a').id, 'completed', undefined, revoked)).toThrow()
    const moved = env(); moved.users.find((user) => user.id === 'a')!.departmentId = 'other'
    expect(() => decideInternalReview(sop, 'a', round.id, task(sop, 'a').id, 'completed', undefined, moved)).toThrow()
  })
  it('returns immediately on rejection, preserves completed feedback and cancels every unfinished task with a reason', () => {
    const completed = decide(start(), 'a', 'completed', 'Good content')
    const first = accept(completed, 'c')
    const before = JSON.stringify(first)
    const returned = decide(first, 'b', 'returned', '  Revise section 2  ')
    expect(JSON.stringify(first)).toBe(before)
    expect(returned.status).toBe('returned')
    expect(currentInternalRound(returned)!.status).toBe('rejected')
    expect(task(returned, 'a')).toMatchObject({ decision: 'completed' })
    expect(task(returned, 'b')).toMatchObject({ decision: 'returned' })
    expect(task(returned, 'c')).toMatchObject({ decision: 'cancelled', cancellationReason: 'round-rejected' })
    expect(returned.comments.map((comment) => comment.text)).toEqual(['Good content', 'Revise section 2'])
    expect(returned.comments.every((comment) => comment.version === '1' && comment.reviewRoundId && comment.reviewAssignmentId)).toBe(true)
    expect(returned.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'review-cancelled', cancellationReason: 'round-rejected', recipientIds: ['c'] })]))
    expect(() => decide(returned, 'c')).toThrow()
    expect(deriveNotifications('c', { sops: [returned], requests: [], now: Date.parse('2026-11-01') }).some((item) => item.type === 'due-soon' || item.type === 'overdue')).toBe(false)
  })
  it('permits only the main Author to cancel undecided tasks, never completed or rejected decisions', () => {
    const sop = start()
    for (const actor of ['a', 'coauthor', 'other', 'admin', 'missing']) expect(() => cancel(sop, 'b', actor)).toThrow()
    const completed = decide(sop, 'a')
    expect(() => cancel(completed, 'a')).toThrow()
    expect(() => cancel(decide(sop, 'a', 'returned', 'Revise'), 'a')).toThrow()
    expect(task(cancel(sop, 'a'), 'b').decision).toBe('pending')
  })
  it('blocks stale and duplicate decisions after cancellation and duplicate final decisions', () => {
    const sop = start(); const round = currentInternalRound(sop)!; const assignment = task(sop, 'a')
    const cancelled = cancel(sop, 'a')
    expect(() => decideInternalReview(cancelled, 'a', round.id, assignment.id, 'completed', 'Late', env())).toThrow()
    expect(() => acceptInternalReview(cancelled, 'a', round.id, assignment.id, env())).toThrow()
    expect(() => cancel(cancelled, 'a')).toThrow()
    expect(() => decide(decide(sop, 'a'), 'a')).toThrow()
  })
  it('returns to Draft if all assignments are cancelled before finals and preserves a new request on the same version separately', () => {
    let sop = start(); const first = currentInternalRound(sop)!
    for (const user of ['a', 'b', 'c']) sop = cancel(sop, user)
    expect(sop.status).toBe('draft')
    expect(requiredReviewsComplete(sop)).toBe(false)
    expect(currentInternalRound(sop)!.status).toBe('cancelled')
    const old = JSON.stringify(sop.internalReviewRounds)
    const next = startInternalReview(sop, 'author', '4.0', { reviewerIds: ['b', 'c'] }, env())
    expect(JSON.stringify(next.internalReviewRounds!.slice(0, -1))).toBe(old)
    expect(() => decideInternalReview(next, 'a', first.id, first.assignments[0].id, 'completed', undefined, env())).toThrow()
    expect(reviewTasks('a', [next])[0]).toMatchObject({ group: 'done', decision: 'cancelled' })
  })
  it('finishes awaiting Author if pending tasks are waived after a successful final review', () => {
    const sop = cancel(cancel(decide(start(), 'a'), 'b'), 'c')
    expect(sop.status).toBe('in-review')
    expect(currentInternalRound(sop)!.status).toBe('completed')
    expect(requiredReviewsComplete(sop)).toBe(true)
  })
  it('requires a revised version and current completed compliance before resubmitting every required reviewer', () => {
    const returned = decide(start(), 'a', 'returned', 'Changes')
    expect(canResubmit(returned)).toBe(false)
    expect(() => resubmitInternalReview(returned, 'author', '4.0', env())).toThrow(/version/)
    const updated = revise(returned)
    expect(() => resubmitInternalReview({ ...updated, complianceChecks: [] }, 'author', '4.0', env())).toThrow(/compliance/)
    expect(() => resubmitInternalReview(updated, 'coauthor', '4.0', env())).toThrow()
    const history = JSON.stringify(updated.internalReviewRounds)
    const again = resubmitInternalReview(updated, 'author', '4.0', env())
    expect(JSON.stringify(again.internalReviewRounds!.slice(0, -1))).toBe(history)
    expect(currentInternalRound(again)!.version).toBe('2')
    expect(currentInternalRound(again)!.assignments.map((assignment) => assignment.decision)).toEqual(['pending', 'pending', 'pending'])
    expect(currentInternalRound(again)!.assignments.every((assignment) => !returned.reviewers.some((old) => 'id' in old && old.id === assignment.id))).toBe(true)
    expect(again.comments[0].version).toBe('1')
    expect(() => decideInternalReview(again, 'a', currentInternalRound(returned)!.id, task(returned, 'a').id, 'completed', undefined, env())).toThrow()
  })
  it('restarts original deadline allocations and retains waivers while revalidating required reviewers', () => {
    const returned = decide(cancel(start(), 'c'), 'a', 'returned', 'Changes')
    vi.advanceTimersByTime(4 * 24 * 60 * 60 * 1000)
    const revised = revise(returned)
    const again = resubmitInternalReview(revised, 'author', '4.0', env())
    expect(again.reviewers.map((person) => person.userId)).toEqual(['a', 'b'])
    expect(task(again, 'a')).toMatchObject({ assignedDueDays: 5, dueDate: '2026-11-01' })
    expect(task(again, 'b')).toMatchObject({ assignedDueDays: 5, dueDate: '2026-11-01' })
    expect(currentInternalRound(again)).toMatchObject({ assignedDueDays: 5, dueDate: '2026-11-01' })
    const unavailable = env(); unavailable.users.find((user) => user.id === 'b')!.deletedAt = new Date().toISOString()
    expect(() => resubmitInternalReview(revised, 'author', '4.0', unavailable)).toThrow(/eligible/)
  })
  it('uses the shared deadline for task and Author request reminders, then stops them on round closure', () => {
    const sop = start()
    const taskSoon = new Date(2026, 9, 25, 12).getTime()
    expect(deriveNotifications('a', { sops: [sop], requests: [], now: taskSoon }).some((item) => item.type === 'due-soon')).toBe(false)
    expect(deriveNotifications('b', { sops: [sop], requests: [], now: taskSoon }).some((item) => item.type === 'due-soon')).toBe(false)
    expect(deriveNotifications('c', { sops: [sop], requests: [], now: taskSoon }).some((item) => item.type === 'due-soon')).toBe(false)
    const requestSoon = new Date(2026, 9, 28, 12).getTime()
    for (const user of ['a', 'b', 'c']) expect(deriveNotifications(user, { sops: [sop], requests: [], now: requestSoon }).some((item) => item.type === 'due-soon')).toBe(true)
    expect(deriveNotifications('author', { sops: [sop], requests: [], now: requestSoon }).some((item) => item.type === 'request-due-soon')).toBe(true)
    const rejected = decide(sop, 'b', 'returned', 'Changes')
    expect(deriveNotifications('a', { sops: [rejected], requests: [], now: requestSoon }).some((item) => item.type === 'review-cancelled')).toBe(true)
    expect(deriveNotifications('author', { sops: [rejected], requests: [], now: requestSoon }).some((item) => item.type === 'request-due-soon' || item.type === 'request-overdue')).toBe(false)
  })
})

describe('assignment cancellation is separate from global Reviewer permission', () => {
  it('releases only cancelled SOP involvement and preserves roles, other tasks, dates and audit history', () => {
    const environment = env()
    const usersBefore = JSON.stringify(environment.users)
    const original = start()
    const other = { ...start(), id: 'other-sop', code: 'OTHER' }
    const otherBefore = JSON.stringify(other)
    const round = currentInternalRound(original)!
    const cancelled = cancelInternalReview(original, 'author', round.id, task(original, 'a').id, environment)
    const user = environment.users.find((person) => person.id === 'a')!
    const context = { actorId: 'admin', users: environment.users, sops: [cancelled] }
    expect(user.permissions).toEqual(['reviewer'])
    expect(JSON.stringify(environment.users)).toBe(usersBefore)
    expect(sopsUsing('reviewer', user.id, [cancelled])).toEqual([])
    expect(permissionChangeBlockers(user, [], context)).toEqual([])
    expect(deleteBlockers(user, context)).toEqual([])
    expect(sopsUsing('reviewer', user.id, [cancelled, other]).map((sop) => sop.id)).toEqual(['other-sop'])
    expect(permissionChangeBlockers(user, [], { ...context, sops: [cancelled, other] })[0]).toMatchObject({ kind: 'in-use', permission: 'reviewer', sops: [other] })
    expect(deleteBlockers(user, { ...context, sops: [cancelled, other] })[0]).toMatchObject({ kind: 'in-use', sops: [other] })
    expect(reviewTasks(user.id, [cancelled, other]).filter((task) => task.group === 'todo').map((task) => task.sop.id)).toEqual(['other-sop'])
    expect(pendingPeople(cancelled).map((person) => person.userId)).toEqual(['b', 'c'])
    expect(task(cancelled, 'a')).toMatchObject({ decision: 'cancelled', dueDate: '2026-10-28', assignedDueDays: 5, cancellationReason: 'author-cancelled' })
    expect(cancelled.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'review-cancelled', reviewAssignmentId: task(original, 'a').id })]))
    const notifications = deriveNotifications(user.id, { sops: [cancelled, other], requests: [], now: new Date(2026, 9, 28, 12).getTime() })
    expect(notifications.filter((item) => item.type === 'due-soon' || item.type === 'overdue').map((item) => item.sopId)).toEqual(['other-sop'])
    expect(JSON.stringify(other)).toBe(otherBefore)
  })
  it('does not count automatically cancelled work as active or silently modify permissions', () => {
    const environment = env()
    const before = JSON.stringify(environment.users)
    const returned = decide(start(), 'b', 'returned', 'Changes')
    expect(sopsUsing('reviewer', 'a', [returned])).toEqual([])
    expect(sopsUsing('reviewer', 'b', [returned])).toEqual([returned])
    expect(JSON.stringify(environment.users)).toBe(before)
    expect(task(returned, 'a').cancellationReason).toBe('round-rejected')
    // Any later request still revalidates eligibility rather than changing roles itself.
    environment.users.find((user) => user.id === 'a')!.permissions = []
    expect(() => resubmitInternalReview(revise(returned), 'author', '4.0', environment)).toThrow(/eligible/)
  })
})
