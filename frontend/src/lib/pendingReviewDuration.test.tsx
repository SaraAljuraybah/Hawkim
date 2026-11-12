import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReviewDeadlineDialog } from '../components/workflow/ReviewDeadlineDialog'
import { ReviewTimelineTable } from '../components/workflow/ReviewTimelineTable'
import { notificationsEn } from '../content/notifications.en'
import { sopWorkflowEn } from '../content/workflow.en'
import type { Sop, User } from '../data/mock/types'
import { acceptInternalReview, changeInternalReviewDeadline, currentInternalRound, startInternalReview } from './internalReview'
import { latestAssignmentOf } from './internalReviewStatus'
import { deriveNotifications } from './notifications'
import { previewPendingDuration } from './reviewDeadline'

vi.mock('./deadlinePolicy', () => ({ WORKING_DAY_DEADLINES_ACTIVE: true }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ nameOf: (id: string) => `Name ${id}` }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ nameOf: () => 'Home' }) }))

const person = (id: string, permissions: User['permissions']): User => ({ id, name: `Name ${id}`, email: `${id}@example.test`, initials: 'NN', permissions, departmentId: 'home' })
const env = () => ({ users: [person('author', ['author']), person('a', ['reviewer']), person('b', ['reviewer'])], departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }] })
function draft(): Sop {
  return { id: 'sop', code: 'SOP-1', title: 'Durations', departmentId: 'home', authorId: 'author', coAuthorIds: [], version: '1', status: 'draft', lastUpdated: '2026-11-03', fileName: 'a.pdf', fileType: 'pdf',
    versions: [{ version: '1', fileName: 'a.pdf', fileType: 'pdf', uploadedAt: '2026-11-03T05:00:00Z' }], comments: [], timeline: [], reviewers: [], approvers: [], complianceChecks: [] }
}
const request = (sop: Sop, userId: string) => latestAssignmentOf(currentInternalRound(sop), userId)!
// Sent Tuesday 3 November 2026: the reviewers can accept until Thursday 5 November.
const sent = () => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['a', 'b'], reviewDurationDays: 3 }, env())
const changed = () => { const sop = sent(); return changeInternalReviewDeadline(sop, 'author', currentInternalRound(sop)!.id, request(sop, 'a').id, 7, env()) }

beforeEach(() => vi.useFakeTimers({ now: new Date('2026-11-03T10:00:00+03:00') }))
afterEach(() => vi.useRealTimers())

describe('the latest due date of a pending request\'s new duration', () => {
  it('counts the duration from the last day to accept, in working days', () => {
    const pending = request(sent(), 'a')
    expect(pending.responseDueDate).toBe('2026-11-05')
    expect(previewPendingDuration(pending, '7')).toEqual({ latestDueDate: '2026-11-16', long: false })
    expect(previewPendingDuration(pending, '3')).toMatchObject({ problem: 'unchanged' })
    for (const value of ['', '0', '3651', '2.5']) expect(previewPendingDuration(pending, value).problem).toBe('invalid')
    expect(previewPendingDuration(pending, '61').long).toBe(true)
  })
})

describe('the Edit dialog for a pending request', () => {
  it('changes the review duration, not a deadline, and shows the latest due date', () => {
    const html = renderToStaticMarkup(<ReviewDeadlineDialog request={request(sent(), 'a')} name="Name a" onSubmit={async () => {}} onClose={() => {}} />)
    for (const text of ['Change Review Duration for Name a', 'Current review duration: 3 working days', 'Review Duration in Working Days',
      'The review time starts when they accept (by Nov 5, 2026), excluding weekends.', 'Latest due date: Nov 10, 2026 (if they accept on the last day).', '>Change Duration<']) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('Current review deadline')
    expect(html.match(/<input[^>]*name="reviewDurationDays"[^>]*>/)![0]).toContain('value="3"')
  })

  it('keeps the deadline dialog for an accepted request', () => {
    const sop = sent()
    const accepted = acceptInternalReview(sop, 'a', currentInternalRound(sop)!.id, request(sop, 'a').id, env())
    const html = renderToStaticMarkup(<ReviewDeadlineDialog request={request(accepted, 'a')} name="Name a" onSubmit={async () => {}} onClose={() => {}} />)
    expect(html).toContain('Change Review Deadline for Name a')
    expect(html).toContain('Current review deadline:')
  })
})

describe('a changed review duration in the timeline and notifications', () => {
  it('shows a Review duration changed row with the old and new durations on the author\'s page', () => {
    const html = renderToStaticMarkup(<ReviewTimelineTable sop={changed()} content={sopWorkflowEn} mainAuthorOnly releaseScoped reasonPreview />)
    expect(html).toContain('>Review duration changed<')
    expect(html).toContain('From 3 working days to 7 working days')
    const none = { ...changed(), timeline: changed().timeline.map((event) => event.type === 'review-duration-changed' ? { ...event, previousReviewDurationDays: undefined, newReviewDurationDays: 1 } : event) }
    expect(renderToStaticMarkup(<ReviewTimelineTable sop={none} content={sopWorkflowEn} mainAuthorOnly releaseScoped />)).toContain('From no duration to 1 working day')
  })

  it('tells only that reviewer, with the new duration', () => {
    const sop = changed()
    const now = Date.now()
    expect(deriveNotifications('a', { sops: [sop], requests: [], now }).filter((item) => item.type === 'review-duration-changed'))
      .toEqual([expect.objectContaining({ actorId: 'author', reviewDurationDays: 7, link: '/reviews/sop' })])
    for (const user of ['b', 'author']) expect(deriveNotifications(user, { sops: [sop], requests: [], now }).filter((item) => item.type === 'review-duration-changed')).toEqual([])
    expect(notificationsEn.texts.reviewDurationChanged).toContain('{days}')
  })
})
