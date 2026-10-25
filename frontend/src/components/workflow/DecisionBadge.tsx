import type { ApproverDecision, InternalReviewDecision, ReviewerDecision } from '../../data/mock/types'

type Decision = ReviewerDecision | ApproverDecision | InternalReviewDecision | 'overdue'

/*
 * Same colour pairs as the status badges (all meet WCAG AA). A reviewer's Accepted is green and
 * Completed uses the maroon tint, so the two differ; an approver's Approved stays green.
 */
const styles: Record<Decision, string> = {
  pending: 'bg-status-pending-bg text-status-pending-fg',
  accepted: 'bg-status-approved-bg text-status-approved-fg',
  completed: 'bg-status-published-bg text-status-published-fg',
  approved: 'bg-status-approved-bg text-status-approved-fg',
  returned: 'bg-status-rejected-bg text-status-rejected-fg',
  declined: 'bg-status-cancelled-bg text-status-cancelled-fg',
  withdrawn: 'bg-status-cancelled-bg text-status-cancelled-fg',
  removed: 'bg-status-cancelled-bg text-status-cancelled-fg',
  cancelled: 'bg-beige text-text-gray',
  overdue: 'bg-status-rejected-bg text-status-rejected-fg',
}

/** A reviewer's or approver's decision as a small pill; the label is always shown as text. */
export function DecisionBadge<D extends Decision>({ decision, labels }: { decision: D; labels: Record<D, string> }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${styles[decision]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {labels[decision]}
    </span>
  )
}
