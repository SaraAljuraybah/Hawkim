import type { SopWorkflowContent } from '../../content/types'
import type { InternalReviewerAssignment, ReviewerAssignment, Sop } from '../../data/mock/types'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import { formatDateTime } from '../../lib/format'
import { isOpenDecision, latestAssignmentOf } from '../../lib/internalReviewStatus'
import { formatReviewDuration } from '../../lib/reviewDuration'
import { currentReviewer, reviewerAssignedMilliseconds, reviewerDueAt, reviewerRemainingMilliseconds } from '../../lib/workflow'

interface ReviewerDeadlineProps {
  sop: Sop
  reviewer: ReviewerAssignment | InternalReviewerAssignment
  content: SopWorkflowContent['reviewerDeadline']
  showQueue?: boolean
}

/** Original allocation and current deadline are intentionally independent. */
export function ReviewerDeadline({ sop, reviewer, content, showQueue = false }: ReviewerDeadlineProps) {
  const allocation = reviewerAssignedMilliseconds(sop, reviewer)
  const dueAt = reviewerDueAt(sop, reviewer)
  const round = !sop.reviewFlow ? sop.internalReviewRounds?.at(-1) : undefined
  const active = round
    ? sop.status === 'in-review' && round.status === 'open' && round.version === sop.version && isLatestOpen(latestAssignmentOf(round, reviewer.userId), reviewer)
    : currentReviewer(sop)?.userId === reviewer.userId
  const now = useDeadlineClock(dueAt, active)
  const remaining = reviewerRemainingMilliseconds(sop, reviewer, now)
  const overdue = active && remaining !== undefined && remaining <= 0
  return (
    <span className="flex w-full flex-col gap-0.5 text-xs text-text-gray">
      {showQueue && sop.status === 'in-review' && reviewer.decision === 'pending' && (
        <span className="font-semibold text-maroon">{round ? content.active : active ? content.current : content.waiting}</span>
      )}
      <span>{allocation === undefined
        ? dueAt ? content.allocationUnknown : content.noDeadline
        : content.assignedDuration.replace('{duration}', formatReviewDuration(allocation))}</span>
      {dueAt && <span>{content.due.split('{date}')[0]}<time dateTime={dueAt}>{formatDateTime(dueAt)}</time>{content.due.split('{date}')[1]}</span>}
      {active && remaining !== undefined && (
        <span className={overdue ? 'font-semibold text-status-rejected-fg' : ''}>
          {overdue ? content.overdue : content.remainingDuration.replace('{duration}', formatReviewDuration(remaining))}
        </span>
      )}
    </span>
  )
}

/** The reviewer's latest request is still open, and it's the one shown (when it has an id). */
function isLatestOpen(latest: InternalReviewerAssignment | undefined, reviewer: ReviewerAssignment | InternalReviewerAssignment): boolean {
  return !!latest && isOpenDecision(latest.decision) && (!('id' in reviewer) || latest.id === reviewer.id)
}
