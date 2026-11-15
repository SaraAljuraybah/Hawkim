import type { GuidelineAvailability } from '../services/compliance'

/** Why Check Compliance can't run (null: it can). 'error': whether a guideline exists couldn't be read. */
export type GuidelineUnavailableState = Exclude<GuidelineAvailability, 'available'> | 'error' | null

/**
 * What Check Compliance does first. With a current guideline (as loaded), nothing: the check starts as before.
 * Without one, the database is asked why (guideline_availability): a reason means no check is started and the
 * author is told it; 'available' (one was published since the page loaded) reads the guidelines again, then the
 * check starts as usual. A failed read is 'error', never taken for "no guideline".
 */
export async function guidelineGate(
  hasCurrent: boolean,
  readAvailability: () => Promise<GuidelineAvailability>,
  refreshGuidelines: () => Promise<void>,
): Promise<GuidelineUnavailableState> {
  if (hasCurrent) return null
  let availability: GuidelineAvailability
  try {
    availability = await readAvailability()
  } catch {
    return 'error'
  }
  if (availability !== 'available') return availability
  await refreshGuidelines()
  return null
}
