import type { ComplianceResult } from '../../data/mock/types'

/* Same colour pairs as the status badges (all meet WCAG AA); Not addressed uses the neutral Draft style. */
const styles: Record<ComplianceResult, string> = {
  compliant: 'bg-status-approved-bg text-status-approved-fg',
  partial: 'bg-status-pending-bg text-status-pending-fg',
  conflict: 'bg-status-rejected-bg text-status-rejected-fg',
  'not-addressed': 'bg-status-cancelled-bg text-status-cancelled-fg',
}

/*
 * A count of 0, whatever the result: outlined (no fill), so it can't be mistaken for the
 * filled gray Not addressed badge. Gray text #55565a is 7.4:1 on the white card.
 */
const zero = 'border-text-gray/40 bg-transparent text-text-gray'
const filled = 'border-current/15'

interface ComplianceBadgeProps {
  result: ComplianceResult
  labels: Record<ComplianceResult, string>
  /** A number of findings, shown in the badge instead of the dot, e.g. "2 Compliant"; 0 is outlined. */
  count?: number
}

/** A compliance result as a small pill; the label is always shown as text. */
export function ComplianceBadge({ result, labels, count }: ComplianceBadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${count === 0 ? zero : `${filled} ${styles[result]}`}`}
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
