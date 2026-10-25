import { todayIsoDate } from './format'
import { endOfLocalDay } from './internalReviewStatus'
import { daysFromToday } from './workflow'

/*
 * Working-hours rule for the response time of an internal review request (local time). A request
 * sent outside working hours is unlikely to be seen before the next morning, so the time to respond
 * counts from 8:00 AM: the same day before 8:00 AM, the next calendar day from 4:00 PM. The response
 * deadline itself never moves (the end of the chosen day), and the reviewer can respond at any time.
 * It applies only to the response due date, not to the review duration. Pure functions.
 */

/** The response time starts no earlier than this hour of the day. */
export const RESPONSE_START_HOUR = 8
/** A request sent at or after this hour counts from the start hour of the next day. */
export const RESPONSE_CUTOFF_HOUR = 16

/** Whether a request sent at this moment counts from the next day (4:00 PM or later). */
export function isAfterResponseCutoff(sentAt: Date): boolean {
  return sentAt.getHours() >= RESPONSE_CUTOFF_HOUR
}

/** When the time to respond starts: 8:00 AM the same day, the moment it was sent, or 8:00 AM the next day. */
export function responseCountsFrom(sentAt: Date): Date {
  const [year, month, day] = [sentAt.getFullYear(), sentAt.getMonth(), sentAt.getDate()]
  if (sentAt.getHours() < RESPONSE_START_HOUR) return new Date(year, month, day, RESPONSE_START_HOUR)
  if (isAfterResponseCutoff(sentAt)) return new Date(year, month, day + 1, RESPONSE_START_HOUR)
  return sentAt
}

/** The earliest response due date: today, or tomorrow from 4:00 PM (today would leave no time). */
export function responseDueDateRange(now = new Date()): { min: string; max?: string } {
  return { min: todayIsoDate(isAfterResponseCutoff(now) ? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) : now) }
}

/** An optional response due date ("2026-10-27") as calendar days from today. Empty is valid; a date before the earliest is not. */
export function parseResponseDueDate(isoDate: string, now = new Date()): { valid: boolean; days?: number } {
  if (!isoDate.trim()) return { valid: true }
  const days = daysFromToday(isoDate.trim(), now)
  return days !== undefined && days >= (isAfterResponseCutoff(now) ? 1 : 0) ? { valid: true, days } : { valid: false }
}

/** The time to respond: from when it starts counting to the end of the response due date. */
export function responseTimeMilliseconds(isoDate: string, sentAt = new Date()): number {
  return new Date(endOfLocalDay(isoDate)).getTime() - responseCountsFrom(sentAt).getTime()
}
