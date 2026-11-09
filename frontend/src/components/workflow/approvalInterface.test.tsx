import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Department, Sop, User } from '../../data/mock/types'
import { approvalEn } from '../../content/approval.en'
import { internalReviewEn } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import { returnAsApprover, uploadVersion } from '../../lib/workflow'
import { submitForApproval } from '../../lib/approval'
import { rememberSentForApproval } from '../../state/approvalSentStorage'
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
    { id: 'controller', name: 'Quality Controller', permissions: ['approver'], departmentId: 'quality' },
    { id: 'second-approver', name: 'Second Approver', permissions: ['approver'], departmentId: 'quality' },
    { id: 'home-approver', name: 'Home Approver', permissions: ['approver'], departmentId: 'home' },
    { id: 'external', name: 'External Reviewer', permissions: ['reviewer'], departmentId: 'other' },
  ] as User[],
  departments: [
    { id: 'home', name: 'Home', initials: 'HM', description: '' },
    { id: 'other', name: 'Other', initials: 'OT', description: '' },
    { id: 'quality', name: 'Quality Assurance', initials: 'QA', description: '', isQuality: true },
  ] as Department[],
}))

// These tests read the full timeline on the author's page; lib/releaseScope.test.tsx covers its release scope.
vi.mock('../../lib/releaseScope', () => ({ visibleTimelineEvents: (events: unknown[]) => events }))
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
/** The text of the tooltip the disabled button is described by. */
function approvalTooltip(html: string): string | undefined {
  const id = approvalButton(html)?.match(/aria-describedby="([^"]+)"/)?.[1]
  return id ? html.match(new RegExp(`<span id="${id}" role="tooltip" hidden=""[^>]*><span[^>]*>(.*?)</span></span>`))?.[1] : undefined
}
const env = () => ({ users: fixture.users, departments: fixture.departments })
function send(sop: Sop, note?: string) { return submitForApproval(sop, 'author', { version: sop.version, internalReviewRoundId: currentInternalRound(sop)!.id, approverId: 'controller', note }, env()) }
function renderDialog(sop: Sop) { return renderToStaticMarkup(<SubmitForApprovalDialog sop={sop} onSubmit={() => {}} onClose={() => {}} />) }
const noReview = approvalEn.blockers['no-completed-review']
const alreadySent = approvalEn.blockers['already-requested']

