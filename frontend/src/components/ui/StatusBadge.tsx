import { statusLabelsEn } from '../../content/status.en'
import type { BadgeStatus } from '../../types/status'

interface StatusBadgeProps {
  status: BadgeStatus
  /** Status labels; defaults to English. */
  labels?: Record<BadgeStatus, string>
  className?: string
}

/* Colours come from the status tokens in index.css (all pairs meet WCAG AA). */
const styles: Record<BadgeStatus, string> = {
  // Requests
  pending: 'bg-status-pending-bg text-status-pending-fg',
  approved: 'bg-status-approved-bg text-status-approved-fg',
  rejected: 'bg-status-rejected-bg text-status-rejected-fg',
  cancelled: 'bg-status-cancelled-bg text-status-cancelled-fg',
  // SOP lifecycle (reusing the same colour pairs, plus a maroon tint for Published)
  draft: 'bg-status-cancelled-bg text-status-cancelled-fg',
  'in-review': 'bg-status-pending-bg text-status-pending-fg',
  returned: 'bg-status-rejected-bg text-status-rejected-fg',
  'in-approval': 'bg-status-pending-bg text-status-pending-fg',
  published: 'bg-status-published-bg text-status-published-fg',
}

/**
 * Small pill showing a workflow status.
 * The label is always shown as text, so colour is never the only signal.
 */
export function StatusBadge({ status, labels = statusLabelsEn, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${styles[status]} ${className}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {labels[status]}
    </span>
  )
}
