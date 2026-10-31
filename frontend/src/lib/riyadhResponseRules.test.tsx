import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { internalReviewEn } from '../content/internalReview.en'
import { sopWorkflowEn } from '../content/workflow.en'
import type { Sop, User } from '../data/mock/types'
import { ReviewDueDateField } from '../components/workflow/ReviewDueDateField'
import { toSop, type SopRow } from '../services/sops'
import { acceptInternalReview, currentInternalRound, startInternalReview } from './internalReview'
import { isValidReviewDuration, requestDeadline, reviewDueDateFrom, withdrawalDueAt } from './internalReviewStatus'
import { isAfterResponseCutoff, parseResponseDueDate, responseCountsFrom, responseDueDateRange, responseTimeMilliseconds } from './responseTime'
import { prepareReviewSubmission } from './reviewSubmission'

/*
 * The live (approved backend) response-deadline rules, checked in Riyadh time under several device
 * time zones: the same inputs must give the same results everywhere, as the database
 * (earliest_response_date(), riyadh_end_of_day(), riyadh_today() + duration) works in Asia/Riyadh.
 * No Supabase client is created.
 */
vi.mock('../services/supabase', () => ({ supabase: () => { throw new Error('No database in these tests') } }))

/** A moment written in Riyadh time (UTC+03:00 all year). */
const riyadh = (local: string) => new Date(`${local}+03:00`)
const people: User[] = [
  { id: 'author', name: 'Author', email: 'author@example.test', initials: 'AU', departmentId: 'home', permissions: ['author'] },
  { id: 'r1', name: 'Reviewer', email: 'r1@example.test', initials: 'RV', departmentId: 'home', permissions: ['reviewer'] },
]
const env = { users: people, departments: [{ id: 'home', name: 'Home', initials: 'HM', description: '', requiresComplianceCheck: true }] }
function draft(): Sop {
  return { id: 'sop', code: 'SOP-001', title: 'SOP', departmentId: 'home', authorId: 'author', coAuthorIds: [], version: '1', status: 'draft', lastUpdated: '2026-10-26',
    fileName: 'a.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'a.pdf', fileType: 'pdf', uploadedAt: '2026-10-01T00:00:00Z' }], comments: [], timeline: [], reviewers: [], approvers: [],
    complianceChecks: [{ id: 'c', sopId: 'sop', version: '1', status: 'completed', startedAt: '2026-10-01T00:00:00Z', guideline: { name: 'GVP', version: '4.0' }, findings: [] }] }
}
const field = (value: string) => renderToStaticMarkup(<ReviewDueDateField name="reviewRequestDueDate" stage="response"
  text={{ ...sopWorkflowEn.dialogs.submit.reviewDate, label: internalReviewEn.submit.responseDateOptional, help: internalReviewEn.submit.responseHelp, duration: internalReviewEn.submit.responseTimeGiven }}
  value={value} closeLabel="Close" onChange={() => {}} />)

