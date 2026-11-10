import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import type { InternalReviewDecision, Sop, User } from '../data/mock/types'
import type { ReviewTabKey } from '../content/types'
import type { ReviewerTaskSection } from '../lib/reviews'
import { reviewTasks } from '../lib/reviews'
import { ReviewTaskList } from '../components/reviews/ReviewTaskList'
import { ReviewsPage } from './ReviewsPage'

const fixture = vi.hoisted(() => ({
  user: { id: 'reviewer', name: 'Reviewer', initials: 'RR', email: 'reviewer@example.test', departmentId: 'home', permissions: ['reviewer'] } as User,
  sops: [] as Sop[],
  reviewTab: 'incoming' as ReviewerTaskSection,
  approvalTab: 'todo' as ReviewTabKey,
  effects: [] as { run: () => unknown; deps?: readonly unknown[] }[],
}))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useEffect: (run: () => unknown, deps?: readonly unknown[]) => { fixture.effects.push({ run, deps }) },
  }
})
vi.mock('../state/sessionContext', () => ({ useCurrentUser: () => fixture.user }))
vi.mock('../state/sopsContext', () => ({ useSops: () => ({ sops: fixture.sops }) }))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ nameOf: (id: string) => id === 'author' ? 'Main Author' : id }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ nameOf: () => 'Home Department' }) }))

