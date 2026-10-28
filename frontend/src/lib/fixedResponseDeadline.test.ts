import { describe, expect, it } from 'vitest'
import { fixedResponseDueDate } from './fixedResponseDeadline'

describe('fixed response deadline in Riyadh', () => {
  it.each([
    ['2026-10-25T09:00:00+03:00', '2026-10-27'],
    ['2026-10-28T09:00:00+03:00', '2026-11-01'],
    ['2026-10-29T18:00:00+03:00', '2026-11-02'],
    ['2026-10-30T09:00:00+03:00', '2026-11-02'],
    ['2026-10-31T09:00:00+03:00', '2026-11-02'],
    ['2026-12-31T09:00:00+03:00', '2027-01-04'],
  ])('counts two future Sun–Thu dates from %s, without counting the request day', (sentAt, dueDate) => {
    expect(fixedResponseDueDate(new Date(sentAt))).toBe(dueDate)
  })

  it('uses the Riyadh calendar day across UTC midnight boundaries', () => {
    expect(fixedResponseDueDate(new Date('2026-10-28T20:59:59.999Z'))).toBe('2026-11-01')
    expect(fixedResponseDueDate(new Date('2026-10-28T21:00:00.000Z'))).toBe('2026-11-02')
  })

  it('rejects an invalid request timestamp instead of creating an invalid service date', () => {
    expect(() => fixedResponseDueDate(new Date('invalid'))).toThrow(/valid request timestamp/)
  })
})
