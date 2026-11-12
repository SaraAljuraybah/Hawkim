import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { InternalReviewSummary } from '../components/workflow/InternalReviewSummary'
import type { Department, Sop, User } from '../data/mock/types'
import { approvalButtonBlocker } from './approval'
import { fixedResponseDueDate } from './fixedResponseDeadline'
import {
  acceptInternalReview, addInternalReviewers, currentInternalRound, decideInternalReview, declineInternalReview, expireUnanswered,
  hasHomeFinished, nextExpiryAt, removeInternalReviewer, resendInternalReview, startInternalReview,
} from './internalReview'
import { latestAssignmentOf } from './internalReviewStatus'
import { deriveNotifications } from './notifications'
import { reviewDepartmentLock } from './reviewDepartment'
import { reviewerTaskSection, reviewTasks } from './reviews'
import { endOfRiyadhDay } from './riyadhWorkingDays'
import { checkBlocker, requiredReviewsComplete, uploadVersion } from './workflow'

// The Riyadh working-day policy, as it is active (lib/deadlinePolicy.ts).
vi.mock('./deadlinePolicy', () => ({ WORKING_DAY_DEADLINES_ACTIVE: true }))

function person(id: string, permissions: User['permissions'], departmentId: string): User {
  return { id, name: `Name ${id}`, email: `${id}@example.test`, initials: 'NN', permissions, departmentId }
}
const departments: Department[] = [
  { id: 'home', name: 'Home Department', initials: 'HD', description: '', requiresComplianceCheck: true },
  { id: 'other', name: 'Other Department', initials: 'OD', description: '' },
]
const users = [person('author', ['author'], 'home'), person('h1', ['reviewer'], 'home'), person('h2', ['reviewer'], 'home'), person('h3', ['reviewer'], 'home'), person('o1', ['reviewer'], 'other')]
const env = () => ({ users, departments })
const check = (version: string) => ({ id: 'check-' + version, sopId: 'sop', version, status: 'completed' as const, startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] })
function draft(): Sop {
  return { id: 'sop', code: 'SOP-1', title: 'Back to Draft', departmentId: 'home', authorId: 'author', coAuthorIds: [], version: '1', status: 'draft', lastUpdated: '2026-10-26', fileName: 'a.pdf', fileType: 'pdf',
    versions: [{ version: '1', fileName: 'a.pdf', fileType: 'pdf', uploadedAt: '2026-10-26T05:00:00Z' }], comments: [], timeline: [], reviewers: [], approvers: [], complianceChecks: [check('1')] }
}
const submit = (sop: Sop, reviewerIds: string[], reviewDurationDays = 3) => startInternalReview(sop, 'author', '4.0', { reviewerIds, reviewDurationDays }, env())
const request = (sop: Sop, userId: string) => latestAssignmentOf(currentInternalRound(sop), userId)!
const roundId = (sop: Sop) => currentInternalRound(sop)!.id
const accept = (sop: Sop, userId: string) => acceptInternalReview(sop, userId, roundId(sop), request(sop, userId).id, env())
const decide = (sop: Sop, userId: string, decision: 'completed' | 'returned' = 'completed') => decideInternalReview(sop, userId, roundId(sop), request(sop, userId).id, decision, 'Comment', env())
const decline = (sop: Sop, userId: string) => declineInternalReview(sop, userId, roundId(sop), request(sop, userId).id, 'On leave', env())
const remove = (sop: Sop, userId: string) => removeInternalReviewer(sop, 'author', roundId(sop), request(sop, userId).id, 'Not needed', env())
const events = (sop: Sop) => sop.timeline.map((event) => event.type)
const notifications = (userId: string, sop: Sop, now = Date.now()) => deriveNotifications(userId, { sops: [sop], requests: [], now })
const decisions = (sop: Sop, userId: string) => currentInternalRound(sop)!.assignments.filter((item) => item.userId === userId).map((item) => item.decision)

/** h1 removed and h2 declined: nobody left, so the SOP is a Draft with a closed round. */
function backToDraft(): Sop {
  return decline(remove(submit(draft(), ['h1', 'h2']), 'h1'), 'h2')
}
/** Sent again from Draft to h3: the closed round reopens. */
const reopened = () => submit(backToDraft(), ['h3'])

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-10-26T10:00:00+03:00') }))
afterEach(() => vi.useRealTimers())

