import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Department, Sop, User, UserRequest } from '../data/mock/types'
import { MySopsPage } from './MySopsPage'
import { UploadSopPage } from './UploadSopPage'
import { SopsPage } from './SopsPage'
import { SopDetailPage } from './SopDetailPage'
import { SopWorkflowPage } from './SopWorkflowPage'
import { ReviewPage } from './ReviewPage'
import { DashboardPage } from './DashboardPage'
import { DepartmentSwitcher } from '../components/layout/DepartmentSwitcher'
import { appShellEn } from '../content/app.en'
import { approvalEn } from '../content/approval.en'
import { internalReviewEn } from '../content/internalReview.en'
import { reviewsEn } from '../content/reviews.en'
import { sopWorkflowEn } from '../content/workflow.en'

const fixture = vi.hoisted(() => ({
  user: { id: 'visitor', name: 'Visitor', initials: 'VV', email: 'v@example.test', departmentId: 'home', permissions: ['author', 'reviewer', 'approver'] } as User,
  home: { id: 'home', name: 'Home Department', initials: 'HM', description: '' } as Department,
  other: { id: 'other', name: 'Foreign Directory', initials: 'OT', description: '' } as Department,
  requests: [] as UserRequest[], sops: [] as Sop[],
}))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user, useSession: () => ({ status: 'signed-in', user: fixture.user }) }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({
  activeDepartment: fixture.other, homeDepartment: fixture.home, directoryDepartments: [fixture.home, fixture.other], setActiveDepartment: vi.fn(),
}) }))
vi.mock('../state/requestsContext', () => ({
  useMyRequests: () => fixture.requests.filter((request) => request.requesterId === fixture.user.id),
  useRequests: () => ({ requests: fixture.requests }),
}))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops, addDraft: vi.fn() }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: [fixture.user], activeUsers: [fixture.user], nameOf: (id: string) => id, getUser: (id: string) => id === fixture.user.id ? fixture.user : undefined }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({
  departments: [fixture.home, fixture.other], activeDepartments: [fixture.home, fixture.other],
  nameOf: (id: string) => id === 'home' ? fixture.home.name : fixture.other.name,
  getDepartment: (id: string) => [fixture.home, fixture.other].find((department) => department.id === id),
}) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' }, getRequirement: () => undefined }) }))

const grant = (status: UserRequest['status']): UserRequest => ({ id: 'access', type: 'department-access', departmentId: 'other', requesterId: 'visitor', title: 'Access', description: '', status, createdAt: '2026-10-23' })
function sop(id: string, departmentId: string, status: Sop['status'], authorId = 'writer'): Sop {
  return { id, code: id, title: id, departmentId, status, authorId, coAuthorIds: [], version: '1', lastUpdated: '2026-10-23', description: 'Confidential multiline description', fileName: id + '.docx', fileType: 'docx', fileUrl: '/files/' + id + '.docx', versions: [], reviewers: [], approvers: [], timeline: [], comments: [], complianceChecks: [] }
}
function render(page: ReactNode, url = '/test') {
  return renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Routes><Route path="/:id" element={page} /></Routes></MemoryRouter>)
}
beforeEach(() => {
  fixture.user.permissions = ['author', 'reviewer', 'approver']
  fixture.requests = [grant('approved')]
  fixture.sops = [
    sop('home-owned', 'home', 'draft', 'visitor'), sop('foreign-owned', 'other', 'draft', 'visitor'), sop('foreign-private', 'other', 'draft'),
    sop('foreign-published', 'other', 'published'),
    { ...sop('foreign-reviewed', 'other', 'published'), reviewers: [{ userId: 'visitor', decision: 'completed' }] },
  ]
})

