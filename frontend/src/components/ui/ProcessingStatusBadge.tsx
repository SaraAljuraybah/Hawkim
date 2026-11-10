import { adminEn } from '../../content/admin.en'
import type { GuidelineProcessing } from '../../data/mock/types'

/** The status colours: Waiting yellow, Processing blue, Ready green, Failed red (always with the label as text). */
const STYLE: Record<GuidelineProcessing['status'], string> = {
  waiting: 'bg-status-pending-bg text-status-pending-fg',
  processing: 'bg-status-processing-bg text-status-processing-fg',
  ready: 'bg-status-approved-bg text-status-approved-fg',
  failed: 'bg-status-rejected-bg text-status-rejected-fg',
}

/**
 * An added GVP version's processing status (Waiting, Processing…, Ready, Failed): the same label in the
 * versions list and, larger, as the heading of the Status card on the version's page.
 */
export function ProcessingStatusBadge({ status, size = 'sm' }: { status: GuidelineProcessing['status']; size?: 'sm' | 'lg' }) {
  const sizing = size === 'lg' ? 'px-3 py-1 text-base' : 'px-2 py-0.5 text-xs'
  return (
    <span className={`inline-block rounded-full font-medium whitespace-nowrap ${sizing} ${STYLE[status]}`}>
      {adminEn.regulations.processingStatus[status]}
    </span>
  )
}
