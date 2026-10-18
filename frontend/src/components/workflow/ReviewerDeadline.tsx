import type { SopWorkflowContent } from '../../content/types'
import type { ReviewerAssignment, Sop } from '../../data/mock/types'
import { formatDateTime } from '../../lib/format'
import { currentReviewer, isOverdue, reviewerAssignedDays, reviewerDueAt, reviewerRemainingDays } from '../../lib/workflow'

interface ReviewerDeadlineProps {
  sop: Sop
  reviewer: ReviewerAssignment
  content: SopWorkflowContent['reviewerDeadline']
  showQueue?: boolean
}

/** Original allocation and current deadline are intentionally independent. */
export function ReviewerDeadline({ sop, reviewer, content, showQueue = false }: ReviewerDeadlineProps) {
  const days = reviewerAssignedDays(sop, reviewer)
  const dueAt = reviewerDueAt(sop, reviewer)
  const active = currentReviewer(sop)?.userId === reviewer.userId
  const remaining = reviewerRemainingDays(sop, reviewer)
  const overdue = active && isOverdue(sop, 'review')
  return (
    <span className="flex w-full flex-col gap-0.5 text-xs text-text-gray">
      {showQueue && sop.status === 'in-review' && reviewer.decision === 'pending' && (
        <span className="font-semibold text-maroon">{active ? content.current : content.waiting}</span>
      )}
      <span>{days === undefined
        ? dueAt ? content.allocationUnknown : content.noDeadline
        : days === 1 ? content.assignedOneDay : content.assignedDays.replace('{count}', String(days))}</span>
      {dueAt && <span>{content.due.split('{date}')[0]}<time dateTime={dueAt}>{formatDateTime(dueAt)}</time>{content.due.split('{date}')[1]}</span>}
      {active && remaining !== undefined && (
        <span className={overdue ? 'font-semibold text-status-rejected-fg' : ''}>
          {overdue ? content.overdue : remaining <= 0 ? content.dueToday : remaining === 1
            ? content.remainingOneDay : content.remainingDays.replace('{count}', String(remaining))}
        </span>
      )}
    </span>
  )
}
