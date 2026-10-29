import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Sop, User } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { sopsEn } from '../content/sops.en'
import { internalReviewEn } from '../content/internalReview.en'
import { sopWorkflowEn } from '../content/workflow.en'
import { notificationsEn } from '../content/notifications.en'
import { adminEn } from '../content/admin.en'
import { SopGrid } from '../components/sops/SopGrid'
import { SopList } from '../components/sops/SopList'
import { NotificationsBell } from '../components/layout/NotificationsBell'
import { SopWorkflowPage } from './SopWorkflowPage'
import { SopDetailPage } from './SopDetailPage'
import { ReviewPage } from './ReviewPage'
import { ComplianceReportPage } from './ComplianceReportPage'
import { UploadSopPage } from './UploadSopPage'
import { sopTitleProblem } from '../lib/sopTitle'
import { deriveNotifications } from '../lib/notifications'
import { sopDownloadName, sopFileLabel } from '../lib/sopPresentation'

const fixture = vi.hoisted(() => ({ sop: null as Sop | null, userId: 'author', titles: [] as (string | undefined)[], users: [
  { id: 'author', name: 'Main Writer', departmentId: 'home', permissions: ['author'] },
  { id: 'coauthor', name: 'Co Writer', departmentId: 'home', permissions: ['author'] },
  { id: 'reviewer', name: 'Current Reviewer', departmentId: 'home', permissions: ['reviewer'] },
] as User[] }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title: string | undefined) => fixture.titles.push(title) }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.users.find((user) => user.id === fixture.userId) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? id ?? '', getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true }], nameOf: () => 'Home' }) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop] }) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [] }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ activeDepartment: { id: 'home' }, homeDepartment: { id: 'home' } }) }))
vi.mock('../state/notificationsContext', () => ({ useNotifications: () => ({ notifications: deriveNotifications('reviewer', { sops: [fixture.sop!], requests: [], now: Date.parse('2026-10-29T09:00:00Z') }), unreadCount: 1, now: Date.parse('2026-10-29T09:00:00Z') }) }))

function render(page: ReactNode) {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/test']}><Routes><Route path="/:id" element={page} /></Routes></MemoryRouter>)
}
function reviewSop(): Sop {
  return { ...fixture.sop!, status: 'in-review', reviewers: [{ userId: 'reviewer', decision: 'pending' }], timeline: [{ id: 'sent', type: 'submitted', actorId: 'author', recipientIds: ['reviewer'], createdAt: '2026-10-29T08:00:00Z', version: '1' }] }
}

beforeEach(() => {
  fixture.userId = 'author'
  fixture.titles = []
  fixture.sop = { ...sops[0], id: 'test', code: 'SOP-SECRET', title: 'Visible Procedure', departmentId: 'home', authorId: 'author', coAuthorIds: ['coauthor'], status: 'draft', version: '1', fileName: 'SOP-SECRET.pdf', fileUrl: 'blob:document', fileType: 'pdf', description: 'Line one\nLine two', versions: [{ version: '1', fileName: 'SOP-SECRET.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T08:00:00Z', uploadedById: 'author', fileUrl: 'blob:document' }], reviewers: [], approvers: [], internalReviewRounds: undefined, reviewFlow: undefined, comments: [], timeline: [], complianceChecks: [] }
})

