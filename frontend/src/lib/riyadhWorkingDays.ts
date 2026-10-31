/**
 * Riyadh working-day calendar (Sunday to Thursday). Pending activation (lib/deadlinePolicy.ts):
 * the server enforces and saves deadlines; this calculates the same dates for previews and tests.
 */
export const REVIEW_TIME_ZONE = 'Asia/Riyadh'
export const WORKING_DAY_POLICY = 'riyadh-working-days-v1' as const
const DAY_MS = 24 * 60 * 60 * 1000
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REVIEW_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** A Riyadh calendar date, independent of the browser's time zone. */
export function riyadhDate(at: Date): string {
  if (!Number.isFinite(at.getTime())) throw new Error('A valid request timestamp is required')
  const parts = dateFormatter.formatToParts(at)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

function dateOnly(isoDate: string): Date {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== isoDate) {
    throw new Error('A valid calendar date is required')
  }
  return date
}

/*
 * Riyadh calendar helpers shared by the live (approved) deadline rules and the pending working-day
 * policy. They never depend on the device's time zone (Saudi Arabia has no daylight saving, but the
 * named zone is used anyway).
 */
const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: REVIEW_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' })

/** The hour of the day (0–23) in Riyadh. */
export function riyadhHour(at: Date): number {
  if (!Number.isFinite(at.getTime())) throw new Error('A valid timestamp is required')
  return Number(hourFormatter.format(at))
}

/** A Riyadh calendar date plus whole calendar days (Friday and Saturday count). */
export function addRiyadhCalendarDays(isoDate: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error('A whole number of days is required')
  return new Date(dateOnly(isoDate).getTime() + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whole calendar days from one date to another ("2026-10-26" → "2026-10-28" is 2), or undefined for an invalid date. */
export function calendarDaysBetween(fromIsoDate: string, toIsoDate: string): number | undefined {
  try {
    return Math.round((dateOnly(toIsoDate).getTime() - dateOnly(fromIsoDate).getTime()) / DAY_MS)
  } catch {
    return undefined
  }
}

/** A moment at a given hour of a Riyadh date (UTC+03:00 all year). */
export function riyadhDateAt(isoDate: string, hour: number): Date {
  dateOnly(isoDate)
  return new Date(`${isoDate}T${String(hour).padStart(2, '0')}:00:00.000+03:00`)
}

/** Friday and Saturday are weekends. The starting date itself is never counted. */
export function addRiyadhWorkingDays(isoDate: string, days: number): string {
  if (!Number.isInteger(days) || days < 0) throw new Error('A non-negative whole working-day duration is required')
  let date = dateOnly(isoDate)
  let remaining = days
  while (remaining > 0) {
    date = new Date(date.getTime() + DAY_MS)
    if (date.getUTCDay() !== 5 && date.getUTCDay() !== 6) remaining -= 1
  }
  return date.toISOString().slice(0, 10)
}

/** End of the selected Riyadh date (UTC+03:00), as a precise ISO timestamp. */
export function endOfRiyadhDay(isoDate: string): string {
  dateOnly(isoDate)
  return new Date(`${isoDate}T23:59:59.999+03:00`).toISOString()
}

/** New requests only: count complete future working dates after the acceptance date. */
export function reviewWorkingDueDateFrom(acceptedAt: string, days: number): string {
  return addRiyadhWorkingDays(riyadhDate(new Date(acceptedAt)), days)
}

/**
 * The response working-hours display rule for local (sample) working-day requests, in Riyadh.
 * Before 08:00 starts at 08:00; from 16:00 and on weekends starts at the next working day's 08:00.
 */
export function responseWorkingCountsFrom(sentAt: Date): Date {
  const date = riyadhDate(sentAt)
  const weekday = dateOnly(date).getUTCDay()
  const hour = riyadhHour(sentAt)
  if (weekday === 5 || weekday === 6 || hour >= 16) return new Date(`${addRiyadhWorkingDays(date, 1)}T08:00:00.000+03:00`)
  return hour < 8 ? new Date(`${date}T08:00:00.000+03:00`) : sentAt
}
