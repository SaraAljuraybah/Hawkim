import { addRiyadhCalendarDays, calendarDaysBetween, endOfRiyadhDay, riyadhDate, riyadhDateAt, riyadhHour } from './riyadhWorkingDays'

/*
 * Working-hours rule for the response time of an internal review request, in Riyadh time (as the
 * approved database: earliest_response_date() in 20261026150000_internal_review.sql). A request sent
 * outside working hours is unlikely to be seen before the next morning, so the time to respond counts
 * from 8:00 AM: the same day before 8:00 AM, the next calendar day from 4:00 PM. The response deadline
 * itself never moves (the end of the chosen day in Riyadh), and the reviewer can respond at any time.
 * It applies only to the response due date, not to the review duration. Pure functions; the result
 * never depends on the device's time zone.
 */

/** The response time starts no earlier than this hour of the day (Riyadh). */
export const RESPONSE_START_HOUR = 8
/** A request sent at or after this hour (Riyadh) counts from the start hour of the next day. */
export const RESPONSE_CUTOFF_HOUR = 16

/** Whether a request sent at this moment counts from the next day (4:00 PM Riyadh or later). */
export function isAfterResponseCutoff(sentAt: Date): boolean {
  return riyadhHour(sentAt) >= RESPONSE_CUTOFF_HOUR
}

/** When the time to respond starts: 8:00 AM the same day, the moment it was sent, or 8:00 AM the next day (Riyadh). */
export function responseCountsFrom(sentAt: Date): Date {
  const day = riyadhDate(sentAt)
  if (riyadhHour(sentAt) < RESPONSE_START_HOUR) return riyadhDateAt(day, RESPONSE_START_HOUR)
  if (isAfterResponseCutoff(sentAt)) return riyadhDateAt(addRiyadhCalendarDays(day, 1), RESPONSE_START_HOUR)
  return sentAt
}

/** The earliest response due date (Riyadh): today, or tomorrow from 4:00 PM (today would leave no time). */
export function responseDueDateRange(now = new Date()): { min: string; max?: string } {
  const today = riyadhDate(now)
  return { min: isAfterResponseCutoff(now) ? addRiyadhCalendarDays(today, 1) : today }
}

/** An optional response due date ("2026-10-27") as calendar days from today in Riyadh. Empty is valid; a date before the earliest is not. */
export function parseResponseDueDate(isoDate: string, now = new Date()): { valid: boolean; days?: number } {
  if (!isoDate.trim()) return { valid: true }
  const days = calendarDaysBetween(riyadhDate(now), isoDate.trim())
  return days !== undefined && days >= (isAfterResponseCutoff(now) ? 1 : 0) ? { valid: true, days } : { valid: false }
}

/** The time to respond: from when it starts counting to the end of the response due date in Riyadh. */
export function responseTimeMilliseconds(isoDate: string, sentAt = new Date()): number {
  return new Date(endOfRiyadhDay(isoDate)).getTime() - responseCountsFrom(sentAt).getTime()
}