function internal(decision: InternalReviewDecision = 'pending'): Sop {
  return { id: 'equipment', code: 'SOP-777', title: 'Calibrating equipment', departmentId: 'home', version: '1', status: 'in-review', lastUpdated: '2026-10-01', authorId: 'author', coAuthorIds: [], fileName: 'equipment.pdf', fileType: 'pdf', reviewers: [], approvers: [], versions: [], comments: [], timeline: [], complianceChecks: [],
    internalReviewRounds: [{ id: 'round', scope: 'internal', version: '1', status: 'open', requestedById: 'author', requestedAt: '2026-10-01T10:15:23Z', assignedDueDays: null, assignments: [{ id: 'request', userId: 'reviewer', decision, assignedAt: '2026-10-01T10:15:23Z', responseDueDate: '2026-10-03', reviewDurationDays: 5,
      ...(decision === 'accepted' || decision === 'completed' || decision === 'returned' ? { acceptedAt: '2026-10-01T13:30:45Z', reviewDueDate: '2026-10-06' } : {}),
      ...(decision === 'declined' ? { declineReason: 'Unavailable for this round', decidedAt: '2026-10-02T08:00:00Z' } : {}),
      ...(decision === 'removed' ? { removalReason: 'Assignment replaced', removedAt: '2026-10-02T08:00:00Z' } : {}),
    }] }],
  }
}
function approval(): Sop {
  return { ...internal(), id: 'approval', code: 'SOP-888', title: 'Approving equipment', internalReviewRounds: undefined, status: 'in-approval', approvers: [{ userId: 'reviewer', decision: 'pending' }], approvalDueAt: '2026-10-07T12:00:00Z' }
}
// The tabs are in the URL (`tab`, `approvals`).
const renderPage = (query = '') => renderToStaticMarkup(<MemoryRouter initialEntries={[`/reviews?tab=${fixture.reviewTab}&approvals=${fixture.approvalTab}${query}`]}><ReviewsPage /></MemoryRouter>)

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-02T12:00:00Z') })
  fixture.user.permissions = ['reviewer']
  fixture.sops = [internal()]
  fixture.reviewTab = 'incoming'
  fixture.approvalTab = 'todo'
  fixture.effects = []
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('My Reviews presentation', () => {
  it('shows the three reviewer sections and only current-user incoming assignments, without serial codes', () => {
    const unassigned = { ...internal(), id: 'unassigned', title: 'Someone else only' }
    unassigned.internalReviewRounds![0].assignments[0].userId = 'other'
    fixture.sops = [internal(), unassigned]
    const html = renderPage()
    expect(html).toContain('Incoming Requests')
    expect(html).toContain('Active Reviews')
    expect(html).toContain('Completed Reviews')
    expect(html).toContain('Calibrating equipment')
    expect(html).toContain('Main Author')
    expect(html).toContain('Home Department')
    expect(html).toContain('2026-10-01T10:15:23Z')
    expect(html).not.toContain('Someone else only')
    expect(html).not.toContain('SOP-777')
    expect(html).not.toContain('review-approvals-heading')
    expect(html).toContain('aria-pressed="true" aria-label="Grid view"')
  })

  it('shows accepted review deadlines and acceptance time in Active, using the same task in both views', () => {
    const task = reviewTasks('reviewer', [internal('accepted')])[0]
    for (const view of ['grid', 'list'] as const) {
      const html = renderToStaticMarkup(<MemoryRouter><ReviewTaskList tasks={[task]} view={view} label="Assigned reviews" /></MemoryRouter>)
      expect(html).toContain('Calibrating equipment')
      expect(html).toContain('Review due')
      expect(html).toContain('Time remaining')
      expect(html).toContain('Accepted')
      expect(html).not.toContain('SOP-777')
      expect(html.match(/href="\/reviews\/equipment"/g)).toHaveLength(1)
    }
  })

  it.each(['completed', 'returned', 'declined', 'withdrawn', 'expired', 'removed'] as const)('labels closed %s reviews by their actual outcome', (decision) => {
    fixture.reviewTab = 'completed'
    fixture.sops = [internal(decision)]
    const html = renderPage()
    const labels = { completed: 'Completed', returned: 'Returned', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired', removed: 'Removed' }
    expect(html).toContain(labels[decision])
    expect(html).toContain('Calibrating equipment')
    if (decision === 'declined') expect(html).toContain('Unavailable for this round')
    if (decision === 'removed') expect(html).toContain('Assignment replaced')
  })

  it('preserves Approver tasks in a separate area and gates each role independently', () => {
    fixture.sops = [internal(), approval()]
    fixture.user.permissions = ['approver']
    let html = renderPage()
    expect(html).toContain('Approvals')
    expect(html).toContain('Approving equipment')
    expect(html).not.toContain('Incoming Requests')
    expect(html).not.toContain('Calibrating equipment')
    fixture.user.permissions = ['reviewer', 'approver']
    html = renderPage()
    expect(html).toContain('Approving equipment')
    expect(html).toContain('Calibrating equipment')
    expect(html.match(/aria-label="Review view"/g)).toHaveLength(1)
    fixture.user.permissions = ['author']
    html = renderPage()
    expect(html).not.toContain('Approving equipment')
    expect(html).not.toContain('Calibrating equipment')
  })

  it('does not show a running countdown or overdue state for an accepted historical request', () => {
    vi.setSystemTime(new Date('2026-10-09T12:00:00Z'))
    fixture.reviewTab = 'completed'
    const item = internal('accepted')
    item.version = '2'
    item.versions = [{ version: '1', fileName: 'old.pdf', fileType: 'pdf', uploadedAt: '2026-10-01T09:00:00Z' }, { version: '2', fileName: 'new.pdf', fileType: 'pdf', uploadedAt: '2026-10-07T09:00:00Z' }]
    item.internalReviewRounds!.push({ ...item.internalReviewRounds![0], id: 'new-round', version: '2', assignments: [{ id: 'other-request', userId: 'other', decision: 'pending', assignedAt: '2026-10-07T09:15:23Z' }] })
    fixture.sops = [item]
    const html = renderPage()
    expect(html).toContain('Closed request')
    expect(html).toContain('Accepted')
    expect(html).toContain('Review due')
    expect(html).toContain('v1')
    expect(html).not.toContain('Time remaining')
    expect(html).not.toContain('Overdue')
  })

  it('restores and saves the Reviews-specific view preference independently of the directory', () => {
    const storage = new Map([['hawkim.sops.view', 'grid'], ['hawkim.reviews.view', 'list']])
    const getItem = vi.fn((key: string) => storage.get(key) ?? null)
    const setItem = vi.fn((key: string, value: string) => storage.set(key, value))
    vi.stubGlobal('window', { localStorage: { getItem, setItem } })
    const html = renderPage()
    expect(html).toContain('aria-pressed="true" aria-label="List view"')
    expect(getItem).toHaveBeenCalledWith('hawkim.reviews.view')
    fixture.effects.find((effect) => effect.deps?.length === 1 && effect.deps[0] === 'list')!.run()
    expect(setItem).toHaveBeenCalledWith('hawkim.reviews.view', 'list')
    expect(storage.get('hawkim.sops.view')).toBe('grid')
  })

  it('uses grid view when local storage is unavailable or invalid', () => {
    for (const localStorage of [{ getItem: () => 'unexpected' }, { getItem: () => { throw new Error('Blocked') } }]) {
      vi.stubGlobal('window', { localStorage })
      expect(renderPage()).toContain('aria-pressed="true" aria-label="Grid view"')
    }
  })
})

describe('My Reviews pagination', () => {
  const requests = (count: number) => Array.from({ length: count }, (_, i) => ({ ...internal(), id: `r${i}`, title: `Request ${String(i).padStart(2, '0')}` }))
  const approvals = (count: number) => Array.from({ length: count }, (_, i) => ({ ...approval(), id: `a${i}`, title: `Approval ${String(i).padStart(2, '0')}` }))
  /** The titles shown in one list's tab panel. */
  const titles = (html: string, prefix: string, word: string) => {
    const start = html.indexOf(`id="${prefix}-panel-`)
    const end = html.indexOf('<nav', start)
    const panel = html.slice(start, end === -1 ? undefined : end)
    return [...new Set([...panel.matchAll(/>((?:Request|Approval) \d\d)</g)].map((match) => match[1]).filter((title) => title.startsWith(word)))]
  }
  const nav = (html: string, label: string) => html.match(new RegExp(`<nav aria-label="${label}".*?</nav>`))?.[0]
  const current = (navHtml: string) => navHtml.match(/aria-current="page"[^>]*>(\d+)</)?.[1]

  it('shows 12 review requests per page, with the page in the URL; a page too high shows the last page', () => {
    fixture.sops = requests(30)
    const first = renderPage()
    expect(titles(first, 'reviews', 'Request')).toHaveLength(12)
    const pages = nav(first, 'Assigned reviews pages')!
    expect(current(pages)).toBe('1')
    expect(pages).toContain('aria-label="Page 3"')
    expect(pages).not.toContain('Showing')
    expect(titles(renderPage('&page=3'), 'reviews', 'Request')).toHaveLength(6)
    expect(current(nav(renderPage('&page=9'), 'Assigned reviews pages')!)).toBe('3')
  })

  it('always shows the controls for one page, Previous and Next disabled', () => {
    fixture.sops = requests(3)
    const pages = nav(renderPage(), 'Assigned reviews pages')!
    expect(current(pages)).toBe('1')
    expect(pages).not.toContain('aria-label="Page 2"')
    expect(pages.match(/aria-disabled="true"/g)).toHaveLength(2)
  })

  it('hides the controls for an empty tab, keeping its empty message', () => {
    fixture.sops = requests(3)
    fixture.reviewTab = 'completed'
    const html = renderPage()
    expect(html).toContain('No completed or closed reviews yet.')
    expect(html).not.toContain('<nav aria-label="Assigned reviews pages"')
  })

  it('gives reviewers who also approve a separate, separately named pagination per list, with its own URL page', () => {
    fixture.user.permissions = ['reviewer', 'approver']
    fixture.sops = [...requests(14), ...approvals(25)]
    const html = renderPage('&page=2&approvalsPage=3')
    expect(current(nav(html, 'Assigned reviews pages')!)).toBe('2')
    expect(current(nav(html, 'Assigned approvals pages')!)).toBe('3')
    expect(html).not.toContain('<nav aria-label="Pagination"')
    expect(titles(html, 'reviews', 'Request')).toHaveLength(2)
    expect(titles(html, 'review-approvals', 'Approval')).toHaveLength(1)
  })
})
