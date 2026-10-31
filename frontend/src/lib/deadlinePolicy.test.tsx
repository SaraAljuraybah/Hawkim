import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { internalReviewEn } from '../content/internalReview.en'
import { sopWorkflowEn } from '../content/workflow.en'
import type { Department, Sop, User } from '../data/mock/types'
import { SubmitDialog } from '../components/workflow/SubmitDialog'
import { WORKING_DAY_DEADLINES_ACTIVE } from './deadlinePolicy'
import { acceptInternalReview, currentInternalRound, startInternalReview } from './internalReview'
import { reviewDueDateFrom } from './internalReviewStatus'
import { prepareReviewSubmission } from './reviewSubmission'

/*
 * The behaviour that is live now: working-day deadlines are PENDING ACTIVATION, so new review
 * requests follow the approved backend (an optional author-chosen response date, a review duration
 * in calendar days). The activated working-day behaviour is covered by the tests that mock the switch on.
 */
const fixture = vi.hoisted(() => ({
  departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true }] as Department[],
  users: [
    { id: 'author', name: 'Main Writer', email: 'author@example.test', initials: 'MW', departmentId: 'home', permissions: ['author'] },
    { id: 'r1', name: 'First Reviewer', email: 'r1@example.test', initials: 'FR', departmentId: 'home', permissions: ['reviewer'] },
  ] as User[],
}))
vi.mock('../state/usersContext', () => ({ useUsers: () => ({ activeUsers: fixture.users }) }))
vi.mock('../state/departmentsContext', () => ({ useDepartments: () => ({ departments: fixture.departments }) }))

const env = () => ({ users: fixture.users, departments: fixture.departments })
function draft(): Sop {
  return { id: 'sop', code: 'SOP-001', title: 'Reviewable SOP', departmentId: 'home', authorId: 'author', coAuthorIds: [], version: '1', status: 'draft',
    lastUpdated: '2026-10-29', fileName: 'document.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'document.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T05:00:00Z' }],
    comments: [], timeline: [], reviewers: [], approvers: [],
    complianceChecks: [{ id: 'check', sopId: 'sop', version: '1', status: 'completed', startedAt: '2026-10-29T05:00:00Z', guideline: { name: 'GVP', version: '4.0' }, findings: [] }] }
}
// Thursday 29 October 2026, 09:00 in Riyadh (06:00 UTC): the same calendar date in Riyadh and UTC.
const NOW = new Date('2026-10-29T09:00:00+03:00')
beforeEach(() => vi.useFakeTimers({ now: NOW }))
afterEach(() => vi.useRealTimers())

describe('working-day deadlines are pending activation', () => {
  it('is switched off: only an approved change that applies the migration may switch it on', () => {
    expect(WORKING_DAY_DEADLINES_ACTIVE).toBe(false)
  })

  it('sends the author-chosen response date (or none), as the approved backend expects', () => {
    expect(prepareReviewSubmission(['r1'], ['r1'], '', '', NOW, '2026-11-05')).toEqual({ options: { reviewerIds: ['r1'], responseDueDate: '2026-11-05', reviewDurationDays: undefined, note: undefined } })
    expect(prepareReviewSubmission(['r1'], ['r1'], '3', '', NOW, '')).toHaveProperty('options.responseDueDate', undefined)
    expect(prepareReviewSubmission(['r1'], ['r1'], '', '', NOW, '2026-10-28')).toEqual({ error: 'responseDate' })
    expect(prepareReviewSubmission(['r1'], ['r1'], '', '', NOW, 'not a date')).toEqual({ error: 'responseDate' })
  })

  it('keeps the chosen response date on each request and does not label it with the working-day policy', () => {
    const sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], responseDueDate: '2026-11-05', reviewDurationDays: 5 }, env())
    const request = currentInternalRound(sop)!.assignments[0]
    expect(request).toMatchObject({ responseDueDate: '2026-11-05', reviewDurationDays: 5 })
    expect(request.deadlinePolicy).toBeUndefined()
    expect(request.responseCountsFromAt).toBeUndefined()
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], responseDueDate: '2026-10-28' }, env())).toThrow(/today or later/)
  })

  it('counts the review duration in calendar days from acceptance, as the approved accept_review does', () => {
    const sent = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], reviewDurationDays: 2 }, env())
    const round = currentInternalRound(sent)!
    const accepted = acceptInternalReview(sent, 'r1', round.id, round.assignments[0].id, env())
    const request = currentInternalRound(accepted)!.assignments[0]
    // Thursday + 2 calendar days = Saturday (a working-day count would give Monday).
    expect(request.reviewDueDate).toBe(reviewDueDateFrom(request.acceptedAt!, 2))
    expect(request.reviewDueDate).toBe('2026-10-31')
  })

  it('shows the optional response date picker, calendar-day duration and a pending-activation notice in Submit for Review', () => {
    const html = renderToStaticMarkup(<SubmitDialog sop={draft()} content={sopWorkflowEn.dialogs} onClose={() => {}} onSubmit={() => {}} />)
    const date = html.match(/<input[^>]*name="reviewRequestDueDate"[^>]*>/)![0]
    expect(date).toContain('type="date"')
    expect(date).not.toContain('readOnly')
    expect(date).toContain('value=""')
    expect(html).toContain(internalReviewEn.submit.responseDateOptional)
    expect(html).toContain(internalReviewEn.submit.duration)
    expect(html).not.toContain(internalReviewEn.submit.durationWorkingDays)
    expect(html).toContain('Pending activation')
    expect(html).toContain('maxLength="500"')
  })
})
