import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Sop, User } from '../data/mock/types'
import { projectReviewers } from '../lib/internalReviewStatus'
import { visibleSops } from '../state/visibleSops'
import { ReviewPage } from './ReviewPage'
import { internalReviewEn } from '../content/internalReview.en'
import { sopWorkflowEn } from '../content/workflow.en'
import { reviewsEn } from '../content/reviews.en'

const fixture = vi.hoisted(() => ({ sops: [] as Sop[], user: {
  id: 'reviewer', name: 'Reviewer', email: 'reviewer@demo.test', initials: 'RR', departmentId: 'home', permissions: ['reviewer'],
} as User }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user, useSession: () => ({ status: 'signed-in', user: fixture.user }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ nameOf: (id: string) => id, getUser: () => fixture.user }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home' }], nameOf: () => 'Home' }) }))

function source(): Sop {
  const old = { id: 'old-round', scope: 'internal' as const, version: '1', status: 'open' as const, requestedById: 'author', requestedAt: '2026-10-25T08:00:00Z', assignedDueDays: null,
    assignments: [{ id: 'old-task', userId: 'reviewer', decision: 'accepted' as const, assignedAt: '2026-10-25T08:00:00Z', acceptedAt: '2026-10-26T08:00:00Z', reviewDueAt: '2026-10-28T20:59:59.999Z', reviewDueDate: '2026-10-28', reviewDurationDays: 2 }] }
  return { id: 'test', code: 'SOP-001', title: 'Historical review', description: 'Preserved description', departmentId: 'home', authorId: 'author', coAuthorIds: [], status: 'in-review', version: '2', lastUpdated: '2026-10-29',
    fileName: 'private-v2.pdf', fileType: 'pdf', fileUrl: '/private-v2.pdf',
    versions: [{ version: '1', fileName: 'old.pdf', fileType: 'pdf', fileUrl: '/old.pdf', uploadedAt: old.requestedAt }, { version: '2', fileName: 'private-v2.pdf', fileType: 'pdf', fileUrl: '/private-v2.pdf', uploadedAt: '2026-10-29T08:00:00Z' }],
    internalReviewRounds: [old, { ...old, id: 'new-round', version: '2', assignments: [{ ...old.assignments[0], id: 'new-task', userId: 'other' }] }],
    reviewers: [{ userId: 'other', decision: 'pending' }], approvers: [], timeline: [], comments: [], complianceChecks: [] }
}
function render() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/reviews/test']}><Routes><Route path="/reviews/:id" element={<ReviewPage />} /></Routes></MemoryRouter>)
}
beforeEach(() => { vi.useFakeTimers({ now: new Date('2026-10-29T09:00:00Z') }); fixture.sops = [] })
afterEach(() => vi.useRealTimers())

describe('historical review page as a complete authorized view', () => {
  it('stops clocks and task actions in every section, including People', () => {
    fixture.sops = visibleSops([source()], fixture.user, [])
    const html = render()
    expect(html).toContain('Historical review of v1')
    expect(html).toContain('Preserved description')
    expect(html).toContain('/old.pdf')
    expect(html).not.toContain('private-v2')
    for (const text of [
      internalReviewEn.panel.remainingTime.split('{duration}')[0], internalReviewEn.panel.reviewOverdue,
      '>' + internalReviewEn.panel.decisions.overdue + '<', '>' + internalReviewEn.actions.inProgress + '<',
      '>' + sopWorkflowEn.reviewerDeadline.active + '<', '>' + internalReviewEn.actions.complete + '<',
      '>' + internalReviewEn.actions.accept + '<', '>' + reviewsEn.page.actions.approve + '<',
    ]) expect(html).not.toContain(text)
  })

  it('preserves current reviewer actions and clocks through the same context projection', () => {
    const current = source()
    current.version = '1'
    current.internalReviewRounds = [current.internalReviewRounds![0]]
    current.reviewers = projectReviewers(current.internalReviewRounds[0])
    fixture.sops = visibleSops([current], fixture.user, [])
    const html = render()
    expect(html).toContain('Review overdue')
    expect(html).toContain('>' + internalReviewEn.actions.complete + '<')
    expect(html).not.toContain('Historical review of v1')
    expect(html).not.toContain('>' + reviewsEn.page.actions.approve + '<')
  })
})
