import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_ACTOR, type Sop, type User } from '../data/mock/types'
import { acceptInternalReview, addableReviewers, addInternalReviewers, canAddReviewers, currentInternalRound, decideInternalReview, declineInternalReview, isInternalReviewPending, nextWithdrawalAt, removeInternalReviewer, canSendNewVersion, sendNewVersionForReview, startInternalReview, withdrawUnanswered } from './internalReview'
import { latestAssignmentOf, reviewAllowsNewVersion } from './internalReviewStatus'
import { deriveNotifications } from './notifications'
import { reviewTasks } from './reviews'
import { deleteBlockers, permissionChangeBlockers, sopsUsing } from './userAdmin'
import { checkBlocker, currentDueAt, deleteVersionBlocker, isOverdue, pendingPeople, requiredReviewsComplete, reviewerDeadlinePassed, reviewerDueAt, reviewerRemainingMilliseconds, shiftDueDates, uploadVersion } from './workflow'

function person(id: string, permissions: User['permissions'] = ['reviewer'], departmentId = 'home'): User {
  return { id, name: id, email: id + '@example.test', initials: 'TT', permissions, departmentId }
}
const env = () => ({ users: [person('author', ['author', 'reviewer']), person('coauthor', ['author', 'reviewer']), person('a'), person('b'), person('c'), person('other', ['reviewer'], 'other'), person('admin', ['admin', 'reviewer'])], departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }] })
const check = (version: string) => ({ id: 'check-' + version, sopId: 'test', version, status: 'completed' as const, startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] })
function draft(): Sop {
  return { id: 'test', code: 'TEST', title: 'Test SOP', version: '1', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'], status: 'draft', lastUpdated: '2026-10-23', fileName: 'test.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString() }], reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [check('1')] }
}
const start = () => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b', 'c'], responseDueDate: '2026-10-28', reviewDurationDays: 5 }, env())
/** The reviewer's latest request in the current round. */
function task(sop: Sop, userId: string) { return latestAssignmentOf(currentInternalRound(sop), userId)! }
function accept(sop: Sop, userId: string) { return acceptInternalReview(sop, userId, currentInternalRound(sop)!.id, task(sop, userId).id, env()) }
function decline(sop: Sop, userId: string, reason = 'Busy this week') { return declineInternalReview(sop, userId, currentInternalRound(sop)!.id, task(sop, userId).id, reason, env()) }
/** Accepts first when needed: a decision is only possible on an accepted request. */
function decide(sop: Sop, userId: string, decision: 'completed' | 'returned' = 'completed', text?: string) {
  const accepted = task(sop, userId).decision === 'pending' ? accept(sop, userId) : sop
  return decideInternalReview(accepted, userId, currentInternalRound(accepted)!.id, task(accepted, userId).id, decision, text, env())
}
function cancel(sop: Sop, userId: string, actor = 'author', reason = 'No longer needed') { return removeInternalReviewer(sop, actor, currentInternalRound(sop)!.id, task(sop, userId).id, reason, env()) }
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
  it('gives every request the same optional response due date and review duration, without a shared round deadline', () => {
    const sop = start()
    expect(currentInternalRound(sop)).toMatchObject({ assignedDueDays: null })
    expect(currentInternalRound(sop)!.dueDate).toBeUndefined()
    expect(currentInternalRound(sop)!.assignments.every((assignment) => assignment.responseDueDate === '2026-10-28' && assignment.reviewDurationDays === 5 && !assignment.reviewDueDate)).toBe(true)
    // Before acceptance the response due date applies, at the end of that local day.
    expect(reviewerDueAt(sop, task(sop, 'a'))).toBe(new Date(2026, 9, 28, 23, 59, 59, 999).toISOString())
    expect(reviewTasks('a', [sop])[0].dueAt).toBe(new Date(2026, 9, 28, 23, 59, 59, 999).toISOString())
    const blank = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'] }, env())
    expect(currentInternalRound(blank)!.assignments.every((assignment) => assignment.responseDueDate === undefined && assignment.reviewDurationDays === undefined)).toBe(true)
    expect(reviewTasks('a', [blank])[0].dueAt).toBeUndefined()
    expect(reviewerDueAt(accept(blank, 'a'), task(accept(blank, 'a'), 'a'))).toBeUndefined()
    expect(currentDueAt(blank)).toBeUndefined()
  })
  it('accepts a response due date of today or later and a whole-number duration from 1 to 30 days', () => {
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'], responseDueDate: '2026-10-23' }, env())).not.toThrow()
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'], responseDueDate: '2027-01-15' }, env())).not.toThrow()
    for (const responseDueDate of ['2026-10-22', '2026-02-30', 'invalid']) {
      expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'], responseDueDate }, env())).toThrow(/response due date/)
    }
    for (const reviewDurationDays of [1, 30]) expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'], reviewDurationDays }, env())).not.toThrow()
    for (const reviewDurationDays of [0, 31, 2.5, -1, Number.NaN]) {
      expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a'], reviewDurationDays }, env())).toThrow(/duration/)
    }
  })
  it('starts the review duration when each reviewer accepts, due at the end of the last day', () => {
    vi.setSystemTime(new Date(2026, 9, 25, 15))
    const sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b', 'c'], reviewDurationDays: 5 }, env())
    const a = accept(sop, 'a')
    expect(task(a, 'a')).toMatchObject({ acceptedAt: new Date(2026, 9, 25, 15).toISOString(), reviewDueDate: '2026-10-30' })
    expect(reviewerDueAt(a, task(a, 'a'))).toBe(new Date(2026, 9, 30, 23, 59, 59, 999).toISOString())
    // Accepting at any time of the same day gives the same last day.
    vi.setSystemTime(new Date(2026, 9, 25, 23, 59))
    expect(task(accept(a, 'b'), 'b').reviewDueDate).toBe('2026-10-30')
    // A later acceptance gives that reviewer a later due date, across the month end.
    vi.setSystemTime(new Date(2026, 9, 27, 0, 0, 1))
    const c = accept(a, 'c')
    expect(task(c, 'c').reviewDueDate).toBe('2026-11-01')
    expect(task(c, 'a').reviewDueDate).toBe('2026-10-30')
    // The nearest open deadline is the SOP's current one.
    expect(currentDueAt(c)).toBe(new Date(2026, 9, 30, 23, 59, 59, 999).toISOString())
  })
  it('marks an accepted review overdue at the exact end of its last day, without changing anything', () => {
    vi.setSystemTime(new Date(2026, 9, 25, 15))
    const sop = accept(startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'], reviewDurationDays: 1 }, env()), 'a')
    const deadline = new Date(2026, 9, 26, 23, 59, 59, 999).getTime()
    expect(reviewerDeadlinePassed(sop, task(sop, 'a'), deadline - 1)).toBe(false)
    expect(reviewerDeadlinePassed(sop, task(sop, 'a'), deadline)).toBe(true)
    expect(reviewerRemainingMilliseconds(sop, task(sop, 'a'), deadline)).toBe(0)
    expect(isOverdue(sop, 'review', deadline)).toBe(true)
    expect(task(sop, 'a').decision).toBe('accepted')
    expect(isInternalReviewPending(sop, 'a')).toBe(true)
    // The demo clock moves the open deadlines, never the acceptance or the duration.
    const shifted = shiftDueDates(sop, 1)
    expect(task(shifted, 'a')).toMatchObject({ reviewDueDate: '2026-10-25', reviewDurationDays: 1, acceptedAt: task(sop, 'a').acceptedAt })
  })
  it('supports accepting without a final decision and author cancellation while in progress', () => {
    const sop = start()
    const accepted = accept(sop, 'a')
    expect(task(accepted, 'a').decision).toBe('accepted')
    expect(task(accepted, 'a').acceptedAt).toBe(new Date().toISOString())
    expect(accepted.timeline.at(-1)).toMatchObject({ type: 'review-accepted', actorId: 'a', reviewAssignmentId: task(sop, 'a').id })
    expect(isInternalReviewPending(accepted, 'a')).toBe(true)
    expect(reviewTasks('a', [accepted])[0].group).toBe('todo')
    expect(task(cancel(accepted, 'a'), 'a')).toMatchObject({ decision: 'removed', removalReason: 'No longer needed', removedById: 'author' })
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

describe('returns, removals, new versions and immutable history', () => {
  it('requires comments to return and validates the assigned actor at the transition boundary', () => {
    const sop = start(); const round = currentInternalRound(sop)!
    for (const reason of ['', '   ', 'x'.repeat(1001)]) expect(() => decide(sop, 'a', 'returned', reason)).toThrow()
    expect(() => decideInternalReview(sop, 'b', round.id, task(sop, 'a').id, 'completed', undefined, env())).toThrow()
    const revoked = env(); revoked.users.find((user) => user.id === 'a')!.permissions = []
    expect(() => decideInternalReview(sop, 'a', round.id, task(sop, 'a').id, 'completed', undefined, revoked)).toThrow()
    const moved = env(); moved.users.find((user) => user.id === 'a')!.departmentId = 'other'
    expect(() => decideInternalReview(sop, 'a', round.id, task(sop, 'a').id, 'completed', undefined, moved)).toThrow()
  })
  it('returns to the author with required comments without affecting the other reviewers', () => {
    const completed = decide(start(), 'a', 'completed', 'Good content')
    const first = accept(completed, 'c')
    const before = JSON.stringify(first)
    const returned = decide(first, 'b', 'returned', '  Revise section 2  ')
    expect(JSON.stringify(first)).toBe(before)
    expect(returned.status).toBe('in-review')
    expect(currentInternalRound(returned)!.status).toBe('open')
    expect(task(returned, 'a')).toMatchObject({ decision: 'completed' })
    expect(task(returned, 'b')).toMatchObject({ decision: 'returned' })
    expect(task(returned, 'c')).toMatchObject({ decision: 'accepted' })
    expect(returned.comments.map((comment) => comment.text)).toEqual(['Good content', 'Revise section 2'])
    expect(returned.comments.every((comment) => comment.version === '1' && comment.reviewRoundId && comment.reviewAssignmentId)).toBe(true)
    expect(returned.timeline.at(-1)).toMatchObject({ type: 'review-changes-requested', actorId: 'b', recipientIds: ['author', 'coauthor'], commentId: returned.comments[1].id })
    expect(returned.timeline.some((event) => event.type === 'review-cancelled' || event.type === 'returned')).toBe(false)
    // The others can still finish; once they have, the round asks for a new version.
    const settled = decide(returned, 'c', 'completed')
    expect(currentInternalRound(settled)!.status).toBe('changes-requested')
    expect(settled.status).toBe('in-review')
    expect(requiredReviewsComplete(settled)).toBe(false)
    expect(settled.timeline.some((event) => event.type === 'internal-review-completed')).toBe(false)
  })
  it('permits only the main Author to remove a reviewer, whatever their status, with a required reason', () => {
    const sop = start()
    for (const actor of ['a', 'coauthor', 'other', 'admin', 'missing']) expect(() => cancel(sop, 'b', actor)).toThrow()
    const completed = decide(sop, 'a')
    for (const reason of ['', '   ', 'x'.repeat(1001)]) expect(() => cancel(sop, 'a', 'author', reason)).toThrow(/reason/)
    const removed = cancel(completed, 'a', 'author', '  Left the department  ')
    expect(task(removed, 'a')).toMatchObject({ decision: 'removed', removalReason: 'Left the department' })
    expect(removed.comments).toEqual(completed.comments)
    expect(removed.timeline.at(-1)).toMatchObject({ type: 'reviewer-removed', actorId: 'author', note: 'Left the department', recipientIds: ['a'], reviewAssignmentId: task(sop, 'a').id })
    expect(task(cancel(decline(sop, 'a'), 'a'), 'a').decision).toBe('removed')
    expect(() => cancel(removed, 'a')).toThrow()

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
  it('stays In Review with an open round when every reviewer is removed, and the author adds reviewers to the same version', () => {
    let sop = start(); const first = currentInternalRound(sop)!
    for (const user of ['a', 'b', 'c']) sop = cancel(sop, user)
    expect(sop.status).toBe('in-review')
    expect(requiredReviewsComplete(sop)).toBe(false)
    expect(currentInternalRound(sop)!.status).toBe('open')
    expect(pendingPeople(sop)).toEqual([])
    const added = addInternalReviewers(sop, 'author', { reviewerIds: ['b', 'c'], responseDueDate: '2026-10-30' }, env())
    expect(added.internalReviewRounds).toHaveLength(1)
    expect(currentInternalRound(added)!.id).toBe(first.id)
    expect(currentInternalRound(added)!.assignments.filter((person) => person.userId === 'b').map((person) => person.decision)).toEqual(['removed', 'pending'])
    expect(currentInternalRound(added)!.assignments.at(-1)).toMatchObject({ userId: 'c', decision: 'pending', responseDueDate: '2026-10-30' })
    expect(pendingPeople(added).map((person) => person.userId)).toEqual(['b', 'c'])
    expect(added.reviewers.find((person) => person.userId === 'b')!.decision).toBe('pending')
    expect(added.timeline.at(-1)).toMatchObject({ type: 'submitted', actorId: 'author', recipientIds: ['b', 'c'], reviewRoundId: first.id })
    expect(deriveNotifications('b', { sops: [added], requests: [], now: Date.now() }).filter((item) => item.type === 'assigned-review').length).toBeGreaterThan(0)
    expect(reviewTasks('a', [added])[0]).toMatchObject({ group: 'done', decision: 'removed' })
    expect(reviewTasks('b', [added])[0]).toMatchObject({ group: 'todo' })
  })
  it('only adds new reviewers or those who declined, were withdrawn or were removed, by the main author', () => {
    const sop = decline(start(), 'a')
    expect(addableReviewers(sop, env().users).map((user) => user.id)).toEqual(['a'])
    for (const reviewerIds of [['b'], ['a', 'b'], ['author'], ['other']]) expect(() => addInternalReviewers(sop, 'author', { reviewerIds }, env())).toThrow()
    for (const actor of ['coauthor', 'a', 'admin']) expect(() => addInternalReviewers(sop, actor, { reviewerIds: ['a'] }, env())).toThrow()
    expect(() => addInternalReviewers(sop, 'author', { reviewerIds: ['a'], reviewDurationDays: 31 }, env())).toThrow(/duration/)
    expect(task(addInternalReviewers(sop, 'author', { reviewerIds: ['a'] }, env()), 'a').decision).toBe('pending')
    const withdrawn = withdrawUnanswered(start(), new Date(2026, 9, 28, 23, 59, 59, 999).getTime())
    expect(addableReviewers(withdrawn, env().users).map((user) => user.id)).toEqual(['a', 'b', 'c'])
  })
  it('reopens a settled round when a reviewer is added before submitting for approval', () => {
    const settled = decide(decide(decide(start(), 'a'), 'b'), 'c')
    expect(currentInternalRound(settled)!.status).toBe('completed')
    expect(canAddReviewers(settled)).toBe(true)
    const removed = cancel(settled, 'c')
    expect(currentInternalRound(removed)!.status).toBe('completed')
    const reopened = addInternalReviewers(removed, 'author', { reviewerIds: ['c'] }, env())
    expect(currentInternalRound(reopened)!.status).toBe('open')
    expect(currentInternalRound(reopened)!.closedAt).toBeUndefined()
    expect(requiredReviewsComplete(reopened)).toBe(false)
    const again = decide(reopened, 'c')
    expect(currentInternalRound(again)!.status).toBe('completed')
    expect(requiredReviewsComplete(again)).toBe(true)
  })
  it('finishes awaiting Author if pending tasks are waived after a successful final review', () => {
    const sop = cancel(cancel(decide(start(), 'a'), 'b'), 'c')
    expect(sop.status).toBe('in-review')
    expect(currentInternalRound(sop)!.status).toBe('completed')
    expect(requiredReviewsComplete(sop)).toBe(true)
  })
  it('allows a new version only once every reviewer taking part has finished the current one', () => {
    const sop = decide(start(), 'b', 'returned', 'Changes')
    expect(reviewAllowsNewVersion(sop)).toBe(false)
    expect(() => revise(sop)).toThrow(/in-review/)
    const finished = decide(decline(sop, 'c'), 'a')
    expect(reviewAllowsNewVersion(finished)).toBe(true)
    expect(revise(finished).version).toBe('2')
    // With nobody taking part, a new version is allowed too.
    let nobody = start()
    for (const user of ['a', 'b', 'c']) nobody = cancel(nobody, user)
    expect(reviewAllowsNewVersion(nobody)).toBe(true)
    expect(revise(nobody).version).toBe('2')
  })
  it('sends the new version to the reviewers the author chooses, once checked, as a new round', () => {
    const finished = decide(decide(decide(start(), 'a', 'completed', 'Fine'), 'b', 'returned', 'Changes'), 'c')
    expect(canSendNewVersion(finished)).toBe(false)
    expect(() => sendNewVersionForReview(finished, 'author', '4.0', { reviewerIds: ['b'] }, env())).toThrow(/new version/)
    expect(addableReviewers(finished, env().users)).toEqual([])
    const uploaded = uploadVersion(finished, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    expect(canSendNewVersion(uploaded)).toBe(true)
    expect(() => sendNewVersionForReview(uploaded, 'author', '4.0', { reviewerIds: ['b'] }, env())).toThrow(/compliance/)
    const checked = { ...uploaded, complianceChecks: [...uploaded.complianceChecks, check(uploaded.version)] }
    expect(() => sendNewVersionForReview(checked, 'coauthor', '4.0', { reviewerIds: ['b'] }, env())).toThrow()
    const history = JSON.stringify(checked.internalReviewRounds)
    const again = sendNewVersionForReview(checked, 'author', '4.0', { reviewerIds: ['b', 'c'], reviewDurationDays: 3 }, env())
    expect(JSON.stringify(again.internalReviewRounds!.slice(0, -1))).toBe(history)
    expect(currentInternalRound(again)).toMatchObject({ version: '2', status: 'open' })
    expect(currentInternalRound(again)!.assignments.map((assignment) => [assignment.userId, assignment.decision, assignment.reviewDurationDays])).toEqual([['b', 'pending', 3], ['c', 'pending', 3]])
    expect(again.timeline.at(-1)).toMatchObject({ type: 'resubmitted', version: '2', recipientIds: ['b', 'c'] })
    expect(again.comments[0].version).toBe('1')
    // a completed v1 only; with v2 sent to b and c, a no longer takes part.
    expect(pendingPeople(again).map((person) => person.userId)).toEqual(['b', 'c'])
    expect(() => decideInternalReview(again, 'a', currentInternalRound(finished)!.id, latestAssignmentOf(currentInternalRound(finished), 'a')!.id, 'completed', undefined, env())).toThrow()
    const unavailable = env(); unavailable.users.find((user) => user.id === 'b')!.deletedAt = new Date().toISOString()
    expect(() => sendNewVersionForReview(checked, 'author', '4.0', { reviewerIds: ['b'] }, unavailable)).toThrow(/eligible/)
  })
  it('checks and deletes only an unsent version while In Review', () => {
    const finished = decide(start(), 'a')
    let sop = decide(decide(finished, 'b'), 'c')
    expect(checkBlocker(sop, 'author')).toBe('status')
    sop = uploadVersion(sop, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    expect(checkBlocker(sop, 'author')).toBeUndefined()
    expect(deleteVersionBlocker(sop, 'author', '2')).toBeUndefined()
    expect(deleteVersionBlocker(sop, 'author', '1')).toBe('submitted-version')
  })
  it('reminds each reviewer of their own response, then review, deadline and stops once they finish', () => {
    const sop = start()
    const taskSoon = new Date(2026, 9, 25, 12).getTime()
    expect(deriveNotifications('a', { sops: [sop], requests: [], now: taskSoon }).some((item) => item.type === 'due-soon')).toBe(false)
    expect(deriveNotifications('b', { sops: [sop], requests: [], now: taskSoon }).some((item) => item.type === 'due-soon')).toBe(false)
    expect(deriveNotifications('c', { sops: [sop], requests: [], now: taskSoon }).some((item) => item.type === 'due-soon')).toBe(false)
    const requestSoon = new Date(2026, 9, 28, 12).getTime()
    for (const user of ['a', 'b', 'c']) expect(deriveNotifications(user, { sops: [sop], requests: [], now: requestSoon }).some((item) => item.type === 'due-soon')).toBe(true)
    expect(deriveNotifications('author', { sops: [sop], requests: [], now: requestSoon }).some((item) => item.type === 'due-soon' || item.type === 'review-overdue')).toBe(false)
    // After accepting, the response reminder gives way to a separate review reminder.
    const accepted = accept(sop, 'a')
    const reviewSoon = new Date(2026, 9, 28, 12).getTime()
    const reminders = deriveNotifications('a', { sops: [accepted], requests: [], now: reviewSoon }).filter((item) => item.type === 'due-soon')
    expect(reminders.map((item) => item.dueAt)).toEqual([new Date(2026, 9, 28, 23, 59, 59, 999).toISOString()])
    expect(reminders[0].id).toContain(':review:')
    // A reviewer's reminders stop once they finish; the others' continue.
    const completedA = decide(sop, 'a')
    expect(deriveNotifications('a', { sops: [completedA], requests: [], now: requestSoon }).some((item) => item.type === 'due-soon')).toBe(false)
    expect(deriveNotifications('b', { sops: [completedA], requests: [], now: requestSoon }).some((item) => item.type === 'due-soon')).toBe(true)
    expect(deriveNotifications('author', { sops: [completedA], requests: [], now: requestSoon }).some((item) => item.type === 'due-soon' || item.type === 'review-overdue')).toBe(false)
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
    const cancelled = removeInternalReviewer(original, 'author', round.id, task(original, 'a').id, 'No longer needed', environment)
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
    expect(task(cancelled, 'a')).toMatchObject({ decision: 'removed', responseDueDate: '2026-10-28', reviewDurationDays: 5, removalReason: 'No longer needed' })
    expect(cancelled.timeline).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'reviewer-removed', reviewAssignmentId: task(original, 'a').id })]))
    const notifications = deriveNotifications(user.id, { sops: [cancelled, other], requests: [], now: new Date(2026, 9, 28, 12).getTime() })
    expect(notifications.filter((item) => item.type === 'due-soon' || item.type === 'overdue').map((item) => item.sopId)).toEqual(['other-sop'])
    expect(JSON.stringify(other)).toBe(otherBefore)
  })
  it('keeps the other reviewers in use after one returns, without changing permissions', () => {
    const environment = env()
    const before = JSON.stringify(environment.users)
    const returned = decide(start(), 'b', 'returned', 'Changes')
    expect(sopsUsing('reviewer', 'a', [returned])).toEqual([returned])
    expect(sopsUsing('reviewer', 'b', [returned])).toEqual([returned])
    expect(JSON.stringify(environment.users)).toBe(before)
    // Any later request still revalidates eligibility rather than changing roles itself.
    const finished = decide(decide(returned, 'a'), 'c')
    const checked = { ...revise(finished) }
    environment.users.find((user) => user.id === 'a')!.permissions = []
    expect(() => sendNewVersionForReview(checked, 'author', '4.0', { reviewerIds: ['a'] }, environment)).toThrow(/eligible/)
  })
})

describe('automatic withdrawal of unanswered requests', () => {
  const endOfDay = (day: number) => new Date(2026, 9, day, 23, 59, 59, 999).getTime()
  it('withdraws a pending request exactly when its response due date has ended, dated at the deadline by System', () => {
    const sop = start()
    expect(withdrawUnanswered(sop, endOfDay(28) - 1)).toBe(sop)
    const withdrawn = withdrawUnanswered(sop, endOfDay(28))
    for (const user of ['a', 'b', 'c']) expect(task(withdrawn, user)).toMatchObject({ decision: 'withdrawn', withdrawnAt: new Date(endOfDay(28)).toISOString() })
    expect(withdrawn.timeline.filter((event) => event.type === 'review-withdrawn')).toEqual(['a', 'b', 'c'].map((user) => expect.objectContaining({
      actorId: SYSTEM_ACTOR, createdAt: new Date(endOfDay(28)).toISOString(), recipientIds: ['author', user], reviewAssignmentId: task(sop, user).id,
    })))
    // Applying the rule again changes nothing.
    expect(withdrawUnanswered(withdrawn, endOfDay(30))).toBe(withdrawn)
    expect(sopsUsing('reviewer', 'a', [withdrawn])).toEqual([])
  })
  it('never withdraws a request without a response due date, or one that was accepted', () => {
    const blank = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'], reviewDurationDays: 1 }, env())
    expect(withdrawUnanswered(blank, endOfDay(31) * 2)).toBe(blank)
    const accepted = accept(start(), 'a')
    const later = withdrawUnanswered(accepted, endOfDay(28))
    expect(task(later, 'a').decision).toBe('accepted')
    expect(task(later, 'b').decision).toBe('withdrawn')
    expect(nextWithdrawalAt([accepted])).toBe(endOfDay(28))
    expect(nextWithdrawalAt([later, blank])).toBeUndefined()
  })
  it('refuses accepting or declining once the response due date has ended, even before the rule has run', () => {
    const sop = start()
    vi.setSystemTime(endOfDay(28))
    expect(() => accept(sop, 'a')).toThrow(/withdrawn/)
    expect(() => decline(sop, 'a')).toThrow(/withdrawn/)
  })
  it('does not count a withdrawn reviewer as taking part', () => {
    const sop = decide(decide(accept(accept(start(), 'a'), 'b'), 'a'), 'b')
    const settled = withdrawUnanswered(sop, endOfDay(28))
    expect(task(settled, 'c').decision).toBe('withdrawn')
    expect(currentInternalRound(settled)!.status).toBe('completed')
    expect(requiredReviewsComplete(settled)).toBe(true)
    expect(reviewTasks('c', [settled])[0]).toMatchObject({ group: 'done', decision: 'withdrawn' })
  })
})

describe('removing a reviewer who returned with comments', () => {
  it('is allowed, and the round completes when everyone still taking part completed', () => {
    const returned = decide(decide(decide(start(), 'a'), 'b'), 'c', 'returned', 'Please revise')
    expect(currentInternalRound(returned)!.status).toBe('changes-requested')
    const removed = cancel(returned, 'c', 'author', 'Comments handled offline')
    expect(task(removed, 'c')).toMatchObject({ decision: 'removed', removalReason: 'Comments handled offline' })
    expect(removed.comments.map((comment) => comment.text)).toContain('Please revise')
    expect(currentInternalRound(removed)!.status).toBe('completed')
    expect(requiredReviewsComplete(removed)).toBe(true)
    expect(removed.timeline.at(-1)).toMatchObject({ type: 'internal-review-completed' })
  })
})