describe('back to Draft when nobody is left', () => {
  it.each([
    ['removed', (sop: Sop) => remove(sop, 'h1'), 'reviewer-removed'],
    ['declined', (sop: Sop) => decline(sop, 'h1'), 'review-declined'],
    ['expired', (sop: Sop) => expireUnanswered(sop, Date.parse(endOfRiyadhDay(request(sop, 'h1').responseDueDate!))), 'review-expired'],
  ] as const)('closes the round and goes back to Draft when the only request is %s, adding only that event', (_, act, event) => {
    const sent = submit(draft(), ['h1'])
    const sop = act(sent)
    expect(sop.status).toBe('draft')
    expect(currentInternalRound(sop)).toMatchObject({ id: roundId(sent), status: 'closed' })
    expect(currentInternalRound(sop)!.closedAt).toBeDefined()
    expect(currentInternalRound(sop)!.assignments).toHaveLength(1)
    expect(events(sop)).toEqual([...events(sent), event])
  })

  it('counts a reviewer who finished and was then removed as not finished', () => {
    const finished = decide(accept(submit(draft(), ['h1']), 'h1'), 'h1')
    const sop = decline(remove(addInternalReviewers(finished, 'author', { reviewerIds: ['h2'] }, env()), 'h1'), 'h2')
    expect(sop.status).toBe('draft')
    expect(currentInternalRound(sop)!.status).toBe('closed')
  })

  it('settles as before while someone is reviewing or finished', () => {
    const sent = submit(draft(), ['h1', 'h2'])
    expect(remove(sent, 'h2')).toMatchObject({ status: 'in-review' })
    expect(currentInternalRound(remove(accept(sent, 'h1'), 'h2'))!.status).toBe('open')
    expect(currentInternalRound(remove(decide(accept(sent, 'h1'), 'h1'), 'h2'))!.status).toBe('completed')
    expect(currentInternalRound(decline(decide(accept(sent, 'h1'), 'h1', 'returned'), 'h2'))!.status).toBe('changes-requested')
  })

  it('shows the closed round as "Closed: No Active Reviewers"', () => {
    expect(renderToStaticMarkup(<InternalReviewSummary sop={backToDraft()} />)).toContain('Closed: No Active Reviewers')
  })
})

describe('Submit for Review reopens the closed round', () => {
  it('reopens the same round with the new requests after the old ones, and a submitted event', () => {
    const closed = backToDraft()
    const sop = submit(closed, ['h3'])
    expect(sop.status).toBe('in-review')
    expect(sop.internalReviewRounds).toHaveLength(1)
    expect(currentInternalRound(sop)).toMatchObject({ id: roundId(closed), version: '1', status: 'open' })
    expect(currentInternalRound(sop)!.closedAt).toBeUndefined()
    expect(currentInternalRound(sop)!.assignments.map((item) => [item.userId, item.decision])).toEqual([['h1', 'removed'], ['h2', 'declined'], ['h3', 'pending']])
    expect(sop.timeline.at(-1)).toMatchObject({ type: 'submitted', recipientIds: ['h3'], reviewRoundId: roundId(closed) })
    expect(events(sop)).toEqual([...events(closed), 'submitted'])
  })

  it('keeps the first send in the author\'s department', () => {
    expect(reviewDepartmentLock('submit', hasHomeFinished(backToDraft(), users))).toBe('first-review')
    expect(() => submit(backToDraft(), ['o1'])).toThrow(/home department/)
    expect(() => submit(backToDraft(), ['h3', 'o1'])).toThrow(/home department/)
  })

  it('opens a new round instead when a new version was uploaded while Draft', () => {
    const revised = uploadVersion(backToDraft(), 'author', { fileName: 'b.pdf', fileType: 'pdf' })
    const sop = submit({ ...revised, complianceChecks: [...revised.complianceChecks, check('2')] }, ['h3'])
    expect(sop.internalReviewRounds!.map((round) => [round.version, round.status])).toEqual([['1', 'closed'], ['2', 'open']])
  })
})

