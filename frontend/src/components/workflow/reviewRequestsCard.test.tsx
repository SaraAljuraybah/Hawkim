import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { internalReviewEn } from '../../content/internalReview.en'
import type { Department, Sop, User } from '../../data/mock/types'
import { acceptInternalReview, currentInternalRound, decideInternalReview, declineInternalReview, removeInternalReviewer, startInternalReview, expireUnanswered } from '../../lib/internalReview'
import { latestAssignmentOf } from '../../lib/internalReviewStatus'
import { endOfRiyadhDay } from '../../lib/riyadhWorkingDays'
import { reviewTasks } from '../../lib/reviews'
import { ReviewsPage } from '../../pages/ReviewsPage'
import { InternalReviewPanel } from './InternalReviewPanel'
import { ReviewRequestDetails } from './ReviewRequestDetails'
import { DecisionBadge } from './DecisionBadge'
import { PeopleList } from './PeopleList'
import { sopWorkflowEn } from '../../content/workflow.en'
// These tests cover the Riyadh working-day policy as it behaves once activated (lib/deadlinePolicy.ts).
// The pending (currently active) backend-compatible behaviour is covered in lib/deadlinePolicy.test.tsx.
vi.mock('../../lib/deadlinePolicy', () => ({ WORKING_DAY_DEADLINES_ACTIVE: true }))

const fixture = vi.hoisted(() => ({
  userId: 'author', sop: null as Sop | null,
  users: [
    { id: 'author', name: 'Main Author', permissions: ['author'], departmentId: 'home' },
    { id: 'alpha', name: 'Reviewer Alpha', permissions: ['reviewer'], departmentId: 'home' },
    { id: 'beta', name: 'Reviewer Beta', permissions: ['reviewer'], departmentId: 'home' },
    { id: 'gamma', name: 'Reviewer Gamma', permissions: ['reviewer'], departmentId: 'home' },
  ] as User[],
  departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }] as Department[],
}))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users.find((user) => user.id === fixture.userId) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? id ?? '' }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments, nameOf: () => 'Home' }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop], removeInternalReviewer: vi.fn() }) }))

const env = () => ({ users: fixture.users, departments: fixture.departments })
function draft(): Sop {
  return { id: 'test', code: 'TEST', title: 'Card fixture', version: '1', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'draft', lastUpdated: '2026-10-23', fileName: 'test.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString() }], reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [{ id: 'check', sopId: 'test', version: '1', status: 'completed', startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] }] }
}
const request = (sop: Sop, userId: string) => latestAssignmentOf(currentInternalRound(sop), userId)!
function render(node: ReactNode) { return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>) }
beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-10-23T12:00:00+03:00') }); fixture.userId = 'author' })
afterEach(() => vi.useRealTimers())

describe('review requests card', () => {
  it('shows each reviewer with status, sent date, version, deadlines and reasons, without a round heading', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta', 'gamma'], reviewDurationDays: 3 }, env())
    const round = currentInternalRound(sop)!
    sop = acceptInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, env())
    sop = declineInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'On leave', env())
    sop = removeInternalReviewer(sop, 'author', round.id, request(sop, 'gamma').id, 'Asked the wrong person', env())
    const html = render(<InternalReviewPanel sop={sop} canRemove />)
    expect(html).not.toContain('Review round')
    for (const name of ['Reviewer Alpha', 'Reviewer Beta', 'Reviewer Gamma']) expect(html).toContain(`<h3 class="text-base font-semibold text-maroon">${name}</h3>`)
    for (const label of ['Accepted', 'Declined', 'Removed']) expect(html).toContain(`</span>${label}</span>`)
    expect(html).toContain('Request sent ')
    expect(html).toContain(internalReviewEn.panel.version.replace('{version}', '1'))
    expect(html).toContain('Review due ')
    expect(html).toContain('Reason: On leave')
    expect(html).toContain('Reason: Asked the wrong person')
    // Remove is offered for everyone not already removed, whatever their status.
    expect(html.match(/>Remove Reviewer</g)).toHaveLength(2)
    expect(render(<InternalReviewPanel sop={sop} canRemove={false} />)).not.toContain('>Remove Reviewer<')
  })
  it('shows Pending with the response due date and duration, then Expired with its date', () => {
    const sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha'], reviewDurationDays: 3 }, env())
    const pending = render(<InternalReviewPanel sop={sop} canRemove />)
    expect(pending).toContain('</span>Pending</span>')
    expect(pending).toContain('If there is no response by then, the request expires.')
    expect(pending).toContain('Review duration: 3 working days')
    const expired = expireUnanswered(sop, Date.parse(endOfRiyadhDay('2026-10-26')))
    const html = render(<InternalReviewPanel sop={expired} canRemove />)
    expect(html).toContain('</span>Expired</span>')
    expect(html).toContain('Expired: no response by')
    expect(html).not.toContain('Withdrawn')
    expect(html).not.toContain('starts when accepted')
  })
  it('shows Overdue once an accepted review passes its due date', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha'], reviewDurationDays: 1 }, env())
    sop = acceptInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, env())
    expect(render(<InternalReviewPanel sop={sop} canRemove />)).toContain('</span>Accepted</span>')
    vi.setSystemTime(Date.parse(endOfRiyadhDay('2026-10-25')))
    const html = render(<InternalReviewPanel sop={sop} canRemove />)
    expect(html).toContain('</span>Overdue</span>')
    expect(html).toContain('Review overdue')
    // Overdue only marks the request: it is still accepted.
    expect(request(sop, 'alpha').decision).toBe('accepted')
  })
})

