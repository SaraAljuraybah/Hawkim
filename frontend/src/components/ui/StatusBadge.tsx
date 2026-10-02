import { statusLabelsEn } from '../../content/status.en'
import type { Status } from '../../types/status'

interface StatusBadgeProps {
  status: Status
  /** Status labels; defaults to English. */
  labels?: Record<Status, string>
  className?: string
}

/* Colours come from the status tokens in index.css (all pairs meet WCAG AA). */
const styles: Record<Status, string> = {
  pending: 'bg-status-pending-bg text-status-pending-fg',
  approved: 'bg-status-approved-bg text-status-approved-fg',
  rejected: 'bg-status-rejected-bg text-status-rejected-fg',
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