describe('the department lock in the reopened round', () => {
  it('ignores the old removed and declined requests', () => {
    const sop = reopened()
    expect(hasHomeFinished(sop, users)).toBe(false)
    expect(reviewDepartmentLock('add', hasHomeFinished(sop, users))).toBe('home-must-finish')
    expect(() => addInternalReviewers(sop, 'author', { reviewerIds: ['o1'] }, env())).toThrow(/must finish/)
    expect(hasHomeFinished(accept(sop, 'h3'), users)).toBe(false)
  })

  it.each(['completed', 'returned'] as const)('opens other departments once a same-department reviewer %s it in the reopened round', (decision) => {
    const sop = decide(accept(addInternalReviewers(reopened(), 'author', { reviewerIds: ['h1'] }, env()), 'h3'), 'h3', decision)
    expect(hasHomeFinished(sop, users)).toBe(true)
    expect(reviewDepartmentLock('add', true)).toBeUndefined()
    expect(request(addInternalReviewers(sop, 'author', { reviewerIds: ['o1'] }, env()), 'o1').decision).toBe('pending')
  })

  it('does not count a completed request that was removed before the round closed', () => {
    const finished = decide(accept(submit(draft(), ['h1']), 'h1'), 'h1')
    const closed = decline(remove(addInternalReviewers(finished, 'author', { reviewerIds: ['h2'] }, env()), 'h1'), 'h2')
    const sop = submit(closed, ['h3'])
    expect(decisions(sop, 'h1')).toEqual(['removed'])
    expect(hasHomeFinished(sop, users)).toBe(false)
  })
})

describe('inviting a removed reviewer again', () => {
  it('sends them a new request, and only the latest one counts', () => {
    const sop = submit(backToDraft(), ['h1'])
    expect(decisions(sop, 'h1')).toEqual(['removed', 'pending'])
    expect(request(sop, 'h1').decision).toBe('pending')
    expect(reviewTasks('h1', [sop])[0]).toMatchObject({ group: 'todo', decision: 'pending' })
    const finished = decide(accept(sop, 'h1'), 'h1')
    expect(decisions(finished, 'h1')).toEqual(['removed', 'completed'])
    expect(hasHomeFinished(finished, users)).toBe(true)
    expect(currentInternalRound(finished)!.status).toBe('completed')
  })
})

describe('deadlines, expiry and reminders after reopening', () => {
  it('gives the new requests a fresh response deadline and review duration', () => {
    vi.setSystemTime(new Date('2026-10-29T10:00:00+03:00'))
    const sop = reopened()
    expect(request(sop, 'h3')).toMatchObject({ responseDueDate: fixedResponseDueDate(new Date()), reviewDurationDays: 3 })
    expect(request(sop, 'h3').responseDueDate).toBe('2026-11-02')
    expect(nextExpiryAt([sop])).toBe(Date.parse(endOfRiyadhDay('2026-11-02')))
    const accepted = accept(sop, 'h3')
    expect(request(accepted, 'h3').reviewDueDate).toBe('2026-11-03')
  })

  it('expires only the new unanswered request, and goes back to Draft again', () => {
    const sop = reopened()
    const expired = expireUnanswered(sop, Date.parse(endOfRiyadhDay(request(sop, 'h3').responseDueDate!)))
    expect(decisions(expired, 'h3')).toEqual(['expired'])
    expect(decisions(expired, 'h1')).toEqual(['removed'])
    expect(decisions(expired, 'h2')).toEqual(['declined'])
    expect(expired.status).toBe('draft')
    expect(currentInternalRound(expired)!.status).toBe('closed')
  })

  it('reminds the new reviewer, and never the old ones', () => {
    const sop = reopened()
    const dueSoon = Date.parse(endOfRiyadhDay(request(sop, 'h3').responseDueDate!)) - 60 * 60 * 1000
    expect(notifications('h3', sop, dueSoon).filter((item) => item.type === 'due-soon')).toHaveLength(1)
    for (const old of ['h1', 'h2']) expect(notifications(old, sop, dueSoon).filter((item) => item.type === 'due-soon' || item.type === 'overdue')).toEqual([])
    const accepted = accept(sop, 'h3')
    const reviewDue = Date.parse(endOfRiyadhDay(request(accepted, 'h3').reviewDueDate!))
    expect(notifications('h3', accepted, reviewDue).filter((item) => item.type === 'overdue')).toHaveLength(1)
    for (const old of ['h1', 'h2']) expect(notifications(old, accepted, reviewDue).filter((item) => item.type === 'due-soon' || item.type === 'overdue')).toEqual([])
  })

  it('sends an expired new request again like any other', () => {
    const sop = accept(addInternalReviewers(reopened(), 'author', { reviewerIds: ['h1'] }, env()), 'h1')
    const expired = expireUnanswered(sop, Date.parse(endOfRiyadhDay(request(sop, 'h3').responseDueDate!)))
    expect(expired.status).toBe('in-review')
    expect(request(resendInternalReview(expired, 'author', request(expired, 'h3').id, env()), 'h3').decision).toBe('pending')
  })
})

