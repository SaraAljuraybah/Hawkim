import { adminEn } from '../../content/admin.en'

const text = adminEn.regulationDetails.processing.queue

/**
 * What an added GVP version's card says about its place in the compliance service's queue, which serves
 * every organization (guideline_queue_position): nothing while it is unknown.
 */
export function queuePositionText(position: number | null): string | null {
  if (position === null || position < 1) return null
  return position === 1 ? text.next : text.position.replace('{position}', position.toLocaleString('en-US'))
}