describe('directory selection never changes authoring or membership context', () => {
  it('keeps My SOPs home-scoped even with an approved foreign directory selected', () => {
    const html = render(<MySopsPage />)
    expect(html).toContain('home-owned')
    expect(html).toContain('Home Department')
    expect(html).not.toContain('foreign-owned')
    expect(html).not.toContain('foreign-private')
    expect(html).not.toContain('Foreign Directory')
  })
  it('keeps uploads and dashboard context in the home department', () => {
    for (const Page of [UploadSopPage, DashboardPage]) {
      const html = render(<Page />)
      expect(html).toContain('Home Department')
      expect(html).not.toContain('Foreign Directory')
    }
  })
  it('labels the selector as directory browsing and read-only for a foreign department', () => {
    const html = render(<DepartmentSwitcher content={appShellEn.departmentSwitcher} variant="topbar" />)
    expect(html).toContain('SOP Directory')
    expect(html).toContain('Foreign Directory')
    expect(html).toContain('(Read-only)')
  })
  it('keeps the top bar switcher\'s keyboard focus ring tight, so it never covers the name above', () => {
    const html = render(<DepartmentSwitcher content={appShellEn.departmentSwitcher} variant="topbar" />)
    expect(html.match(/<button[^>]*aria-haspopup="menu"[^>]*>/)![0]).toContain('focus-visible:outline-offset-0')
  })
  it('never cuts the department name in the top bar, keeping the chevron', () => {
    const html = render(<DepartmentSwitcher content={appShellEn.departmentSwitcher} variant="topbar" />)
    expect(html).not.toContain('truncate')
    expect(html).toContain('break-words')
    expect(html.match(/<button[^>]*aria-haspopup="menu"[^>]*>.*?<\/button>/)![0]).toContain('lucide-chevron-down')
  })
  it('lists only the published SOPs the user worked on, whatever the selected directory or access requests', () => {
    const html = render(<SopsPage />)
    expect(html).toContain('foreign-reviewed')
    // Published but not theirs: not listed, even with an approved request for that directory.
    expect(html).not.toContain('foreign-published')
    // Theirs but not published: not listed.
    expect(html).not.toContain('foreign-private')
    expect(html).not.toContain('foreign-owned')
    expect(html).not.toContain('home-owned')
    for (const status of ['pending', 'rejected'] as const) {
      fixture.requests = [grant(status)]
      expect(render(<SopsPage />)).toContain('foreign-reviewed')
    }
  })
  it('keeps the non-admin toolbar as it was: no Filter panel, and Clear Filters while searching', () => {
    const html = render(<SopsPage />, '/test?q=nothing-matches')
    expect(html).not.toContain('>Filter</label>')
    expect(html).not.toContain('>Clear all</button>')
    expect(html).toContain('>Clear Filters<')
    expect(render(<SopsPage />)).not.toContain('>Clear Filters<')
  })
  it('offers Sort By next to the search, Newest to Oldest by default, and stacks on small screens', () => {
    fixture.sops = [{ ...sop('older-sop', 'other', 'published', 'visitor'), lastUpdated: '2026-01-01' }, { ...sop('newer-sop', 'other', 'published', 'visitor'), lastUpdated: '2026-10-01' }]
    const html = render(<SopsPage />)
    for (const text of ['Sort By', 'Newest to Oldest', 'Oldest to Newest']) expect(html).toContain(text)
    expect(html.indexOf('Search SOPs')).toBeLessThan(html.indexOf('Sort By'))
    expect(html).not.toContain('Document Type')
    expect(html).toMatch(/<option value="newest"[^>]* selected="">Newest to Oldest<\/option>/)
    // The row of every list page (Search | Sort here), on the page background.
    expect(html).toContain('<div role="search" aria-label="Search and filter SOPs" class="mt-6"><div class="relative grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">')
    expect(html.indexOf('newer-sop')).toBeLessThan(html.indexOf('older-sop'))
  })
})

describe('published directory access remains separate from internal views', () => {
  it('permits the published description and download of an SOP they worked on, with no author or review controls', () => {
    const html = render(<SopDetailPage />, '/foreign-reviewed')
    expect(html).toContain('Confidential multiline description')
    expect(html).toContain('/files/foreign-reviewed.docx')
    for (const label of [
      internalReviewEn.actions.accept, internalReviewEn.actions.decline,
      internalReviewEn.actions.complete, internalReviewEn.actions.returnToAuthor,
      reviewsEn.page.actions.approve, reviewsEn.page.actions.publish,
      sopWorkflowEn.actions.submit, sopWorkflowEn.history.upload,
      sopWorkflowEn.people.addAuthor, approvalEn.action,
    ]) expect(html).not.toContain(`>${label}</button>`)
  })
  it.each(['pending', 'rejected', 'cancelled'] as const)('does not expose document content for a %s request', (status) => {
    fixture.requests = [grant(status)]
    const html = render(<SopDetailPage />, '/foreign-published')
    expect(html).not.toContain('Confidential multiline description')
    expect(html).not.toContain('/files/foreign-published.docx')
  })
  it('does not open an unpublished directory document or unassigned workflow/review page', () => {
    for (const Page of [SopDetailPage, SopWorkflowPage, ReviewPage]) {
      const html = render(<Page />, '/foreign-private')
      expect(html).not.toContain('Confidential multiline description')
      expect(html).not.toContain('/files/foreign-private.docx')
    }
  })
  it('keeps home-role navigation permissions unchanged', () => {
    fixture.user.permissions = []
    expect(render(<MySopsPage />)).not.toContain('home-owned')
    expect(render(<UploadSopPage />)).not.toContain('Upload SOP')
    expect(render(<SopDetailPage />, '/foreign-reviewed')).toContain('/files/foreign-reviewed.docx')
  })

  it('shows the no-access panel, without Request Access, for a published SOP they didn\'t work on (a direct link)', () => {
    const html = render(<SopDetailPage />, '/foreign-published')
    expect(html).toContain("You don&#x27;t have access to this SOP")
    expect(html).toContain('You can open the published SOPs you authored, co-authored, reviewed or approved.')
    expect(html).not.toContain('Confidential multiline description')
    expect(html).not.toContain('/files/foreign-published.docx')
    expect(html).not.toContain('Request Access')
    expect(html).not.toContain('/requests/new')
  })
})
