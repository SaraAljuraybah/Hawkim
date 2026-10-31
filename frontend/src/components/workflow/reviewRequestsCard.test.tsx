import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { internalReviewEn } from '../../content/internalReview.en'
import type { Department, Sop, User } from '../../data/mock/types'
import { acceptInternalReview, addInternalReviewers, currentInternalRound, decideInternalReview, declineInternalReview, removeInternalReviewer, startInternalReview, withdrawUnanswered } from '../../lib/internalReview'
import { latestAssignmentOf } from '../../lib/internalReviewStatus'
import { reviewTasks } from '../../lib/reviews'
import { ReviewsPage } from '../../pages/ReviewsPage'
import { InternalReviewPanel } from './InternalReviewPanel'
import { ReviewRequestDetails } from './ReviewRequestDetails'
import { DecisionBadge } from './DecisionBadge'
import { PeopleList } from './PeopleList'
import { sopWorkflowEn } from '../../content/workflow.en'

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
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 9, 23, 12) }); fixture.userId = 'author' })
afterEach(() => vi.useRealTimers())

describe('review requests card', () => {
  it('shows each reviewer with status, sent date, version, deadlines and reasons, without a round heading', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta', 'gamma'], responseDueDate: '2026-10-24', reviewDurationDays: 3 }, env())
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
  it('shows Pending with the response due date and duration, then Withdrawn with its date', () => {
    const sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha'], responseDueDate: '2026-10-24', reviewDurationDays: 3 }, env())
    const pending = render(<InternalReviewPanel sop={sop} canRemove />)
    expect(pending).toContain('</span>Pending</span>')
    expect(pending).toContain('If there is no response by then, the request is withdrawn.')
    expect(pending).toContain('Review duration: 3 days, starts when accepted')
    const withdrawn = withdrawUnanswered(sop, new Date(2026, 9, 24, 23, 59, 59, 999).getTime())
    const html = render(<InternalReviewPanel sop={withdrawn} canRemove />)
    expect(html).toContain('</span>Withdrawn</span>')
    expect(html).toContain('Withdrawn automatically: no response by')
    expect(html).not.toContain('starts when accepted')
  })
  it('shows Overdue once an accepted review passes its due date', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha'], reviewDurationDays: 1 }, env())
    sop = acceptInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, env())
    expect(render(<InternalReviewPanel sop={sop} canRemove />)).toContain('</span>Accepted</span>')
    vi.setSystemTime(new Date(2026, 9, 24, 23, 59, 59, 999))
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

describe('compact request cards (author SOP page)', () => {
  function reviewed() {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta', 'gamma'], reviewDurationDays: 3 }, env())
    const round = currentInternalRound(sop)!
    for (const userId of ['alpha', 'beta', 'gamma']) sop = acceptInternalReview(sop, userId, round.id, request(sop, userId).id, env())
    sop = decideInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'completed', 'Looks fine to me', env())
    return decideInternalReview(sop, 'gamma', round.id, request(sop, 'gamma').id, 'returned', 'Revise section 2', env())
  }
  it('shows the name, status, version, deadlines and Remove, without sent, accepted and decided times or comments', () => {
    const html = render(<InternalReviewPanel sop={reviewed()} canRemove activeOnly compact />)
    for (const name of ['Reviewer Alpha', 'Reviewer Beta', 'Reviewer Gamma']) expect(html).toContain(`<h3 class="text-base font-semibold text-maroon">${name}</h3>`)
    for (const label of ['Accepted', 'Completed', 'Returned with Comments']) expect(html).toContain(`</span>${label}</span>`)
    expect(html.match(/>Version v1</g)).toHaveLength(3)
    expect(html).toContain('Review due ')
    expect(html.match(/>Remove Reviewer</g)).toHaveLength(3)
    expect(html).not.toContain('Request sent ')
    expect(html).not.toContain('<p class="text-xs text-text-gray">Accepted ')
    expect(html).not.toContain('Decision submitted ')
    for (const comment of ['Looks fine to me', 'Revise section 2']) expect(html).not.toContain(comment)
  })
  it('keeps the full cards on the review page panel', () => {
    const html = render(<InternalReviewPanel sop={reviewed()} canRemove={false} />)
    for (const text of ['Request sent ', '<p class="text-xs text-text-gray">Accepted ', 'Decision submitted ', 'Looks fine to me', 'Revise section 2']) expect(html).toContain(text)
  })
})

describe('review requests card with only active reviewers (author SOP page)', () => {
  const heading = (name: string) => `<h3 class="text-base font-semibold text-maroon">${name}</h3>`
  it('leaves out reviewers whose latest request was removed, declined or withdrawn', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta', 'gamma'], reviewDurationDays: 3 }, env())
    const round = currentInternalRound(sop)!
    sop = acceptInternalReview(sop, 'alpha', round.id, request(sop, 'alpha').id, env())
    sop = declineInternalReview(sop, 'beta', round.id, request(sop, 'beta').id, 'On leave', env())
    sop = removeInternalReviewer(sop, 'author', round.id, request(sop, 'gamma').id, 'Asked the wrong person', env())
    const html = render(<InternalReviewPanel sop={sop} canRemove activeOnly />)
    expect(html).toContain(heading('Reviewer Alpha'))
    expect(html).toContain('</span>Accepted</span>')
    for (const name of ['Reviewer Beta', 'Reviewer Gamma']) expect(html).not.toContain(heading(name))
    for (const label of ['Declined', 'Removed']) expect(html).not.toContain(`</span>${label}</span>`)
    expect(html).not.toContain('Reason: On leave')
    expect(html).not.toContain(internalReviewEn.panel.noActive)
    expect(html.match(/>Remove Reviewer</g)).toHaveLength(1)
    // The data is unchanged, and the review page (without activeOnly) still lists everyone.
    expect(request(sop, 'beta').decision).toBe('declined')
    for (const name of ['Reviewer Alpha', 'Reviewer Beta', 'Reviewer Gamma']) expect(render(<InternalReviewPanel sop={sop} canRemove={false} />)).toContain(heading(name))
  })
  it('hides earlier inactive requests of a reviewer who was asked again', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta'] }, env())
    sop = declineInternalReview(sop, 'alpha', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'On leave', env())
    sop = addInternalReviewers(sop, 'author', { reviewerIds: ['alpha'] }, env())
    const html = render(<InternalReviewPanel sop={sop} canRemove activeOnly />)
    expect(html).toContain(heading('Reviewer Alpha'))
    expect(html).toContain('</span>Pending</span>')
    expect(html).not.toContain('</span>Declined</span>')
    expect(render(<InternalReviewPanel sop={sop} canRemove />)).toContain('</span>Declined</span>')
  })
  it('shows "No active reviewers." when nobody is taking part any more', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta'], responseDueDate: '2026-10-24' }, env())
    sop = removeInternalReviewer(sop, 'author', currentInternalRound(sop)!.id, request(sop, 'beta').id, 'Not needed', env())
    sop = withdrawUnanswered(sop, new Date(2026, 9, 24, 23, 59, 59, 999).getTime())
    const html = render(<InternalReviewPanel sop={sop} canRemove activeOnly />)
    expect(html).toContain(`<p class="text-sm text-text-gray">${internalReviewEn.panel.noActive}</p>`)
    expect(html).toContain(internalReviewEn.panel.title)
    expect(html).not.toContain('<h3')
    expect(html).not.toContain('</span>Withdrawn</span>')
  })
  it('announces a removal to screen readers only, and can focus the panel heading', () => {
    const sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha'] }, env())
    const html = render(<InternalReviewPanel sop={sop} canRemove activeOnly />)
    expect(html).toContain('<div role="status" class="sr-only"></div>')
    expect(html).toMatch(/<h2 id="internal-review-title" tabindex="-1"[^>]*>Internal Review Requests<\/h2>/)
  })
})

