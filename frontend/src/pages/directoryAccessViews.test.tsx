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

const fixture = vi.hoisted(() => ({
  user: { id: 'visitor', name: 'Visitor', initials: 'VV', email: 'v@example.test', departmentId: 'home', permissions: ['author', 'reviewer', 'approver'] } as User,
  home: { id: 'home', name: 'Home Department', initials: 'HM', description: '' } as Department,
  other: { id: 'other', name: 'Foreign Directory', initials: 'OT', description: '' } as Department,
  requests: [] as UserRequest[], sops: [] as Sop[],
}))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
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
  fixture.sops = [sop('home-owned', 'home', 'draft', 'visitor'), sop('foreign-owned', 'other', 'draft', 'visitor'), sop('foreign-private', 'other', 'draft'), sop('foreign-published', 'other', 'published')]
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
  it('lists only authorized published data, regardless of the selected context', () => {
    const html = render(<SopsPage />)
    expect(html).toContain('foreign-published')
    expect(html).not.toContain('foreign-private')
    expect(html).not.toContain('foreign-owned')
    fixture.requests = [grant('pending')]
    expect(render(<SopsPage />)).not.toContain('foreign-published')
    fixture.requests = [grant('rejected')]
    expect(render(<SopsPage />)).not.toContain('foreign-published')
  })
})

describe('published directory access remains separate from internal views', () => {
  it('permits the published description and download with no author or review controls', () => {
    const html = render(<SopDetailPage />, '/foreign-published')
    expect(html).toContain('Confidential multiline description')
    expect(html).toContain('/files/foreign-published.docx')
    for (const label of ['Cancel review request', 'Complete review', 'Reject SOP', 'Upload a new version']) expect(html).not.toContain(label)
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
    expect(render(<SopDetailPage />, '/foreign-published')).toContain('/files/foreign-published.docx')
  })
})
