import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Department, Sop, User } from '../../data/mock/types'
import { approvalEn } from '../../content/approval.en'
import { internalReviewEn } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import { returnAsApprover, uploadVersion } from '../../lib/workflow'
import { submitForApproval } from '../../lib/approval'
import { acceptInternalReview, currentInternalRound, decideInternalReview, removeInternalReviewer, startInternalReview } from '../../lib/internalReview'
import { SopWorkflowPage } from '../../pages/SopWorkflowPage'
import { SubmitForApprovalDialog } from './SubmitForApprovalDialog'
import { ReviewTimelineTable } from './ReviewTimelineTable'
import { reviewSopForUser } from '../../lib/reviewAccess'

const fixture = vi.hoisted(() => ({
  sop: null as Sop | null,
  userId: 'author',
  users: [
    { id: 'author', name: 'Main Author', permissions: ['author'], departmentId: 'home' },
    { id: 'coauthor', name: 'Co-Author', permissions: ['author'], departmentId: 'home' },
    { id: 'reviewer-a', name: 'Reviewer A', permissions: ['reviewer'], departmentId: 'home' },
    { id: 'reviewer-b', name: 'Reviewer B', permissions: ['reviewer'], departmentId: 'home' },
    { id: 'controller', name: 'Quality Controller', permissions: ['approver'], departmentId: 'home' },
    { id: 'external', name: 'External Reviewer', permissions: ['reviewer'], departmentId: 'other' },
  ] as User[],
  departments: [
    { id: 'home', name: 'Home', initials: 'HM', description: '', qualityControllerId: 'controller' },
    { id: 'other', name: 'Other', initials: 'OT', description: '' },
  ] as Department[],
}))

vi.mock('../../state/sessionContext', () => ({ useCurrentUser: () => fixture.users.find((user) => user.id === fixture.userId) }))
vi.mock('../../state/usersContext', () => ({ useUsers: () => ({ users: fixture.users, activeUsers: fixture.users, nameOf: (id: string) => fixture.users.find((user) => user.id === id)?.name ?? id ?? '', getUser: (id: string) => fixture.users.find((user) => user.id === id) }) }))
vi.mock('../../state/departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments, nameOf: (id: string) => id }) }))
vi.mock('../../state/guidelinesContext', () => ({ useGuidelines: () => ({ current: { version: '4.0' } }) }))
vi.mock('../../state/sopsContext', () => ({ useSops: () => ({ sops: [fixture.sop], submitForApproval: vi.fn(), removeInternalReviewer: vi.fn() }) }))

function draft(): Sop {
  return {
    id: 'approval-ui', code: 'SOP-APPROVAL', title: 'Approval UI fixture', description: 'Description remains visible',
    departmentId: 'home', version: '1', status: 'draft', lastUpdated: '2026-10-23', authorId: 'author', coAuthorIds: ['coauthor'],
    fileName: 'test.pdf', fileType: 'pdf', reviewers: [], approvers: [], comments: [], timeline: [],
    versions: [{ version: '1', fileName: 'test.pdf', fileType: 'pdf', uploadedAt: new Date().toISOString(), uploadedById: 'author' }],
    complianceChecks: [{ id: 'check', sopId: 'approval-ui', version: '1', status: 'completed', startedAt: new Date().toISOString(), guideline: { name: 'GVP', version: '4.0' }, findings: [] }],
  }
}
function start() {
  return startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['reviewer-a', 'reviewer-b'] }, { users: fixture.users, departments: fixture.departments })
}
function decide(source: Sop, userId: string, decision: 'completed' | 'returned' = 'completed', text?: string) {
  const first = currentInternalRound(source)!, own = first.assignments.find((item) => item.userId === userId)!
  const sop = own.decision === 'pending' ? acceptInternalReview(source, userId, first.id, own.id, { users: fixture.users, departments: fixture.departments }) : source
  const round = currentInternalRound(sop)!
  return decideInternalReview(sop, userId, round.id, round.assignments.find((item) => item.userId === userId)!.id, decision, text, { users: fixture.users, departments: fixture.departments })
}
function finished(text?: string) { return decide(decide(start(), 'reviewer-a', 'completed', text), 'reviewer-b') }
function renderPage() {
  return renderToStaticMarkup(<MemoryRouter initialEntries={['/approval-ui']}><Routes><Route path="/:id" element={<SopWorkflowPage />} /></Routes></MemoryRouter>)
}
function approvalButton(html: string) { return html.match(/<button[^>]*>Submit for Approval<\/button>/)?.[0] }
/** The lines of the tooltip the disabled button is described by: its heading, then each reason. */
function approvalTooltip(html: string): string[] {
  const id = approvalButton(html)?.match(/aria-describedby="([^"]+)"/)?.[1]
  const tooltip = id ? html.match(new RegExp(`<span id="${id}" role="tooltip" hidden=""[^>]*><span[^>]*>(.*?)</span></span></span>`))?.[1] : undefined
  return tooltip ? [...tooltip.matchAll(/<span[^>]*>([^<]*)/g)].map((match) => match[1]) : []
}
const heading = internalReviewEn.approvalMissing.title
function renderDialog(sop: Sop) { return renderToStaticMarkup(<SubmitForApprovalDialog sop={sop} onSubmit={() => {}} onClose={() => {}} />) }

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 23, 12) })
  fixture.userId = 'author'
  fixture.departments[0].qualityControllerId = 'controller'
})
afterEach(() => vi.useRealTimers())

