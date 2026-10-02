/**
 * Formats an ISO date ("2024-01-12") for display, e.g. "Jan 12, 2024".
 * Uses UTC so a date-only value never shifts to the previous day
 * in time zones behind UTC.
 */
export function formatDate(isoDate: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(isoDate))
}

/** Today's date in the user's local time zone as an ISO date ("2024-01-12"). */
export function todayIsoDate(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}
