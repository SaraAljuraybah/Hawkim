/** The new request dialog's response policy. Existing saved deadlines are never recalculated. */
export const RESPONSE_WORKING_DAYS = 2
const RIYADH_TIME_ZONE = 'Asia/Riyadh'
const DAY_MS = 24 * 60 * 60 * 1000

/** Riyadh calendar date, independent of the browser's time zone. */
function riyadhDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: RIYADH_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

/**
 * The second working date after the request's Riyadh date; Friday and Saturday do not count.
 * The send date does not count as a whole working day. Returns YYYY-MM-DD for the existing
 * responseDueDate contract, whose end-of-day interpretation remains with the workflow service.
 */
export function fixedResponseDueDate(now = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new Error('A valid request timestamp is required')
  let date = new Date(`${riyadhDate(now)}T00:00:00.000Z`)
  let remaining = RESPONSE_WORKING_DAYS
  while (remaining > 0) {
    date = new Date(date.getTime() + DAY_MS)
    const weekday = date.getUTCDay()
    if (weekday !== 5 && weekday !== 6) remaining -= 1
  }
  return date.toISOString().slice(0, 10)
}
