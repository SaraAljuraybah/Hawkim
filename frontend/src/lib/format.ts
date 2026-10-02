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
