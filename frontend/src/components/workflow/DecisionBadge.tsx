import type { ApproverDecision, ReviewerDecision } from '../../data/mock/types'

type Decision = ReviewerDecision | ApproverDecision

/* Same colour pairs as the status badges (all meet WCAG AA). */
const styles: Record<Decision, string> = {
  pending: 'bg-status-pending-bg text-status-pending-fg',
  completed: 'bg-status-approved-bg text-status-approved-fg',
  approved: 'bg-status-approved-bg text-status-approved-fg',
  returned: 'bg-status-rejected-bg text-status-rejected-fg',
}

/** A reviewer's or approver's decision as a small pill; the label is always shown as text. */
export function DecisionBadge({ decision, labels }: { decision: Decision; labels: Record<Decision, string> }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${styles[decision]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {labels[decision]}
    </span>
  )
}
