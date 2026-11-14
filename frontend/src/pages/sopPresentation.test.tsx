import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Sop, User } from '../data/mock/types'
import { sops } from '../data/mock/sops'
import { sopsEn } from '../content/sops.en'
import { internalReviewEn } from '../content/internalReview.en'
import { sopWorkflowEn } from '../content/workflow.en'
import { approvalEn } from '../content/approval.en'
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
import { CheckAlreadyCompletedError, checkStartFailure } from '../lib/compliance'
import { sopTitleProblem } from '../lib/sopTitle'
import { deriveNotifications } from '../lib/notifications'
import { sopDownloadName, sopFileLabel } from '../lib/sopPresentation'

const fixture = vi.hoisted(() => ({ sop: null as Sop | null, userId: 'author', titles: [] as (string | undefined)[], users: [
  { id: 'author', name: 'Main Writer', departmentId: 'home', permissions: ['author'] },
  { id: 'coauthor', name: 'Co Writer', departmentId: 'home', permissions: ['author'] },
  { id: 'reviewer', name: 'Current Reviewer', departmentId: 'home', permissions: ['reviewer'] },
] as User[] }))
vi.mock('../hooks/useDocumentTitle', () => ({ useDocumentTitle: (title: string | undefined) => fixture.titles.push(title) }))
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.users.find((user) => user.id === fixture.userId), useSession: () => ({ status: 'signed-in', user: fixture.users.find((user) => user.id === fixture.userId) }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? id ?? '', getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true }], nameOf: () => 'Home', getDepartment: () => undefined }) }))
vi.mock('../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop] }) }))
vi.mock('../state/requestsContext', () => ({ useMyRequests: () => [] }))
vi.mock('../state/activeDepartmentContext', () => ({ useActiveDepartment: () => ({ activeDepartment: { id: 'home' }, homeDepartment: { id: 'home' } }) }))
vi.mock('../state/notificationsContext', () => ({ useNotifications: () => ({ notifications: deriveNotifications('reviewer', { sops: [fixture.sop!], requests: [], now: Date.parse('2026-10-29T09:00:00Z') }), unreadCount: 1, now: Date.parse('2026-10-29T09:00:00Z') }) }))

// The page tests below hold while the release 1 timeline scope is on, whatever the constant is set to.
vi.mock('../lib/releaseScope', async (original) => {
  const actual = await original<typeof import('../lib/releaseScope')>()
  return { ...actual, visibleTimelineEvents: (events: Parameters<typeof actual.visibleTimelineEvents>[0]) => actual.visibleTimelineEvents(events, true) }
})

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

describe('a changed review deadline in the timeline', () => {
  it('shows the old and new dates, or that there was none, on the author\'s page', () => {
    const version = fixture.sop!.version
    const changed = (id: string, previousReviewDueAt?: string) => ({ id, type: 'review-deadline-changed' as const, actorId: 'author', version, recipientIds: ['reviewer'], previousReviewDueAt, newReviewDueAt: '2026-11-03T20:59:59.999Z', createdAt: '2026-11-01T09:00:00Z' })
    fixture.sop = { ...fixture.sop!, timeline: [changed('first'), changed('second', '2026-11-05T20:59:59.999Z')] }
    const html = render(<SopWorkflowPage />)
    expect(html).toContain('Review deadline changed')
    expect(html).toContain('From no deadline to Nov 3, 2026')
    expect(html).toContain('From Nov 5, 2026 to Nov 3, 2026')
  })
})

describe('the review page when the database hides another reviewer\'s comment', () => {
  it('renders the request and its timeline event without the comment, and the empty comments message', () => {
    const version = fixture.sop!.version
    const request = (id: string, userId: string) => ({ id, userId, decision: 'returned' as const, assignedAt: '2026-10-29T08:00:00Z', assignedDueDays: null, commentId: 'hidden-' + id })
    const source = reviewSop()
    fixture.sop = {
      ...source, version, comments: [],
      internalReviewRounds: [{ id: 'round', scope: 'internal', version, status: 'changes-requested', requestedById: 'author', requestedAt: '2026-10-29T08:00:00Z', assignedDueDays: null, assignments: [request('own', 'reviewer'), request('other', 'coauthor')] }],
      timeline: [...source.timeline, { id: 'returned', type: 'review-changes-requested', actorId: 'coauthor', version, commentId: 'hidden-other', createdAt: '2026-10-29T09:00:00Z' }],
    }
    fixture.userId = 'reviewer'
    const html = render(<ReviewPage />)
    expect(html).toContain('Visible Procedure')
    expect(html).toContain(sopWorkflowEn.comments.empty)
  })
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

  describe('compliance check once per version', () => {
    const check = (status: 'completed' | 'failed', guideline: string, version = '1') => ({ id: `check-${status}`, sopId: 'test', version, status, startedAt: '2026-10-29T08:00:00Z', guideline: { name: 'GVP', version: guideline }, findings: [] })
    const button = () => render(<SopWorkflowPage />).match(/<button[^>]*>(?:(?!<\/button>).)*Compliance Check for Current Version<\/button>/)![0]

    it('keeps it focusable but unavailable, with the tooltip, after a completed check of this version and GVP version', () => {
      fixture.sop = { ...fixture.sop!, complianceChecks: [check('completed', '4.0')] }
      expect(button()).toContain('aria-disabled="true"')
      expect(button()).not.toMatch(/ disabled=""/)
      expect(button()).toContain('aria-describedby')
      expect(render(<SopWorkflowPage />)).toContain(sopWorkflowEn.history.checkCompleted)
    })

    it.each([
      ['no check yet', []],
      ['the last check failed', [check('completed', '4.0'), check('failed', '4.0')]],
      ['the GVP version is newer', [check('completed', '3.0')]],
      ['a new version was uploaded', [check('completed', '4.0', '0')]],
    ])('stays available when %s', (_, complianceChecks) => {
      fixture.sop = { ...fixture.sop!, complianceChecks }
      expect(button()).not.toContain('aria-disabled="true"')
      expect(render(<SopWorkflowPage />)).not.toContain(sopWorkflowEn.history.checkCompleted)
    })

    it('explains a repeat check the database refused, and keeps the general message otherwise', () => {
      const refused = sopWorkflowEn.messages[checkStartFailure(new CheckAlreadyCompletedError('Refused'))]
      expect(refused).toBe(sopWorkflowEn.messages.checkAlreadyCompleted)
      expect(refused).toContain('Add a new version')
      expect(sopWorkflowEn.messages[checkStartFailure(new Error('Connection lost'))]).toBe(sopWorkflowEn.messages.checkStartFailed)
    })

    it('shows the existing reason first when the user may not run a check', () => {
      fixture.sop = { ...fixture.sop!, complianceChecks: [check('completed', '4.0')], versions: [{ ...fixture.sop!.versions[0], uploadedById: 'author' }] }
      fixture.userId = 'coauthor'
      const html = render(<SopWorkflowPage />)
      expect(html).toContain('or the person who added the current version')
      expect(html).not.toContain(sopWorkflowEn.history.checkCompleted)
    })
  })

  it('limits the timeline on the author page only, keeping hidden types on the review page', () => {
    const accepted = { id: 'accepted', type: 'review-accepted' as const, actorId: 'reviewer', version: '1', createdAt: '2026-10-29T08:30:00Z' }
    fixture.sop = { ...reviewSop(), timeline: [...reviewSop().timeline, accepted] }
    const label = `>${sopWorkflowEn.timeline.events['review-accepted']}<`
    const submitted = `>${sopWorkflowEn.timeline.events.submitted}<`
    const author = render(<SopWorkflowPage />)
    expect(author).toContain(submitted)
    expect(author).not.toContain(label)
    fixture.userId = 'reviewer'
    const review = render(<ReviewPage />)
    expect(review).toContain(submitted)
    expect(review).toContain(label)
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

  it('names the SOP History date column Added Date', () => {
    const html = render(<SopWorkflowPage />)
    const history = html.slice(html.indexOf('id="history-title"'), html.indexOf('</section>', html.indexOf('id="history-title"')))
    expect(history).toMatch(/<th scope="col"[^>]*>\s*Added Date\s*<\/th>/)
    expect(history).not.toMatch(/<th scope="col"[^>]*>\s*Date\s*<\/th>/)
  })

  it('keeps the initial Add Reviewers action in Reviewers, with the required section order and no actions in Timeline', () => {
    const html = render(<SopWorkflowPage />)
    const ids = ['authors-title', 'history-title', 'compliance-title', 'internal-review-title', 'timeline-title']
    const positions = ids.map((id) => html.indexOf(`id="${id}"`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    const reviewers = html.slice(positions[3], html.indexOf('</section>', positions[3]))
    expect(reviewers).toContain(internalReviewEn.panel.authorPageTitle)
    expect(reviewers).toContain('>Add Reviewers</button>')
    expect(reviewers).toContain(sopWorkflowEn.actions.checkNeeded)
    expect(reviewers).toContain('aria-disabled="true"')
    const timeline = html.slice(positions[4], html.indexOf('</section>', positions[4]))
    expect(timeline).not.toContain('>Add Reviewers</button>')
    expect(timeline).not.toContain('>' + approvalEn.action + '</button>')
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

describe('Back to My SOPs on Add SOP', () => {
  it('goes back to My SOPs (where Cancel goes), above the one h1, in the shared back-link style', () => {
    const html = render(<UploadSopPage />)
    const back = html.match(/<a[^>]*href="\/my-sops"[^>]*>(?:(?!<\/a>).)*Back to My SOPs<\/a>/)![0]
    expect(back).toContain('inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon')
    expect(back).toMatch(/lucide-arrow-left/)
    expect(html.indexOf('Back to My SOPs')).toBeLessThan(html.indexOf('<h1'))
    expect(html.match(/<h1/g)).toHaveLength(1)
  })
})

describe('SOP Details on the author page', () => {
  it('comes right after Workflow status with Title, Description, Division, Department and Date Added', () => {
    const html = render(<SopWorkflowPage />)
    const positions = ['tracker-title', 'sop-details-title', 'authors-title'].map((id) => html.indexOf(`id="${id}"`))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    const card = html.slice(html.indexOf('id="sop-details-title"'), html.indexOf('id="authors-title"'))
    const labels = [...card.matchAll(/<dt class="text-sm font-bold text-maroon">([^<]+)<\/dt>/g)].map((match) => match[1])
    expect(labels).toEqual(['Title', 'Description', 'Division', 'Department', 'Date Added'])
    // The description is in its own white box, the full width of the card, and no longer under the title.
    expect(card).toMatch(/<dd class="min-w-0 rounded-lg border border-beige bg-white px-4 py-3[^"]*whitespace-pre-line[^"]*">/)
    const header = html.slice(html.indexOf('<h1'), html.indexOf('id="tracker-title"'))
    expect(header).not.toContain('Edit Description')
  })
})