// Device time zones: UTC, Riyadh itself, far west (UTC−7/−8) and far east (UTC+13).
describe.each(['UTC', 'Asia/Riyadh', 'America/Los_Angeles', 'Pacific/Auckland'])('response deadline rules on a device set to %s', (deviceZone) => {
  // Node re-reads TZ when it changes, so Date's local methods follow the device zone set here.
  const processEnv = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env
  const original = processEnv.TZ
  beforeAll(() => { processEnv.TZ = deviceZone })
  afterAll(() => { processEnv.TZ = original })
  afterEach(() => vi.useRealTimers())

  it('really runs in that device time zone', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(deviceZone)
    // The local clock really moves: device-local midnight of Oct 26 differs between these zones.
    const offsets: Record<string, number> = { UTC: 0, 'Asia/Riyadh': -180, 'America/Los_Angeles': 420, 'Pacific/Auckland': -780 }
    expect(new Date('2026-10-26T12:00:00Z').getTimezoneOffset()).toBe(offsets[deviceZone])
  })

  it('accepts today at 15:59:59 Riyadh and rejects it from 16:00:00, when tomorrow becomes the minimum', () => {
    const before = riyadh('2026-10-26T15:59:59')
    const at = riyadh('2026-10-26T16:00:00')
    const after = riyadh('2026-10-26T18:30:00')
    expect(isAfterResponseCutoff(before)).toBe(false)
    expect(responseDueDateRange(before)).toEqual({ min: '2026-10-26' })
    expect(parseResponseDueDate('2026-10-26', before)).toEqual({ valid: true, days: 0 })
    expect(isAfterResponseCutoff(at)).toBe(true)
    expect(responseDueDateRange(at)).toEqual({ min: '2026-10-27' })
    expect(parseResponseDueDate('2026-10-26', at)).toEqual({ valid: false })
    expect(parseResponseDueDate('2026-10-26', after)).toEqual({ valid: false })
    expect(parseResponseDueDate('2026-10-27', after)).toEqual({ valid: true, days: 1 })
    // The same through the Submit form and the browser's workflow rule.
    expect(prepareReviewSubmission(['r1'], ['r1'], '', '', before, '2026-10-26')).toHaveProperty('options.responseDueDate', '2026-10-26')
    expect(prepareReviewSubmission(['r1'], ['r1'], '', '', at, '2026-10-26')).toEqual({ error: 'responseDate' })
    expect(prepareReviewSubmission(['r1'], ['r1'], '', '', after, '2026-10-27')).toHaveProperty('options.responseDueDate', '2026-10-27')
    vi.useFakeTimers({ now: at })
    expect(() => startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], responseDueDate: '2026-10-26' }, env)).toThrow(/tomorrow or later/)
    expect(currentInternalRound(startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], responseDueDate: '2026-10-27' }, env))!.assignments[0])
      .toMatchObject({ responseDueDate: '2026-10-27', responseDueAt: '2026-10-27T20:59:59.999Z' })
  })

  it('follows the Riyadh date across midnight', () => {
    const lateEvening = riyadh('2026-10-26T23:59:59')
    const midnight = riyadh('2026-10-27T00:00:00')
    expect(responseDueDateRange(lateEvening)).toEqual({ min: '2026-10-27' })
    expect(responseCountsFrom(lateEvening)).toEqual(riyadh('2026-10-27T08:00:00'))
    expect(responseDueDateRange(midnight)).toEqual({ min: '2026-10-27' })
    expect(parseResponseDueDate('2026-10-27', midnight)).toEqual({ valid: true, days: 0 })
    expect(parseResponseDueDate('2026-10-26', midnight)).toEqual({ valid: false })
    expect(responseCountsFrom(midnight)).toEqual(riyadh('2026-10-27T08:00:00'))
    // Across a month and a year end.
    expect(responseDueDateRange(riyadh('2026-10-31T16:00:00'))).toEqual({ min: '2026-11-01' })
    expect(responseCountsFrom(riyadh('2026-12-31T20:00:00'))).toEqual(riyadh('2027-01-01T08:00:00'))
  })

  it('uses the Riyadh date when UTC is still on the previous day', () => {
    // 21:30 UTC on Oct 26 is 00:30 on Oct 27 in Riyadh.
    const sentAt = new Date('2026-10-26T21:30:00Z')
    expect(responseDueDateRange(sentAt)).toEqual({ min: '2026-10-27' })
    expect(parseResponseDueDate('2026-10-26', sentAt)).toEqual({ valid: false })
    expect(parseResponseDueDate('2026-10-27', sentAt)).toEqual({ valid: true, days: 0 })
    // 12:00 UTC on Oct 26 is 15:00 in Riyadh: before the cutoff, still Oct 26.
    expect(responseDueDateRange(new Date('2026-10-26T12:00:00Z'))).toEqual({ min: '2026-10-26' })
    // 13:00 UTC is 16:00 in Riyadh: the cutoff, although it is only 13:00 in UTC.
    expect(isAfterResponseCutoff(new Date('2026-10-26T13:00:00Z'))).toBe(true)
    // The time to respond ends at 23:59:59.999 Riyadh (20:59:59.999 UTC).
    expect(responseTimeMilliseconds('2026-10-27', riyadh('2026-10-26T14:00:00'))).toBe(Date.parse('2026-10-27T20:59:59.999Z') - Date.parse('2026-10-26T11:00:00Z'))
  })

  it('shows the Riyadh minimum date in the response date field', () => {
    vi.useFakeTimers({ now: new Date('2026-10-26T21:30:00Z') })
    expect(field('2026-10-27')).toContain('min="2026-10-27"')
    vi.useFakeTimers({ now: riyadh('2026-10-26T15:59:59') })
    expect(field('2026-10-26')).toContain('min="2026-10-26"')
    expect(field('2026-10-26')).toContain('Time to respond:')
  })

  it('rejects invalid, malformed and past dates, and keeps the date optional', () => {
    const now = riyadh('2026-10-26T10:00:00')
    for (const date of ['2026-02-30', 'invalid', '26-10-2026', '2026-1-5', '2026-10-25', '2025-10-26']) {
      expect(parseResponseDueDate(date, now)).toEqual({ valid: false })
      expect(prepareReviewSubmission(['r1'], ['r1'], '', '', now, date)).toEqual({ error: 'responseDate' })
    }
    expect(parseResponseDueDate('', now)).toEqual({ valid: true })
    expect(parseResponseDueDate('   ', now)).toEqual({ valid: true })
    expect(prepareReviewSubmission(['r1'], ['r1'], '', '', now, '')).toHaveProperty('options.responseDueDate', undefined)
  })

  it('accepts review durations of 1 and 30 calendar days and rejects 0 and 31', () => {
    const now = riyadh('2026-10-26T10:00:00')
    for (const days of [1, 30]) {
      expect(isValidReviewDuration(days)).toBe(true)
      expect(prepareReviewSubmission(['r1'], ['r1'], String(days), '', now)).toHaveProperty('options.reviewDurationDays', days)
    }
    for (const days of [0, 31]) {
      expect(isValidReviewDuration(days)).toBe(false)
      expect(prepareReviewSubmission(['r1'], ['r1'], String(days), '', now)).toEqual({ error: 'duration' })
    }
    expect(isValidReviewDuration(undefined)).toBe(true)
    // Calendar days from the Riyadh date of acceptance (Friday and Saturday count), as riyadh_today() + n.
    expect(reviewDueDateFrom(riyadh('2026-10-29T23:30:00').toISOString(), 1)).toBe('2026-10-30')
    expect(reviewDueDateFrom(new Date('2026-10-28T21:30:00Z').toISOString(), 1)).toBe('2026-10-30')
    expect(reviewDueDateFrom(riyadh('2026-10-26T10:00:00').toISOString(), 30)).toBe('2026-11-25')
    vi.useFakeTimers({ now: riyadh('2026-10-29T23:30:00') })
    const sent = startInternalReview(draft(), 'author', '4.0', { reviewerIds: ['r1'], reviewDurationDays: 1 }, env)
    const round = currentInternalRound(sent)!
    expect(currentInternalRound(acceptInternalReview(sent, 'r1', round.id, round.assignments[0].id, env))!.assignments[0].reviewDueDate).toBe('2026-10-30')
  })

  it('shows the deadlines saved by the database, never a recalculated date', () => {
    const row = {
      id: 'sop', code: 'SOP-001', title: 'SOP', description: '', department_id: 'home', author_id: 'author', status: 'in-review', current_version: 1, updated_at: '2026-10-26T10:00:00Z',
      sop_versions: [{ version: 1, file_name: 'a.pdf', file_type: 'pdf', storage_path: 'author/a.pdf', uploaded_by: 'author', uploaded_at: '2026-10-26T09:00:00Z', deleted_at: null, deleted_by: null }],
      sop_co_authors: [], timeline_events: [], sop_comments: [], compliance_checks: [],
      review_rounds: [{ id: 'round', version: 1, status: 'open', requested_by: 'author', requested_at: '2026-10-26T10:00:00Z', closed_at: null,
        review_requests: [{ id: 'req', seq: 1, reviewer_id: 'r1', status: 'accepted', assigned_at: '2026-10-26T10:00:00Z',
          // Saved values that no browser rule would produce, to prove they are shown as saved.
          response_due_date: '2026-11-04', response_due_at: '2026-11-04T20:59:59.999Z', review_duration_days: 3, accepted_at: '2026-10-26T11:00:00Z',
          review_due_date: '2026-11-09', review_due_at: '2026-11-09T20:59:59.999Z', decided_at: null, decline_reason: null, comment_id: null, withdrawn_at: null,
          removed_at: null, removed_by: null, removal_reason: null, status_before_removal: null }] }],
    } as unknown as SopRow
    const request = currentInternalRound(toSop(row))!.assignments[0]
    expect(requestDeadline(request)).toEqual({ phase: 'review', dueAt: '2026-11-09T20:59:59.999Z' })
    expect(requestDeadline({ ...request, acceptedAt: undefined })).toEqual({ phase: 'response', dueAt: '2026-11-04T20:59:59.999Z' })
    expect(withdrawalDueAt({ ...request, decision: 'pending' })).toBe('2026-11-04T20:59:59.999Z')
  })
})