/** An in-memory localStorage (approval is remembered in the browser). */
function memoryStorage() {
  const items = new Map<string, string>()
  return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value) }, removeItem: (key: string) => { items.delete(key) } }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 9, 23, 12) })
  vi.stubGlobal('localStorage', memoryStorage())
  fixture.userId = 'author'
  fixture.departments[2].isQuality = true
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('main Author approval interface', () => {
  it('is enabled as soon as one reviewer completed the current version, even with the other still pending', () => {
    fixture.sop = decide(start(), 'reviewer-a')
    const html = renderPage()
    expect(approvalButton(html)).toBeDefined()
    expect(approvalButton(html)).not.toContain('aria-disabled="true"')
    expect(html).toContain('Description remains visible')
    expect(fixture.sop.status).toBe('in-review')
    expect(fixture.sop.approvers).toEqual([])
  })
  it('stays enabled after a return with comments, and without a current compliance check', () => {
    fixture.sop = decide(decide(start(), 'reviewer-a'), 'reviewer-b', 'returned', 'Fix the scope')
    expect(approvalButton(renderPage())).not.toContain('aria-disabled="true"')
    fixture.sop = { ...finished(), complianceChecks: [] }
    expect(approvalButton(renderPage())).not.toContain('aria-disabled="true"')
  })
  it('is disabled but focusable until a review is completed, with only that reason', () => {
    fixture.sop = draft()
    const html = renderPage()
    const button = approvalButton(html)!
    expect(button).toContain('aria-disabled="true"')
    expect(button).not.toContain(' disabled=""')
    expect(button).toContain('aria-disabled:bg-beige')
    expect(approvalTooltip(html)).toBe(noReview)
    let accepted = start()
    const first = currentInternalRound(accepted)!
    accepted = acceptInternalReview(accepted, 'reviewer-b', first.id, first.assignments.find((item) => item.userId === 'reviewer-b')!.id, env())
    let cancelled = start()
    const round = currentInternalRound(cancelled)!
    for (const assignment of round.assignments) cancelled = removeInternalReviewer(cancelled, 'author', round.id, assignment.id, 'No longer needed', env())
    for (const sop of [start(), accepted, decide(start(), 'reviewer-a', 'returned', 'A revision is required'), cancelled]) {
      fixture.sop = sop
      const page = renderPage()
      expect(approvalButton(page)).toContain('aria-disabled="true"')
      expect(approvalTooltip(page)).toBe(noReview)
    }
  })
  it('says "Already sent for approval." while the SOP is In Approval', () => {
    fixture.sop = send(finished())
    expect(fixture.sop.status).toBe('in-approval')
    expect(approvalTooltip(renderPage())).toBe(alreadySent)
  })
  it('stays disabled after a reload when this browser sent the current version', () => {
    fixture.sop = finished() // as read from the database again: In Review
    rememberSentForApproval('approval-ui', '1')
    const html = renderPage()
    expect(approvalButton(html)).toContain('aria-disabled="true"')
    expect(approvalTooltip(html)).toBe(alreadySent)
    // Another version was remembered: this one can be sent.
    rememberSentForApproval('approval-ui', '2')
    expect(approvalButton(renderPage())).not.toContain('aria-disabled="true"')
  })
  it('can be sent again right after an approver return, while the timeline keeps the return', () => {
    const submitted = send(finished())
    const approval = submitted.approvalSubmissions!.at(-1)!
    fixture.sop = returnAsApprover(submitted, 'controller', 'Revise the controls', { version: approval.version, approvalSubmissionId: approval.id })
    expect(fixture.sop.status).toBe('returned')
    const html = renderPage()
    expect(approvalButton(html)).not.toContain('aria-disabled="true"')
    const start = html.indexOf('id="tracker-title"')
    const box = html.slice(start, html.indexOf('</section>', start))
    expect(box).toContain('aria-label="' + sopWorkflowEn.tracker.label + '"')
    expect(box).toContain('>' + sopWorkflowEn.tracker.returned + '<')
    for (const text of [sopWorkflowEn.tracker.assignee.title, sopWorkflowEn.tracker.assignee.revisionsPending, 'Returned by ', internalReviewEn.panel.decisions.completed, 'border-t']) expect(box).not.toContain(text)
    expect(html).toContain('>' + sopWorkflowEn.timeline.events.returned + '<')
    expect(html).toContain('Revise the controls')
    // After a new version is uploaded, nobody has completed it yet.
    vi.advanceTimersByTime(1000)
    fixture.sop = uploadVersion(fixture.sop, 'author', { fileName: 'revised.pdf', fileType: 'pdf' })
    expect(approvalTooltip(renderPage())).toBe(noReview)
  })
  it('assumes an approver: no approver is never a reason on the button', () => {
    fixture.sop = finished()
    fixture.departments[2].isQuality = false
    const html = renderPage()
    expect(approvalButton(html)).not.toContain('aria-disabled="true"')
    expect(html).not.toContain(approvalEn.blockers['no-approver'])
    expect(approvalEn.blockers['no-approver']).toBe('No approver is available. Contact your System Admin.')
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
  it('shows the removal in the approver timeline after approval with an individually removed reviewer', () => {
    const reviewed = decide(start(), 'reviewer-a')
    const round = currentInternalRound(reviewed)!
    fixture.sop = removeInternalReviewer(reviewed, 'author', round.id, round.assignments.find((assignment) => assignment.userId === 'reviewer-b')!.id, 'No longer needed', env())
    expect(approvalButton(renderPage())).not.toContain('aria-disabled="true"')
    const timeline = renderToStaticMarkup(<ReviewTimelineTable sop={reviewSopForUser(send(fixture.sop!), 'controller')!.sop} content={sopWorkflowEn} />)
    expect(timeline).toContain(sopWorkflowEn.timeline.events['reviewer-removed'])
    expect(timeline).toContain('No longer needed')
  })
  it('looks like Submit for Review: title, no subtitle, no due date, Cancel and Submit, and no confirmation checkboxes', () => {
    const html = renderDialog(finished())
    expect(html).toContain('>Submit for Approval</h2>')
    expect(html).not.toContain('Quality Document Controller')
    expect(html).not.toContain('Assigned Approver')
    expect(html).not.toMatch(/<dialog[^>]*aria-describedby/)
    expect(html).not.toContain('type="date"')
    expect(html).not.toContain('Approval Due Date')
    expect(html).toMatch(/<button type="button"[^>]*>Cancel<\/button>/)
    expect(html).toMatch(/<button type="submit"[^>]*>Submit<\/button>/)
    for (const name of ['noExternalReviewsRequired', 'feedbackAddressed', 'internalReviewers']) expect(html).not.toContain(`name="${name}"`)
    expect(html).not.toContain('type="checkbox"')
  })
  it('pre-fills Division and Department with the Quality department, in searchable lists', () => {
    const html = renderDialog(finished())
    const division = html.match(/<input[^>]*name="approvalDivision"[^>]*>/)![0]
    const department = html.match(/<input[^>]*name="approvalDepartment"[^>]*>/)![0]
    // Divisions aren't loaded yet: the same fallback as Submit for Review.
    expect(division).toContain('value="No Division"')
    expect(department).toContain('value="Quality Assurance"')
    for (const input of [division, department]) expect(input).toContain('role="combobox"')
    expect(html).toContain('>Division<')
    expect(html).toContain('>Department<')
    expect(approvalEn.dialog.qualityOnly.replace('{department}', 'Quality Assurance')).toBe('Approval must be completed within the Quality Assurance department.')
  })
  it('lists only eligible Approvers of the Quality department, with the approver texts', () => {
    const html = renderDialog(finished())
    expect(html).toContain('>Approvers<')
    expect(html).toContain('placeholder="Search approvers by name…"')
    for (const name of ['Quality Controller', 'Second Approver']) expect(html).toContain(name)
    for (const name of ['Home Approver', 'Reviewer A', 'Main Author', 'Co-Author']) expect(html).not.toContain(`>${name}<`)
    expect(html).not.toContain('No approvers available')
  })
  it('says when no approver is available in the Quality department', () => {
    const quality = fixture.users.filter((user) => user.departmentId === 'quality')
    for (const user of quality) user.permissions = ['reviewer']
    try {
      expect(renderDialog(finished())).toContain('No approvers available in Quality Assurance.')
    } finally {
      for (const user of quality) user.permissions = ['approver']
    }
  })
  it('marks Division, Department and Approvers required with a red asterisk; Comments stays optional', () => {
    const html = renderDialog(finished())
    const asterisk = '<span aria-hidden="true" class="ml-0.5 text-status-rejected-fg">*</span>'
    const label = (text: string) => html.match(new RegExp(`<label[^>]*>${text.replace(/[()]/g, '\\$&')}(<span[^>]*>\\*</span>)?</label>`))![0]
    for (const text of ['Division', 'Department', 'Approvers']) expect(label(text)).toContain(asterisk)
    for (const name of ['approvalDivision', 'approvalDepartment']) expect(html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))![0]).toContain('required=""')
    expect(html.match(/<input[^>]*placeholder="Search approvers by name…"[^>]*>/)![0]).toContain('aria-required="true"')
    expect(label('Comments (Optional)')).not.toContain('*')
    expect(html.match(/<textarea[^>]*name="note"[^>]*>/)![0]).not.toContain('required')
  })
  it('keeps the optional comment with the 500 limit and counter', () => {
    const html = renderDialog(finished())
    const comment = html.match(/<textarea[^>]*name="note"[^>]*>/)![0]
    expect(comment).toContain('maxLength="500"')
    expect(html).toContain('>Comments (Optional)<')
    expect(html).toContain('placeholder="Add a comment for the approver…"')
    expect(html).toContain('>0 / 500<')
  })
  it('shows the comment to the approver on the timeline of their review page', () => {
    const sent = send(finished(), 'Please check the labels before final approval')
    const timeline = renderToStaticMarkup(<ReviewTimelineTable sop={reviewSopForUser(sent, 'controller')!.sop} content={sopWorkflowEn} />)
    expect(timeline).toContain(approvalEn.events['submitted-for-approval'])
    expect(timeline).toContain('Please check the labels before final approval')
  })
  it('records only the submission in the timeline and blocks a second request', () => {
    fixture.sop = send(finished('Check labels'))
    const html = renderPage()
    expect(html).toContain(approvalEn.events['submitted-for-approval'])
    expect(html).not.toContain(approvalEn.events['external-reviews-not-required'])
    expect(html).toContain('Quality Controller')
    expect(approvalTooltip(html)).toBe(alreadySent)
    expect(fixture.sop.status).toBe('in-approval')
    expect(fixture.sop.approvers).toHaveLength(1)
  })
})
