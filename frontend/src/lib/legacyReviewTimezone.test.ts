import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sop } from '../data/mock/types'
import { approvalDueDateRange, dueAtOfDate, dueDateRange, parseDueDate, resubmit, returnAsReviewer, reviewerAssignedMilliseconds, reviewerDueAt, shiftDueDates, submitForReview, uploadVersion } from './workflow'

const sentAt = '2026-10-29T21:30:00.123Z' // Friday 00:30 in Riyadh, Thursday in UTC.
const deadline = '2026-10-30T20:59:59.999Z'
function draft(): Sop {
  return { id: 'legacy', code: 'SOP-001', title: 'Legacy review', departmentId: 'home', authorId: 'author', coAuthorIds: [], version: '1', status: 'draft', lastUpdated: '2026-10-29',
    fileName: 'review.pdf', fileType: 'pdf', versions: [{ version: '1', fileName: 'review.pdf', fileType: 'pdf', uploadedAt: '2026-10-29T10:00:00Z', uploadedById: 'author' }],
    reviewers: [], approvers: [], comments: [], timeline: [], complianceChecks: [{ id: 'check', sopId: 'legacy', version: '1', status: 'completed', startedAt: '2026-10-29T10:00:00Z', guideline: { name: 'GVP', version: '4' }, findings: [] }] }
}
function submit() { return submitForReview(draft(), 'author', '4', ['reviewer'], ['approver'], undefined, undefined, undefined, { reviewer: '2026-10-30' }) }
beforeEach(() => vi.useFakeTimers({ now: new Date(sentAt) }))
afterEach(() => vi.useRealTimers())

describe('new legacy review dates in the frontend Riyadh prototype', () => {
  it('validates against the Riyadh date across UTC midnight, without a maximum', () => {
    expect(dueDateRange()).toEqual({ min: '2026-10-30' })
    expect(parseDueDate('2026-10-29').valid).toBe(false)
    expect(parseDueDate('2026-10-30')).toEqual({ valid: true, days: 0 })
    expect(parseDueDate('2027-01-01').valid).toBe(true)
    expect(parseDueDate('2026-02-30').valid).toBe(false)
    expect(parseDueDate('')).toEqual({ valid: true })
  })
  it('stores a precise Riyadh deadline for new allocations and keeps real time given separate', () => {
    const sop = submit()
    expect(sop.reviewers[0]).toMatchObject({ assignedAt: sentAt, dueDate: '2026-10-30', reviewDueAt: deadline, assignedDueDays: 0 })
    expect(reviewerDueAt(sop, sop.reviewers[0])).toBe(deadline)
    expect(reviewerAssignedMilliseconds(sop, sop.reviewers[0])).toBe(Date.parse(deadline) - Date.parse(sentAt))
    expect(reviewerAssignedMilliseconds(sop, sop.reviewers[0])).toBeLessThan(24 * 60 * 60 * 1000)
    const simulated = shiftDueDates(sop, 1)
    expect(reviewerDueAt(simulated, simulated.reviewers[0])).toBe('2026-10-29T20:59:59.999Z')
    expect(reviewerAssignedMilliseconds(simulated, simulated.reviewers[0])).toBe(reviewerAssignedMilliseconds(sop, sop.reviewers[0]))
  })
  it('uses the same Riyadh allocation for resubmission without changing the previous submission', () => {
    const returned = returnAsReviewer(submit(), 'reviewer', 'Please revise')
    vi.advanceTimersByTime(1000)
    const revised = uploadVersion(returned, 'author', { fileName: 'revision.pdf', fileType: 'pdf' })
    revised.complianceChecks.push({ ...revised.complianceChecks[0], id: 'new-check', version: revised.version })
    const before = structuredClone(revised)
    const again = resubmit(revised, 'author', '4', 'Revised', '2026-10-30')
    expect(again.reviewers[0].reviewDueAt).toBe(deadline)
    expect(again.reviewers[0].assignedAt).toBe(new Date().toISOString())
    expect(again.timeline.slice(0, revised.timeline.length)).toEqual(revised.timeline)
    expect(revised).toEqual(before)
  })
  it('retains date-only historical interpretation and existing approval date restrictions', () => {
    const sop = submit()
    const historical = { userId: 'reviewer', decision: 'pending' as const, dueDate: '2026-10-30', assignedDueDays: 1 }
    expect(reviewerDueAt(sop, historical)).toBe(dueAtOfDate('2026-10-30'))
    const now = new Date()
    const localTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    expect(approvalDueDateRange(now).min).toBe(`${localTomorrow.getFullYear()}-${String(localTomorrow.getMonth() + 1).padStart(2, '0')}-${String(localTomorrow.getDate()).padStart(2, '0')}`)
  })
})
