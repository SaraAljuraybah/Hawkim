import { describe, expect, it } from 'vitest'
import { fixedResponseDueDate } from './fixedResponseDeadline'
import { isWithdrawalDue, requestDeadline, reviewDueDateFrom } from './internalReviewStatus'
import { addRiyadhWorkingDays, endOfRiyadhDay, responseWorkingCountsFrom, reviewWorkingDueDateFrom, riyadhDate } from './riyadhWorkingDays'

describe('frontend Riyadh working-day allocations', () => {
  it.each([
    ['2026-10-25', 1, '2026-10-26'], ['2026-10-25', 2, '2026-10-27'],
    ['2026-10-25', 3, '2026-10-28'], ['2026-10-25', 5, '2026-11-01'], ['2026-10-25', 10, '2026-11-08'],
    ['2026-10-25', 30, '2026-12-06'],
    ['2026-10-29', 1, '2026-11-01'], ['2026-10-29', 2, '2026-11-02'], ['2026-10-29', 3, '2026-11-03'],
    ['2026-10-29', 5, '2026-11-05'], ['2026-10-29', 10, '2026-11-12'],
    ['2026-10-30', 1, '2026-11-01'], ['2026-10-31', 1, '2026-11-01'],
    ['2026-12-31', 1, '2027-01-03'], ['2026-12-31', 2, '2027-01-04'],
    ['2028-02-28', 1, '2028-02-29'], ['2028-02-29', 1, '2028-03-01'],
  ])('allocates from %s for %i working days to %s without counting the start date or Fri/Sat', (start, days, due) => {
    expect(addRiyadhWorkingDays(start, days)).toBe(due)
    expect(reviewWorkingDueDateFrom(`${start}T15:00:00+03:00`, days)).toBe(due)
  })

  it('uses the Riyadh date across UTC midnight independently of the execution timezone', () => {
    expect(riyadhDate(new Date('2026-10-28T20:59:59.999Z'))).toBe('2026-10-28')
    expect(riyadhDate(new Date('2026-10-28T21:00:00.000Z'))).toBe('2026-10-29')
    expect(reviewWorkingDueDateFrom('2026-10-28T20:59:59.999Z', 1)).toBe('2026-10-29')
    expect(reviewWorkingDueDateFrom('2026-10-28T21:00:00.000Z', 1)).toBe('2026-11-01')
  })

  it.each([
    ['2026-10-25T06:30:00+03:00', '2026-10-25T08:00:00+03:00'],
    ['2026-10-25T08:00:00+03:00', '2026-10-25T08:00:00+03:00'],
    ['2026-10-25T15:59:59.999+03:00', '2026-10-25T15:59:59.999+03:00'],
    ['2026-10-25T16:00:00+03:00', '2026-10-26T08:00:00+03:00'],
    ['2026-10-29T16:00:00+03:00', '2026-11-01T08:00:00+03:00'],
    ['2026-10-30T09:00:00+03:00', '2026-11-01T08:00:00+03:00'],
    ['2026-10-31T09:00:00+03:00', '2026-11-01T08:00:00+03:00'],
  ])('starts the original response allocation from working hours for %s', (sent, from) => {
    expect(responseWorkingCountsFrom(new Date(sent)).toISOString()).toBe(new Date(from).toISOString())
  })

  it('keeps the fixed response allocation separate from the acceptance-based duration', () => {
    const sent = new Date('2026-10-29T14:00:00+03:00')
    expect(fixedResponseDueDate(sent)).toBe('2026-11-02')
    expect(reviewWorkingDueDateFrom('2026-11-01T15:00:00+03:00', 5)).toBe('2026-11-08')
    expect(endOfRiyadhDay('2026-11-08')).toBe('2026-11-08T20:59:59.999Z')
  })

  it('uses precise stored timestamps at expiry and does not reinterpret them from date-only metadata', () => {
    const request = { decision: 'pending' as const, responseDueDate: '2026-11-01', responseDueAt: '2026-11-02T20:59:59.999Z' }
    const due = Date.parse(request.responseDueAt)
    expect(requestDeadline(request)?.dueAt).toBe(request.responseDueAt)
    expect(isWithdrawalDue(request, due - 1)).toBe(false)
    expect(isWithdrawalDue(request, due)).toBe(true)
    expect(requestDeadline({ ...request, acceptedAt: '2026-11-01T10:00:00Z', reviewDueDate: '2026-11-08', reviewDueAt: '2026-11-08T20:59:59.999Z' }))
      .toEqual({ phase: 'review', dueAt: '2026-11-08T20:59:59.999Z' })
  })

  it('retains the legacy calendar helper for existing records without a policy marker', () => {
    const accepted = new Date(2026, 9, 25, 15).toISOString()
    expect(reviewDueDateFrom(accepted, 5)).toBe('2026-10-30')
    expect(requestDeadline({ responseDueDate: '2026-10-30' })?.dueAt).toBe(new Date('2026-10-30T23:59:59.999').toISOString())
  })

  it('rejects invalid dates and non-integral durations', () => {
    for (const date of ['2026-02-30', 'invalid', '2026-2-01']) expect(() => endOfRiyadhDay(date)).toThrow(/valid calendar date/)
    expect(() => riyadhDate(new Date('invalid'))).toThrow(/valid request timestamp/)
    for (const duration of [-1, 1.5, Number.NaN]) expect(() => addRiyadhWorkingDays('2026-10-29', duration)).toThrow(/whole/)
  })
})