describe('SOP title presentation without exposing generated serial numbers', () => {
  it('uses titles in directory cards, rows, workflow/details, review metadata, reports and page titles', () => {
    for (const component of [<SopGrid key="grid" sops={[fixture.sop!]} content={sopsEn} />, <SopList key="list" sops={[fixture.sop!]} content={sopsEn} />, <SopWorkflowPage key="workflow" />, <ComplianceReportPage key="report" />]) {
      const html = render(component)
      expect(html).not.toContain('SOP-SECRET')
      expect(html).toContain('Visible Procedure')
    }
    fixture.sop = { ...fixture.sop!, status: 'published' }
    expect(render(<SopDetailPage />)).not.toContain('SOP-SECRET')
    fixture.sop = reviewSop()
    fixture.userId = 'reviewer'
    const detail = render(<ReviewPage />)
    expect(detail).not.toContain('SOP-SECRET')
    expect(detail).toContain('Visible Procedure_v1.pdf')
    expect(detail).toContain('Line one\nLine two')
    expect(fixture.titles.filter(Boolean).every((title) => !title!.includes('SOP-SECRET'))).toBe(true)
    expect(fixture.titles).toContain('Review Visible Procedure | Hawkim')
  })

  it('uses title-based download names while retaining stored identity, file metadata and routes', () => {
    const before = structuredClone(fixture.sop)
    const html = render(<SopWorkflowPage />)
    expect(html).toContain('download="Visible Procedure_v1.pdf"')
    expect(fixture.sop).toEqual(before)
    expect(sopFileLabel(fixture.sop!)).toBe('Visible Procedure_v1.pdf')
    expect(sopFileLabel({ ...fixture.sop!, fileName: 'uploaded-document.pdf' })).toBe('uploaded-document.pdf')
    expect(sopDownloadName('  Procedure / Safe: Handling?  ', '2', 'docx')).toBe('Procedure Safe Handling_v2.docx')
  })

  it('uses SOP titles in notifications while keeping notification identities and links unchanged', () => {
    fixture.sop = reviewSop()
    fixture.userId = 'reviewer'
    const notification = deriveNotifications('reviewer', { sops: [fixture.sop], requests: [], now: Date.parse('2026-10-29T09:00:00Z') })[0]
    expect(notification).toMatchObject({ sopCode: 'SOP-SECRET', sopTitle: 'Visible Procedure', link: '/reviews/test' })
    const html = render(<NotificationsBell />)
    expect(html).toContain('Main Writer submitted Visible Procedure')
    expect(html).not.toContain('SOP-SECRET')
    expect(notificationsEn.texts.submitted).not.toContain('{code}')
    expect(adminEn.userDetails.blockers.sopWithStatus).toContain('{title}')
  })
})

describe('author workflow section layout', () => {
  it('requires an SOP title of at most 50 characters without changing existing saved titles', () => {
    const html = render(<UploadSopPage />)
    const input = html.match(/<input[^>]*name="title"[^>]*>/)![0]
    expect(input).toContain('required=""')
    expect(input).toContain('maxLength="50"')
    expect(input).toContain('aria-describedby=')
    expect(sopTitleProblem('   ')).toBe('required')
    expect(sopTitleProblem('x'.repeat(50))).toBeUndefined()
    expect(sopTitleProblem('x'.repeat(51))).toBe('too-long')
  })

  it('keeps the initial Add Reviewers action in Reviewers, with the required section order and no actions in Timeline', () => {
    const html = render(<SopWorkflowPage />)
    const ids = ['authors-title', 'history-title', 'compliance-title', 'internal-review-title', 'timeline-title']
    const positions = ids.map((id) => html.indexOf(`id="${id}"`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    const reviewers = html.slice(positions[3], html.indexOf('</section>', positions[3]))
    expect(reviewers).toContain(internalReviewEn.panel.title)
    expect(reviewers).toContain('>Add Reviewers</button>')
    expect(reviewers).toContain(sopWorkflowEn.actions.checkNeeded)
    expect(reviewers).toContain('aria-disabled="true"')
    const timeline = html.slice(positions[4], html.indexOf('</section>', positions[4]))
    expect(timeline).not.toContain('>Add Reviewers</button>')
    expect(timeline).not.toContain('>Submit for approval</button>')
  })

  it('preserves co-author restrictions and displays legacy assigned reviewers accurately', () => {
    fixture.userId = 'coauthor'
    expect(render(<SopWorkflowPage />)).not.toContain('>Add Reviewers</button>')
    fixture.userId = 'author'
    fixture.sop = reviewSop()
    const html = render(<SopWorkflowPage />)
    const start = html.indexOf('id="internal-review-title"')
    const panel = html.slice(start, html.indexOf('</section>', start))
    expect(panel).toContain('Current Reviewer')
    expect(panel).not.toContain(internalReviewEn.panel.noActive)
  })
})
