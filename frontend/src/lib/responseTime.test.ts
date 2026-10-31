import { describe, expect, it } from 'vitest'
import { reviewDueDateFrom } from './internalReviewStatus'
import { formatReviewDuration } from './reviewDuration'
import { isAfterResponseCutoff, parseResponseDueDate, RESPONSE_CUTOFF_HOUR, RESPONSE_START_HOUR, responseCountsFrom, responseDueDateRange, responseTimeMilliseconds } from './responseTime'

/** A moment in Riyadh time (UTC+03:00), whatever the device's time zone. */
const riyadh = (date: string, hours: number, minutes = 0) => new Date(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00+03:00`)
/** Oct 26, 2026 at this Riyadh time. */
const oct26 = (hours: number, minutes = 0) => riyadh('2026-10-26', hours, minutes)
/** Whole minutes, as the examples count them (the deadline is 11:59:59.999 PM). */
const minutes = (milliseconds: number) => Math.floor(milliseconds / 60_000)

describe('response time working-hours rule', () => {
  it('starts at 8:00 AM and cuts off at 4:00 PM', () => {
    expect(RESPONSE_START_HOUR).toBe(8)
    expect(RESPONSE_CUTOFF_HOUR).toBe(16)
  })

  it('counts from the moment it is sent between 8:00 AM and 3:59 PM', () => {
    expect(responseCountsFrom(oct26(8))).toEqual(oct26(8))
    expect(responseCountsFrom(oct26(14))).toEqual(oct26(14))
    expect(responseCountsFrom(oct26(15, 59))).toEqual(oct26(15, 59))
  })

  it('counts from 8:00 AM the same day before 8:00 AM', () => {
    expect(responseCountsFrom(oct26(6, 30))).toEqual(oct26(8))
    expect(responseCountsFrom(oct26(7, 59))).toEqual(oct26(8))
    expect(responseCountsFrom(oct26(0, 0))).toEqual(oct26(8))
  })

  it('counts from 8:00 AM the next day at or after 4:00 PM, across the month end', () => {
    expect(responseCountsFrom(oct26(16))).toEqual(riyadh('2026-10-27', 8))
    expect(responseCountsFrom(oct26(16, 40))).toEqual(riyadh('2026-10-27', 8))
    expect(responseCountsFrom(oct26(23, 59))).toEqual(riyadh('2026-10-27', 8))
    expect(responseCountsFrom(riyadh('2026-10-31', 16))).toEqual(riyadh('2026-11-01', 8))
    expect(responseCountsFrom(riyadh('2026-12-31', 18))).toEqual(riyadh('2027-01-01', 8))
  })

  it('gives the time to respond up to the end of the due date', () => {
    // Sent Oct 26 at 2:00 PM, due Oct 27: 1 day 9 h 59 min.
    expect(minutes(responseTimeMilliseconds('2026-10-27', oct26(14)))).toBe((24 + 9) * 60 + 59)
    expect(formatReviewDuration(responseTimeMilliseconds('2026-10-27', oct26(14)))).toBe('1 day 9 hours')
    // Sent Oct 26 at 4:40 PM: counts from Oct 27 at 8:00 AM, so 15 h 59 min.
    expect(minutes(responseTimeMilliseconds('2026-10-27', oct26(16, 40)))).toBe(15 * 60 + 59)
    expect(formatReviewDuration(responseTimeMilliseconds('2026-10-27', oct26(16, 40)))).toBe('15 hours 59 minutes')
    // 3:59 PM counts from now, 4:00 PM from the next morning.
    expect(minutes(responseTimeMilliseconds('2026-10-27', oct26(15, 59)))).toBe((24 + 8) * 60)
    expect(minutes(responseTimeMilliseconds('2026-10-27', oct26(16)))).toBe(15 * 60 + 59)
    // Before 8:00 AM, a same-day due date counts from 8:00 AM.
    expect(minutes(responseTimeMilliseconds('2026-10-26', oct26(6, 30)))).toBe(15 * 60 + 59)
    expect(minutes(responseTimeMilliseconds('2026-10-26', oct26(7, 59)))).toBe(15 * 60 + 59)
    expect(minutes(responseTimeMilliseconds('2026-10-26', oct26(8)))).toBe(15 * 60 + 59)
  })

  it('allows today as the earliest due date before 4:00 PM, including before 8:00 AM', () => {
    for (const sentAt of [oct26(6, 30), oct26(7, 59), oct26(8), oct26(15, 59)]) {
      expect(isAfterResponseCutoff(sentAt)).toBe(false)
      expect(responseDueDateRange(sentAt)).toEqual({ min: '2026-10-26' })
      expect(parseResponseDueDate('2026-10-26', sentAt)).toEqual({ valid: true, days: 0 })
    }
    expect(parseResponseDueDate('2026-10-25', oct26(14))).toEqual({ valid: false })
  })

  it('allows tomorrow as the earliest due date from 4:00 PM', () => {
    for (const sentAt of [oct26(16), oct26(16, 40), oct26(23, 59)]) {
      expect(isAfterResponseCutoff(sentAt)).toBe(true)
      expect(responseDueDateRange(sentAt)).toEqual({ min: '2026-10-27' })
      expect(parseResponseDueDate('2026-10-26', sentAt)).toEqual({ valid: false })
      expect(parseResponseDueDate('2026-10-27', sentAt)).toEqual({ valid: true, days: 1 })
    }
    expect(responseDueDateRange(riyadh('2026-10-31', 16))).toEqual({ min: '2026-11-01' })
  })

  it('accepts a blank due date and rejects dates that are not real', () => {
    expect(parseResponseDueDate('', oct26(16))).toEqual({ valid: true })
    expect(parseResponseDueDate('   ', oct26(14))).toEqual({ valid: true })
    for (const date of ['2026-02-30', 'invalid', '26-10-2026']) expect(parseResponseDueDate(date, oct26(14)).valid).toBe(false)
  })

  it('does not affect the review duration, which counts from acceptance', () => {
    // A request sent at 4:40 PM and accepted right away still gets the full duration from that day.
    expect(reviewDueDateFrom(oct26(16, 40).toISOString(), 5)).toBe('2026-10-31')
    expect(reviewDueDateFrom(oct26(6, 30).toISOString(), 1)).toBe('2026-10-27')
  })
})
