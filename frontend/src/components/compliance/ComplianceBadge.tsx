import type { ComplianceResult } from '../../data/mock/types'

/* Same colour pairs as the status badges (all meet WCAG AA); Not addressed uses the neutral Draft style. */
const styles: Record<ComplianceResult, string> = {
  compliant: 'bg-status-approved-bg text-status-approved-fg',
  partial: 'bg-status-pending-bg text-status-pending-fg',
  conflict: 'bg-status-rejected-bg text-status-rejected-fg',
  'not-addressed': 'bg-status-cancelled-bg text-status-cancelled-fg',
}

/* A count of 0: the neutral gray pair (#45464b on #f1f1f2, 8.6:1), whatever the result. */
const muted = 'bg-status-cancelled-bg text-status-cancelled-fg'

interface ComplianceBadgeProps {
  result: ComplianceResult
  labels: Record<ComplianceResult, string>
  /** A number of findings, shown in the badge instead of the dot, e.g. "2 Compliant"; 0 is shown muted. */
  count?: number
}

/** A compliance result as a small pill; the label is always shown as text. */
export function ComplianceBadge({ result, labels, count }: ComplianceBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${count === 0 ? muted : styles[result]}`}
    >
      {count === undefined ? (
        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      ) : (
        <span className="font-semibold tabular-nums">{count}</span>
      )}
      {labels[result]}
    </span>
  )
}