describe('My Reviews', () => {
  it('shows the reviewer the same request details, and keeps removed and withdrawn requests in Done', () => {
    let sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['alpha', 'beta'], responseDueDate: '2026-10-24', reviewDurationDays: 3 }, env())
    fixture.sop = sop
    fixture.userId = 'alpha'
    const todo = render(<ReviewsPage />)
    expect(todo).toContain('</span>Pending</span>')
    expect(todo).toContain('Request sent ')
    expect(todo).toContain(internalReviewEn.panel.version.replace('{version}', '1'))
    expect(todo).toContain('Review duration: 3 days, starts when accepted')
    sop = removeInternalReviewer(sop, 'author', currentInternalRound(sop)!.id, request(sop, 'alpha').id, 'Covered by another team', env())
    sop = withdrawUnanswered(sop, new Date(2026, 9, 24, 23, 59, 59, 999).getTime())
    expect(reviewTasks('alpha', [sop])[0]).toMatchObject({ group: 'done', decision: 'removed' })
    expect(reviewTasks('beta', [sop])[0]).toMatchObject({ group: 'done', decision: 'withdrawn' })
    expect(render(<ReviewRequestDetails sop={sop} request={request(sop, 'alpha')} />)).toContain('Reason: Covered by another team')
    expect(render(<ReviewRequestDetails sop={sop} request={request(sop, 'beta')} />)).toContain('Withdrawn automatically: no response by')
  })
})