describe('main Author approval interface', () => {
  it('offers a separate enabled approval action after internal reviews without changing the SOP', () => {
    fixture.sop = finished()
    const html = renderPage()
    expect(approvalButton(html)).toBeDefined()
    expect(approvalButton(html)).not.toContain('aria-disabled="true"')
    expect(html).not.toContain('name="noExternalReviewsRequired"')
    expect(html).toContain('Description remains visible')
    expect(fixture.sop.status).toBe('in-review')
    expect(fixture.sop.approvers).toEqual([])
  })
  it('shows Submit for approval disabled but focusable in Draft and after an approver return, with what is missing', () => {
    fixture.sop = draft()
    const html = renderPage()
    const button = approvalButton(html)!
    expect(button).toContain('aria-disabled="true"')
    expect(button).not.toContain(' disabled=""')
    expect(button).toContain('aria-disabled:bg-beige')
    expect(approvalTooltip(html)).toEqual([heading, 'Add at least one reviewer first.'])
    // The list under the Review timeline is gone.
    expect(html).not.toContain('id="approval-hint"')
    expect(html).not.toContain('<li>')
    const reviewed = finished()
    const submitted = submitForApproval(reviewed, 'author', { version: '1', internalReviewRoundId: currentInternalRound(reviewed)!.id, noExternalReviewsRequired: true, feedbackAddressed: true }, { users: fixture.users, departments: fixture.departments })
    const approval = submitted.approvalSubmissions!.at(-1)!
    fixture.sop = returnAsApprover(submitted, 'controller', 'Revise the controls', { version: approval.version, approvalSubmissionId: approval.id })
    expect(fixture.sop.status).toBe('returned')
    const returned = renderPage()
    expect(approvalButton(returned)).toContain('aria-disabled="true"')
    expect(approvalTooltip(returned)).toEqual([heading, 'The approver returned this SOP. Upload a new version first.'])
    // Once a new version is uploaded, the reviewer line says what's next.
    vi.advanceTimersByTime(1000)
    fixture.sop = uploadVersion(fixture.sop, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    expect(approvalTooltip(renderPage())).toEqual([heading, 'Add at least one reviewer first.', 'Run the compliance check for the current version first.'])
  })
  it('shows only the steps in the Workflow status box, with the Returned pill, while the timeline keeps the return', () => {
    const sop = finished()
    const submitted = submitForApproval(sop, 'author', { version: '1', internalReviewRoundId: currentInternalRound(sop)!.id, noExternalReviewsRequired: true, feedbackAddressed: true }, { users: fixture.users, departments: fixture.departments })
    const approval = submitted.approvalSubmissions!.at(-1)!
    fixture.sop = returnAsApprover(submitted, 'controller', 'Revise the controls', { version: approval.version, approvalSubmissionId: approval.id })
    const html = renderPage()
    const box = html.slice(html.indexOf('id="tracker-title"'), html.indexOf('id="authors-title"'))
    expect(box).toContain('aria-label="' + sopWorkflowEn.tracker.label + '"')
    expect(box).toContain('>' + sopWorkflowEn.tracker.returned + '<')
    for (const text of [sopWorkflowEn.tracker.assignee.title, sopWorkflowEn.tracker.assignee.revisionsPending, 'Returned by ', internalReviewEn.panel.decisions.completed, 'border-t']) expect(box).not.toContain(text)
    // Who returned it and why stay in the Review timeline.
    expect(html).toContain('>' + sopWorkflowEn.timeline.events.returned + '<')
    expect(html).toContain('Revise the controls')
  })
  it('says "Already sent for approval." while the SOP is In Approval', () => {
    const sop = finished()
    fixture.sop = submitForApproval(sop, 'author', { version: '1', internalReviewRoundId: currentInternalRound(sop)!.id, noExternalReviewsRequired: true, feedbackAddressed: true }, { users: fixture.users, departments: fixture.departments })
    expect(fixture.sop.status).toBe('in-approval')
    expect(approvalTooltip(renderPage())).toEqual([heading, 'Already sent for approval.'])
  })
  it('shows each reviewer still to respond or finish, and a return, in simple words', () => {
    let sop = start()
    sop = decide(sop, 'reviewer-a', 'returned', 'Fix the scope')
    const round = currentInternalRound(sop)!
    fixture.sop = acceptInternalReview(sop, 'reviewer-b', round.id, round.assignments.find((item) => item.userId === 'reviewer-b')!.id, { users: fixture.users, departments: fixture.departments })
    expect(approvalTooltip(renderPage())).toEqual([heading,
      'Reviewer A returned v1 with comments. Upload a new version and submit it for review.', 'Waiting for Reviewer B to finish reviewing v1.'])
  })
  it('never gives Co-Authors or Reviewers the approval submission control', () => {
    fixture.sop = finished()
    for (const userId of ['coauthor', 'reviewer-a']) {
      fixture.userId = userId
      expect(approvalButton(renderPage())).toBeUndefined()
    }
  })
  it('preserves legacy Author pages without adding a parallel-only approval control', () => {
    fixture.sop = { ...draft(), status: 'in-review', reviewers: [{ userId: 'reviewer-a', decision: 'pending' }] }
    expect(approvalButton(renderPage())).toBeUndefined()
  })
  it('shows an accessible blocked reason while a reviewer is still pending', () => {
    fixture.sop = decide(start(), 'reviewer-a')
    const html = renderPage()
    expect(approvalButton(html)).toContain('aria-disabled="true"')
    expect(approvalTooltip(html)).toEqual([heading, 'Waiting for Reviewer B to accept or decline.'])
  })
  it('keeps approval disabled after rejection or cancellation of every review', () => {
    fixture.sop = decide(start(), 'reviewer-a', 'returned', 'A revision is required')
    expect(approvalButton(renderPage())).toContain('aria-disabled="true"')
    let cancelled = start()
    const round = currentInternalRound(cancelled)!
    for (const assignment of round.assignments) cancelled = removeInternalReviewer(cancelled, 'author', round.id, assignment.id, 'No longer needed', { users: fixture.users, departments: fixture.departments })
    fixture.sop = cancelled
    const html = renderPage()
    expect(approvalButton(html)).toContain('aria-disabled="true"')
    expect(approvalTooltip(html)).toEqual([heading, 'Add at least one reviewer first.'])
    // Everyone removed: still In Review, and the author can ask other reviewers.
    expect(html).toContain('>' + sopWorkflowEn.actions.submit + '<')
  })
  it('allows approval after a real completed review and an individually cancelled assignment', () => {
    const reviewed = decide(start(), 'reviewer-a')
    const round = currentInternalRound(reviewed)!
    fixture.sop = removeInternalReviewer(reviewed, 'author', round.id, round.assignments.find((assignment) => assignment.userId === 'reviewer-b')!.id, 'No longer needed', { users: fixture.users, departments: fixture.departments })
    expect(approvalButton(renderPage())).not.toContain('aria-disabled="true"')
    expect(fixture.sop!.internalReviewRounds?.at(-1)?.assignments.find((assignment) => assignment.userId === 'reviewer-b')?.decision).toBe('removed')
    // The approver sees the removal and its reason in the review timeline.
    const submitted = submitForApproval(fixture.sop!, 'author', { version: fixture.sop!.version, internalReviewRoundId: round.id, noExternalReviewsRequired: true, feedbackAddressed: true }, { users: fixture.users, departments: fixture.departments })
    const timeline = renderToStaticMarkup(<ReviewTimelineTable sop={reviewSopForUser(submitted, 'controller')!.sop} content={sopWorkflowEn} />)
    expect(timeline).toContain(sopWorkflowEn.timeline.events['reviewer-removed'])
    expect(timeline).toContain('No longer needed')
  })
  it('shows why a missing Quality Controller blocks approval', () => {
    fixture.sop = finished()
    fixture.departments[0].qualityControllerId = undefined
    const html = renderPage()
    expect(approvalButton(html)).toContain('aria-disabled="true"')
    expect(approvalTooltip(html)).toEqual([heading, 'No approver is assigned.'])
  })
  it('uses a separate dialog with an explicit unchecked external-review attestation and optional approval deadline', () => {
    const html = renderDialog(finished())
    expect(html).toContain(approvalEn.dialog.noExternalReviews)
    expect(html).toContain('name="noExternalReviewsRequired"')
    expect(html).not.toContain('checked=""')
    expect(html).toContain('Quality Controller')
    expect(html).toContain('name="approvalDueDate"')
    expect(html).not.toContain('name="internalReviewers"')
    expect(html).not.toContain('name="reviewRequestDueDate"')
    expect(html).not.toContain('name="feedbackAddressed"')
  })
  it('requires a separate feedback acknowledgment when completed reviewers left feedback', () => {
    const html = renderDialog(finished('Please check the labels before final approval'))
    expect(html).toContain('name="feedbackAddressed"')
    expect(html).toContain(approvalEn.dialog.feedbackAddressed)
    expect(html).not.toContain('checked=""')
  })
  it('blocks pending or returned required external reviews without offering a bypass confirmation', () => {
    for (const decision of ['pending', 'returned'] as const) {
      const sop = finished()
      fixture.sop = {
        ...sop,
        externalReviewGate: {
          version: sop.version, internalReviewRoundId: currentInternalRound(sop)!.id,
          requirement: 'required', departmentIds: ['other'],
          assignments: [{ id: 'external-task', departmentId: 'other', userId: 'external', version: sop.version, decision }],
        },
      }
      const html = renderPage()
      expect(approvalButton(html)).toContain('aria-disabled="true"')
      expect(approvalTooltip(html)).toEqual([heading, 'Wait for the required reviews from other departments to finish.'])
      expect(renderDialog(fixture.sop)).not.toContain('name="noExternalReviewsRequired"')
    }
  })
  it('accepts completed external integration evidence without asking the Author to declare it unnecessary', () => {
    const sop = finished()
    fixture.sop = {
      ...sop,
      externalReviewGate: {
        version: sop.version, internalReviewRoundId: currentInternalRound(sop)!.id,
        requirement: 'required', departmentIds: ['other'],
        assignments: [{ id: 'external-task', departmentId: 'other', userId: 'external', version: sop.version, decision: 'completed', decidedAt: new Date().toISOString() }],
      },
    }
    expect(approvalButton(renderPage())).not.toContain('aria-disabled="true"')
    expect(renderDialog(fixture.sop)).not.toContain('name="noExternalReviewsRequired"')
  })
  it('renders the Author-controlled submission and confirmation in the timeline and blocks a second request', () => {
    const sop = finished('Check labels')
    fixture.sop = submitForApproval(sop, 'author', {
      version: sop.version, internalReviewRoundId: currentInternalRound(sop)!.id,
      noExternalReviewsRequired: true, feedbackAddressed: true,
    }, { users: fixture.users, departments: fixture.departments })
    const html = renderPage()
    expect(html).toContain(approvalEn.events['external-reviews-not-required'])
    expect(html).toContain(approvalEn.events['submitted-for-approval'])
    expect(html).toContain('feedback from the completed internal reviews has been addressed')
    expect(html).toContain('Quality Controller')
    expect(approvalButton(html)).toContain('aria-disabled="true"')
    expect(fixture.sop.status).toBe('in-approval')
    expect(fixture.sop.approvers).toHaveLength(1)
  })
})
