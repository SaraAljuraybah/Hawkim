import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Sop, User } from '../../data/mock/types'
import { acceptInternalReview, cancelInternalReview, currentInternalRound, decideInternalReview, resubmitInternalReview, startInternalReview } from '../../lib/internalReview'
import { uploadVersion } from '../../lib/workflow'
import { reviewTasks } from '../../lib/reviews'
import { deriveNotifications } from '../../lib/notifications'
import { internalReviewEn } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import { SubmitDialog } from './SubmitDialog'
import { SopWorkflowPage } from '../../pages/SopWorkflowPage'
import { ReviewPage } from '../../pages/ReviewPage'
import { ComplianceReportPage } from '../../pages/ComplianceReportPage'

const fixture = vi.hoisted(() => ({ sop: null as Sop | null, userId: 'author', users: [
  { id: 'author', name: 'Main writer', permissions: ['author', 'reviewer'], departmentId: 'home' },
  { id: 'coauthor', name: 'Contributing writer', permissions: ['author', 'reviewer'], departmentId: 'home' },
  { id: 'reviewer-a', name: 'Reviewer Alpha', permissions: ['reviewer'], departmentId: 'home' },
  { id: 'reviewer-b', name: 'Reviewer Beta', permissions: ['reviewer'], departmentId: 'home' },
  { id: 'external', name: 'External reviewer', permissions: ['reviewer'], departmentId: 'other' },
] as User[], departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '' }] }))
vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users.find((user) => user.id === fixture.userId) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? id ?? '', getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments, nameOf: (id: string) => id }) }))
vi.mock('../../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop], cancelInternalReview: vi.fn(), acceptInternalReview: vi.fn(), declineInternalReview: vi.fn(), decideInternalReview: vi.fn() }) }))
const environment = () => ({ users: fixture.users, departments: fixture.departments })
function draft(): Sop {
  return { id: 'test', code: 'SOP-TEST', title: 'Internal review fixture', description: 'Description retained', departmentId: 'home', version: '1', status: 'draft', lastUpdated: '2026-10-23', authorId: 'author', coAuthorIds: ['coauthor'], fileName: 'test.pdf', fileType: 'pdf', reviewers: [], approvers: [], comments: [], timeline: [], versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString(), uploadedById: 'author' }], complianceChecks: [{ id: 'check', sopId: 'test', version: '1', status: 'completed', startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] }] }
}
function start() { return startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['reviewer-a', 'reviewer-b'], responseDueDate: '2026-10-28', reviewDurationDays: 5 }, environment()) }
function render(page: ReactNode) { return renderToStaticMarkup(<MemoryRouter initialEntries={['/test']}><Routes><Route path="/:id" element={page} /></Routes></MemoryRouter>) }
function accept(sop: Sop, userId: string) {
  const round = currentInternalRound(sop)!
  return acceptInternalReview(sop, userId, round.id, round.assignments.find((item) => item.userId === userId)!.id, environment())
}
function decide(source: Sop, userId: string, decision: 'completed' | 'returned', text?: string) {
  const first = currentInternalRound(source)!, own = first.assignments.find((item) => item.userId === userId)!
  const sop = own.decision === 'pending' ? acceptInternalReview(source, userId, first.id, own.id, environment()) : source
  const round = currentInternalRound(sop)!
  return decideInternalReview(sop, userId, round.id, round.assignments.find((item) => item.userId === userId)!.id, decision, text, environment())
}
beforeEach(() => { vi.useFakeTimers({ now: new Date(2026, 9, 23, 12) }); fixture.userId = 'author' })
afterEach(() => vi.useRealTimers())

