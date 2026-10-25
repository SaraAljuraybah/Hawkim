import type { ApproverDecision, InternalReviewDecision, ReviewerDecision } from '../../data/mock/types'

type Decision = ReviewerDecision | ApproverDecision | InternalReviewDecision | 'overdue'

/* Same colour pairs as the status badges (all meet WCAG AA). */
const styles: Record<Decision, string> = {
  pending: 'bg-status-pending-bg text-status-pending-fg',
  accepted: 'bg-status-published-bg text-status-published-fg',
  completed: 'bg-status-approved-bg text-status-approved-fg',
  approved: 'bg-status-approved-bg text-status-approved-fg',
  returned: 'bg-status-rejected-bg text-status-rejected-fg',
  declined: 'bg-status-cancelled-bg text-status-cancelled-fg',
  withdrawn: 'bg-status-cancelled-bg text-status-cancelled-fg',
  removed: 'bg-status-cancelled-bg text-status-cancelled-fg',
  cancelled: 'bg-beige text-text-gray',
  overdue: 'bg-status-rejected-bg text-status-rejected-fg',
}

/* Internal review request statuses: Accepted is green, and Completed uses the maroon tint so the two differ. */
const requestStyles: Partial<Record<Decision, string>> = {
  accepted: 'bg-status-approved-bg text-status-approved-fg',
  completed: 'bg-status-published-bg text-status-published-fg',
}

/**
 * A reviewer's or approver's decision as a small pill; the label is always shown as text.
 * `request`: an internal review request's status, with its own colours for Accepted and Completed.
 */
export function DecisionBadge<D extends Decision>({ decision, labels, request = false }: { decision: D; labels: Record<D, string>; request?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-current/15 px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${(request && requestStyles[decision]) || styles[decision]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {labels[decision]}
    </span>
  )
}
