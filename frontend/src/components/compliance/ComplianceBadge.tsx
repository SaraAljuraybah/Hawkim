import type { ComplianceResult } from '../../data/mock/types'

/* Same colour pairs as the status badges (all meet WCAG AA); Not addressed uses the neutral Draft style. */
const styles: Record<ComplianceResult, string> = {
  compliant: 'bg-status-approved-bg text-status-approved-fg',
  partial: 'bg-status-pending-bg text-status-pending-fg',
  conflict: 'bg-status-rejected-bg text-status-rejected-fg',
  'not-addressed': 'bg-status-cancelled-bg text-status-cancelled-fg',
}

/** A compliance result as a small pill; the label is always shown as text. */
export function ComplianceBadge({ result, labels }: { result: ComplianceResult; labels: Record<ComplianceResult, string> }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${styles[result]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {labels[result]}
    </span>
  )
}