describe('My Reviews after reopening', () => {
  it('shows it as active only to the new reviewers', () => {
    const sop = reopened()
    const [task] = reviewTasks('h3', [sop])
    expect(task).toMatchObject({ group: 'todo', decision: 'pending' })
    expect(reviewerTaskSection(task)).toBe('incoming')
    expect(reviewerTaskSection(reviewTasks('h3', [accept(sop, 'h3')])[0])).toBe('active')
    expect(reviewTasks('h1', [sop])[0]).toMatchObject({ group: 'done', decision: 'removed' })
    expect(reviewTasks('h2', [sop])[0]).toMatchObject({ group: 'done', decision: 'declined' })
    for (const old of ['h1', 'h2']) expect(reviewerTaskSection(reviewTasks(old, [sop])[0])).toBe('completed')
  })

  it('shows nothing as active while it is a Draft', () => {
    for (const userId of ['h1', 'h2']) expect(reviewTasks(userId, [backToDraft()]).every((task) => task.group !== 'todo')).toBe(true)
  })
})

describe('approval, compliance and notifications around the reopened round', () => {
  it('keeps Submit for Approval blocked until a reviewer completes the reopened round', () => {
    expect(approvalButtonBlocker(backToDraft())).toBe('no-completed-review')
    const sop = reopened()
    expect(approvalButtonBlocker(sop)).toBe('no-completed-review')
    expect(approvalButtonBlocker(decide(accept(sop, 'h3'), 'h3', 'returned'))).toBe('no-completed-review')
    const completed = decide(accept(sop, 'h3'), 'h3')
    expect(approvalButtonBlocker(completed)).toBeUndefined()
    expect(requiredReviewsComplete(completed)).toBe(true)
  })

  it('allows a compliance check as a Draft, needs a current one to send it again, and refuses one while In Review', () => {
    expect(checkBlocker(backToDraft(), 'author')).toBeUndefined()
    expect(() => submit({ ...backToDraft(), complianceChecks: [] }, ['h3'])).toThrow(/compliance check/)
    expect(checkBlocker(reopened(), 'author')).toBe('status')
  })

  it('tells only the new reviewers about the reopened review, and adds no notification for going back to Draft', () => {
    const removed = remove(submit(draft(), ['h1', 'h2']), 'h1')
    const closed = decline(removed, 'h2')
    expect(closed.status).toBe('draft')
    // The last decline is the only new notification for the author: nothing for going back to Draft.
    const types = (sop: Sop) => notifications('author', sop).map((item) => item.type).sort()
    expect(types(closed)).toEqual([...types(removed), 'review-declined'].sort())
    const sop = submit(closed, ['h3'])
    expect(notifications('h3', sop).filter((item) => item.type === 'assigned-review')).toHaveLength(1)
    for (const old of ['h1', 'h2']) {
      expect(notifications(old, sop).filter((item) => item.type === 'assigned-review'))
        .toEqual(notifications(old, closed).filter((item) => item.type === 'assigned-review'))
    }
  })
})

describe('settling the reopened round', () => {
  it('completes, asks for changes, or goes back to Draft again, reopening the same round each time', () => {
    const sop = reopened()
    const id = roundId(sop)
    const completed = decide(accept(sop, 'h3'), 'h3')
    expect(currentInternalRound(completed)).toMatchObject({ id, status: 'completed' })
    expect(completed.timeline.at(-1)).toMatchObject({ type: 'internal-review-completed', reviewRoundId: id })
    expect(currentInternalRound(decide(accept(sop, 'h3'), 'h3', 'returned'))).toMatchObject({ id, status: 'changes-requested' })
    const again = remove(sop, 'h3')
    expect(again.status).toBe('draft')
    expect(currentInternalRound(again)).toMatchObject({ id, status: 'closed' })
    const third = submit(again, ['h2'])
    expect(third.internalReviewRounds).toHaveLength(1)
    expect(currentInternalRound(third)).toMatchObject({ id, status: 'open' })
    expect(decisions(third, 'h2')).toEqual(['declined', 'pending'])
  })
})
