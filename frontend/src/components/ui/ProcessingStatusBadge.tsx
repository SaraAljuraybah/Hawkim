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
 * An added GVP version's processing status (Waiting, Processing…, Ready, Failed), the same label in the
 * versions list and next to the version's title on its page.
 */
export function ProcessingStatusBadge({ status }: { status: GuidelineProcessing['status'] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STYLE[status]}`}>
      {adminEn.regulations.processingStatus[status]}
    </span>
  )
}
