/*
 * Saudi mobile numbers as typed and stored. They are saved as "+9665" and 8 digits (the profiles.phone
 * format, which the database and the Edge Functions check); the phone fields show "+9665" as a fixed
 * prefix, so people type only the 8 digits.
 */

/** The fixed start of every phone number, shown before the field and saved with the 8 digits. */
export const PHONE_PREFIX = '+9665'

/** How many digits follow the prefix. */
export const PHONE_DIGITS = 8

/** The 8 digits of a stored number ("+9665XXXXXXXX"), or '' for anything else (or none). */
export function phoneDigitsOf(stored: string | undefined): string {
  const match = stored?.match(/^\+9665(\d{8})$/)
  return match ? match[1] : ''
}

/** The value a form keeps: the prefix and the digits as typed, or '' while nothing is typed. */
export function phoneValue(digits: string): string {
  return digits ? PHONE_PREFIX + digits : ''
}

/** Whether exactly the 8 digits are there. */
export function isCompletePhone(digits: string): boolean {
  return new RegExp(`^\\d{${PHONE_DIGITS}}$`).test(digits)
}

/**
 * The field's text after a change: digits only. After a paste or autofill (`pasted`), a whole number
 * written as 05XXXXXXXX, 5XXXXXXXX, +9665XXXXXXXX or 9665XXXXXXXX (spaces and dashes included) is cut
 * down to its 8 digits. Typing is never rewritten, so a 9th digit typed after an 8-digit number starting
 * with 5 stays (and shows the error).
 */
export function phoneInput(next: string, pasted: boolean): string {
  const digits = next.replace(/\D/g, '')
  if (!pasted) return digits
  const whole = digits.match(/^(?:9665|05|5)(\d{8})$/)
  return whole ? whole[1] : digits
}

/**
 * The phone field's error. Exactly 8 digits: none. Otherwise the form's own error (e.g. after Save), or
 * `invalidMessage` while `checking` (the field was left with a wrong number of digits) and not empty.
 */
export function phoneFieldError(digits: string, checking: boolean, formError: string | undefined, invalidMessage: string): string | undefined {
  if (isCompletePhone(digits)) return undefined
  return formError ?? (checking && digits ? invalidMessage : undefined)
}

/** Whether leaving the field starts checking: something typed, but not exactly 8 digits (empty waits for Save). */
export function checksOnBlur(digits: string): boolean {
  return digits.length > 0 && !isCompletePhone(digits)
}
