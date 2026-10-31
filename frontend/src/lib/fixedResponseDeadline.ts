import { addRiyadhWorkingDays, riyadhDate } from './riyadhWorkingDays.ts'

/** The new request dialog's response policy. Existing saved deadlines are never recalculated. */
export const RESPONSE_WORKING_DAYS = 2

/**
 * The second working date after the request's Riyadh date; Friday and Saturday do not count.
 * The send date does not count as a whole working day. Returns YYYY-MM-DD for the existing
 * responseDueDate contract. New local requests also store the precise Riyadh end-of-day timestamp.
 */
export function fixedResponseDueDate(now = new Date()): string {
  return addRiyadhWorkingDays(riyadhDate(now), RESPONSE_WORKING_DAYS)
}