describe('review request status colours', () => {
  const badge = (html: string, label: string) => html.match(new RegExp(`<span class="([^"]*)"><span aria-hidden="true"[^>]*></span>${label}</span>`))?.[1] ?? ''
  it('shows Accepted in green and Completed in the maroon tint, other statuses unchanged', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta', 'gamma'] }, env())
    const round = currentInternalRound(sop)!
    sop = acceptInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, env())
    sop = acceptInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, env())
    sop = decideInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'completed', undefined, env())
    const html = render(<InternalReviewPanel sop={sop} canRemove />)
    expect(badge(html, 'Accepted')).toContain('bg-status-approved-bg text-status-approved-fg')
    expect(badge(html, 'Completed')).toContain('bg-status-published-bg text-status-published-fg')
    expect(badge(html, 'Pending')).toContain('bg-status-pending-bg text-status-pending-fg')
    // The People section shows the same reviewer's Completed in the same colour.
    const people = render(<PeopleList sop={sop} content={sopWorkflowEn.people} userId="author" canManageCoAuthors={false} onAddCoAuthor={() => {}} onRemoveCoAuthor={() => {}} />)
    expect(badge(people, 'Completed')).toContain('bg-status-published-bg text-status-published-fg')
  })
  it('uses the same colours for a legacy reviewer Completed, while an approver Approved stays green', () => {
    const labels = { completed: 'Completed', approved: 'Approved' }
    expect(badge(renderToStaticMarkup(<DecisionBadge decision="completed" labels={labels} />), 'Completed')).toContain('bg-status-published-bg text-status-published-fg')
    expect(badge(renderToStaticMarkup(<DecisionBadge decision="approved" labels={labels} />), 'Approved')).toContain('bg-status-approved-bg text-status-approved-fg')
  })
})

describe('review requests card', () => {
  it('keeps the full cards on the review page panel', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta'], reviewDurationDays: 3 }, env())
    const round = currentInternalRound(sop)!
    for (const userId of ['alpha', 'beta']) sop = acceptInternalReview(sop, userId, round.id, request(sop, userId).id, env())
    sop = decideInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, 'completed', 'Looks fine to me', env())
    sop = decideInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'returned', 'Revise section 2', env())
    const html = render(<InternalReviewPanel sop={sop} canRemove={false} />)
    for (const text of ['Request sent ', '<p class="text-xs text-text-gray">Accepted ', 'Decision submitted ', 'Looks fine to me', 'Revise section 2']) expect(html).toContain(text)
    expect(html).not.toContain('<table')
  })
  it('announces a removal to screen readers only, and can focus the panel heading', () => {
    const sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha'] }, env())
    const html = render(<InternalReviewPanel sop={sop} canRemove />)
    expect(html).toContain('<div role="status" class="sr-only"></div>')
    expect(html.match(/<h2 id="internal-review-title" tabindex="-1"[^>]*>([^<]+)<\/h2>/)?.[1]).toBe(internalReviewEn.panel.title)
  })
})

describe('My Reviews', () => {
  it('shows the reviewer the same request details, and keeps removed and expired requests in Done', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta'], reviewDurationDays: 3 }, env())
    fixture.sop = sop
    fixture.userId = 'alpha'
    const todo = render(<ReviewsPage />)
    expect(todo).toContain('</span>Pending</span>')
    expect(todo).toContain('Request sent ')
    expect(todo).toContain(internalReviewEn.panel.version.replace('{version}', '1'))
    expect(todo).toContain('Review duration: 3 working days')
    sop = removeInternalReviewer(sop, 'author', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'Covered by another team', env())
    sop = expireUnanswered(sop, Date.parse(endOfRiyadhDay('2026-10-26')))
    expect(reviewTasks('alpha', [sop])[0]).toMatchObject({ group: 'done', decision: 'removed' })
    expect(reviewTasks('beta', [sop])[0]).toMatchObject({ group: 'done', decision: 'expired' })
    expect(render(<ReviewRequestDetails sop={sop} request={request(sop, 'alpha')} />)).toContain('Reason: Covered by another team')
    expect(render(<ReviewRequestDetails sop={sop} request={request(sop, 'beta')} />)).toContain('Expired: no response by')
  })
})
