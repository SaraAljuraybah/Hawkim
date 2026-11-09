import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { internalReviewEn } from '../content/internalReview.en'
import { sopWorkflowEn } from '../content/workflow.en'
import type { Department, Sop, User } from '../data/mock/types'
import { SubmitDialog } from '../components/workflow/SubmitDialog'
import { WORKING_DAY_DEADLINES_ACTIVE } from './deadlinePolicy'
import { acceptInternalReview, currentInternalRound, startInternalReview } from './internalReview'
import { reviewDueDateFrom } from './internalReviewStatus'

/*
 * The live behaviour with working-day deadlines active. The calendar-day rules that apply again if
 * the switch is turned off are covered in lib/riyadhResponseRules.test.tsx.
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

describe('working-day deadlines are active', () => {
  it('is switched on', () => {
    expect(WORKING_DAY_DEADLINES_ACTIVE).toBe(true)
  })

  it('gives every new request the fixed two-working-day response deadline and the working-day policy', () => {
    const sop = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], reviewDurationDays: 5 }, env())
    expect(currentInternalRound(sop)!.assignments[0]).toMatchObject({
      responseDueDate: '2026-11-02', responseDueAt: '2026-11-02T20:59:59.999Z', reviewDurationDays: 5, deadlinePolicy: 'riyadh-working-days-v1',
    })
  })

  it('counts the review duration in working days from acceptance, not counting that date', () => {
    const sent = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], reviewDurationDays: 2 }, env())
    const round = currentInternalRound(sent)!
    const accepted = acceptInternalReview(sent, 'r1', round.id, round.assignments[0].id, env())
    // Thursday + 2 working days = Monday (Friday and Saturday don't count).
    expect(currentInternalRound(accepted)!.assignments[0].reviewDueDate).toBe('2026-11-02')
  })

  it('keeps calendar days for a request sent before the migration, as accept_review does', () => {
    const sent = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], reviewDurationDays: 2 }, env())
    const round = currentInternalRound(sent)!
    round.assignments[0].deadlinePolicy = 'calendar-v1'
    const accepted = acceptInternalReview(sent, 'r1', round.id, round.assignments[0].id, env())
    const request = currentInternalRound(accepted)!.assignments[0]
    // Thursday + 2 calendar days = Saturday.
    expect(request.reviewDueDate).toBe(reviewDueDateFrom(request.acceptedAt!, 2))
    expect(request.reviewDueDate).toBe('2026-10-31')
  })

  it('asks only for the duration in working days in Submit for Review, with no response date field', () => {
    const html = renderToStaticMarkup(<SubmitDialog sop={draft()} content={sopWorkflowEn.dialogs} onClose={() => {}} onSubmit={() => {}} />)
    expect(html).not.toContain('name="reviewRequestDueDate"')
    expect(html).toContain(internalReviewEn.submit.durationWorkingDays)
    expect(html).not.toContain(internalReviewEn.submit.duration)
    expect(html).toContain(internalReviewEn.submit.durationHelp)
    expect(html).not.toContain('Pending activation')
    expect(html).toContain('maxLength="500"')
  })
})