describe('internal parallel review across transitions and detail views', () => {
  it('keeps unassigned users outside the Author and Reviewer detail views', () => {
    fixture.sop = start()
    fixture.userId = 'external'
    expect(render(<SopWorkflowPage />)).not.toContain('Description retained')
    expect(render(<ReviewPage />)).not.toContain('Description retained')
  })
  it('keeps eligible reviewers in a collapsed multi-select with a response due date, review duration and comments', () => {
    const html = renderToStaticMarkup(<SubmitDialog sop={draft()} content={sopWorkflowEn.dialogs} onSubmit={() => {}} onClose={() => {}} />)
    expect(html).toContain('Request reviews')
    expect(html).not.toContain('Request internal reviews')
    expect(html).not.toContain('Internal reviewers')
    expect(html).not.toContain('Select eligible reviewers from the SOP department. All selected reviewers receive their tasks together.')
    const trigger = html.match(/<button[^>]*aria-label="Select reviewers"[^>]*>/)?.[0]
    expect(trigger).toContain('aria-expanded="false"')
    const reviewerPanel = html.match(/<div[^>]*role="group"[^>]*>/)?.[0]
    expect(reviewerPanel).toContain('aria-label="Select reviewers"')
    expect(reviewerPanel).toContain('hidden=""')
    expect(html).toContain('Reviewer Alpha')
    expect(html).toContain('Reviewer Beta')
    for (const name of ['Main writer', 'Contributing writer', 'External reviewer', 'Reviewer 1']) expect(html).not.toContain(name)
    expect(html).toContain('Response due date (optional)')
    expect(html).toContain(internalReviewEn.submit.responseHelp)
    expect(html).not.toContain('23:59:59.999')
    const duration = html.match(/<input[^>]*name="reviewDurationDays"[^>]*>/)![0]
    expect(duration).toContain('type="number"')
    expect(duration).toContain('min="1"')
    expect(duration).toContain('max="30"')
    expect(duration).toContain('aria-describedby=')
    expect(html).toContain('Review duration in days (optional)')
    expect(html).toContain(internalReviewEn.submit.durationHelp)
    expect(html.match(/type="date"/g)).toHaveLength(1)
    expect(html).not.toContain('name="reviewerDueDate-')
    expect(html.match(/<input[^>]*type="date"[^>]*>/)![0]).not.toContain('max="')
    expect(html).toContain(sopWorkflowEn.dialogs.submit.note.label)
    expect(html).toContain('name="reviewRequestDueDate"')
    expect(html).toContain('name="note"')
  })
  it('activates both review pages and tasks without routing or approval controls', () => {
    fixture.sop = start()
    for (const userId of ['reviewer-a', 'reviewer-b']) {
      fixture.userId = userId
      expect(reviewTasks(userId, [fixture.sop])[0].group).toBe('todo')
      const html = render(<ReviewPage />)
      expect(html).toContain('>Accept review<')
      expect(html).toContain('>Decline review<')
      expect(html).not.toContain('>Complete review<')
      fixture.sop = accept(fixture.sop, userId)
      const accepted = render(<ReviewPage />)
      expect(accepted).toContain('>Complete review<')
      expect(accepted).toContain('>Reject SOP<')
      expect(accepted).not.toContain('>Accept review<')

      expect(html).toContain('Description retained')
      expect(html).not.toContain('Route to another department')
      expect(html).not.toContain('Forward to reviewer')
      expect(html).not.toContain('>Approve<')
    }
  })
  it('allows only the main author to see cancellation controls and keeps rejection history after a new round', () => {
    const original = start()
    fixture.sop = original
    expect(render(<SopWorkflowPage />)).toContain('Cancel review request')
    fixture.userId = 'coauthor'
    expect(render(<SopWorkflowPage />)).not.toContain('>Cancel review request<')
    fixture.userId = 'author'
    const returned = decide(decide(original, 'reviewer-a', 'completed', 'Checked version one'), 'reviewer-b', 'returned', 'Revise the safety section')
    const history = JSON.stringify(returned.internalReviewRounds)
    vi.advanceTimersByTime(1000)
    const revised = uploadVersion(returned, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    revised.complianceChecks = [...revised.complianceChecks, { ...draft().complianceChecks[0], id: 'check-new', version: revised.version }]
    fixture.sop = resubmitInternalReview(revised, 'author', '4.0', environment())
    expect(JSON.stringify(fixture.sop.internalReviewRounds?.slice(0, -1))).toBe(history)
    const html = render(<SopWorkflowPage />)
    expect(html).toContain('Checked version one')
    expect(html).toContain('Revise the safety section')
    expect(html).toContain('v1')
    expect(html).toContain('v2')
    expect(fixture.sop.description).toBe('Description retained')
  })
  it('removes actionable tasks after cancellation and returns to Draft without counting reviews', () => {
    let sop = start()
    const round = currentInternalRound(sop)!
    for (const assignment of round.assignments) sop = cancelInternalReview(sop, 'author', round.id, assignment.id, environment())
    fixture.sop = sop
    expect(sop.status).toBe('draft')
    for (const userId of ['reviewer-a', 'reviewer-b']) {
      expect(reviewTasks(userId, [sop]).every((task) => task.group !== 'todo')).toBe(true)
      expect(deriveNotifications(userId, { sops: [sop], requests: [], now: Date.now() }).some((item) => item.type === 'due-soon' || item.type === 'overdue')).toBe(false)
      fixture.userId = userId
      const html = render(<ReviewPage />)
      expect(html).not.toContain('>Complete review<')
      expect(html).not.toContain('>Reject SOP<')
    }
  })
  it('shows the main Author as next actor after all successful reviews without an approval task', () => {
    fixture.sop = decide(decide(start(), 'reviewer-b', 'completed'), 'reviewer-a', 'completed')
    const html = render(<SopWorkflowPage />)
    expect(html).toContain('Awaiting the next Author action')
    expect(fixture.sop.status).toBe('in-review')
    expect(fixture.sop.approvers).toEqual([])
    expect(fixture.sop.timeline.some((event) => event.type === 'forwarded-to-approver')).toBe(false)
  })
})

describe('historical review pages cannot reveal a later unassigned version', () => {
  it('keeps former reviewer history and report access scoped while the newly assigned reviewer can work', () => {
    let sop = start()
    const round = currentInternalRound(sop)!
    for (const assignment of round.assignments) sop = cancelInternalReview(sop, 'author', round.id, assignment.id, environment())
    const history = JSON.stringify(sop.internalReviewRounds)
    vi.advanceTimersByTime(1000)
    const revised = uploadVersion(sop, 'author', { fileName: 'private-revision.docx', fileType: 'docx', fileUrl: '/private-v2.docx' })
    revised.complianceChecks = [...revised.complianceChecks, { ...draft().complianceChecks[0], id: 'private-check', version: revised.version, guideline: { name: 'Private v2 guideline', version: '4.0' } }]
    fixture.sop = startInternalReview(revised, 'author', '4.0', { reviewerIds: ['reviewer-b'] }, environment())
    fixture.userId = 'reviewer-a'
    const detail = render(<ReviewPage />)
    expect(detail).toContain('test.pdf')
    expect(detail).toContain('Cancelled')
    expect(detail).not.toContain('private-revision')
    expect(detail).not.toContain('/private-v2')
    expect(detail).not.toContain('Private v2 guideline')
    expect(detail).not.toContain('>Complete review<')
    expect(detail).not.toContain('>Reject SOP<')
    const report = render(<ComplianceReportPage audience="reviewer" />)
    expect(report).toContain('>v1</dd>')
    expect(report).not.toContain('>v2</dd>')
    expect(report).not.toContain('value="2"')
    expect(report).not.toContain('Private v2 guideline')
    fixture.userId = 'reviewer-b'
    expect(render(<ReviewPage />)).toContain('>Accept review<')
    expect(render(<ReviewPage />)).toContain('/private-v2.docx')
    expect(JSON.stringify(fixture.sop.internalReviewRounds!.slice(0, -1))).toBe(history)
  })
})
