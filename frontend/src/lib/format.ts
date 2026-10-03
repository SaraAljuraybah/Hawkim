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

/** Human-readable file size, e.g. "820 KB" or "2.4 MB". */
export function formatFileSize(bytes: number, locale = 'en-US'): string {
  const number = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)
  if (bytes < 1024) return `${number(bytes, 0)} B`
  if (bytes < 1024 * 1024) return `${number(bytes / 1024, 0)} KB`
  return `${number(bytes / (1024 * 1024), 1)} MB`
}

/** Month and day in the user's time zone, e.g. "Oct 5". */
export function formatMonthDay(isoDateTime: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(isoDateTime))
}

/** Date and time in the user's time zone, e.g. "Oct 3, 2026, 2:15 PM". */
export function formatDateTime(isoDateTime: string, locale = 'en-US'): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoDateTime))
}
