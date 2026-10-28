import type { ReactNode } from 'react'
import { internalReviewEn } from '../../content/internalReview.en'
import type { SopWorkflowContent } from '../../content/types'
import type { InternalReviewerAssignment, ReviewerAssignment, Sop } from '../../data/mock/types'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import { formatDateTime } from '../../lib/format'
import { endOfLocalDay, isOpenDecision, latestAssignmentOf } from '../../lib/internalReviewStatus'
import { formatReviewDuration } from '../../lib/reviewDuration'
import { currentReviewer, reviewerAssignedMilliseconds, reviewerDueAt, reviewerRemainingMilliseconds } from '../../lib/workflow'

interface ReviewerDeadlineProps {
  sop: Sop
  reviewer: ReviewerAssignment | InternalReviewerAssignment
  content: SopWorkflowContent['reviewerDeadline']
  showQueue?: boolean
  /** A historical task can project an older SOP version; its clocks must remain stopped. */
  inactive?: boolean
}

/** Original allocation and current deadline are intentionally independent. */
export function ReviewerDeadline(props: ReviewerDeadlineProps) {
  const { sop, reviewer } = props
  const request = !sop.reviewFlow && 'id' in reviewer
    ? sop.internalReviewRounds?.flatMap((round) => round.assignments).find((assignment) => assignment.id === reviewer.id)
    : undefined
  return request ? <RequestDeadline {...props} request={request} /> : <LegacyDeadline {...props} />
}

function LegacyDeadline({ sop, reviewer, content, showQueue = false, inactive = false }: ReviewerDeadlineProps) {
  const allocation = reviewerAssignedMilliseconds(sop, reviewer)
  const dueAt = reviewerDueAt(sop, reviewer)
  const active = !inactive && currentReviewer(sop)?.userId === reviewer.userId
  const now = useDeadlineClock(dueAt, active)
  const remaining = reviewerRemainingMilliseconds(sop, reviewer, now)
  const overdue = active && remaining !== undefined && remaining <= 0
  return (
    <span className="flex w-full flex-col gap-0.5 text-xs text-text-gray">
      {showQueue && sop.status === 'in-review' && reviewer.decision === 'pending' && (
        <span className="font-semibold text-maroon">{active ? content.current : content.waiting}</span>
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

/** "Due {date}"-style template with a machine-readable time. */
function dated(template: string, dueAt: string): ReactNode {
  const [before, after] = template.split('{date}')
  return <>{before}<time dateTime={dueAt}>{formatDateTime(dueAt)}</time>{after}</>
}

/**
 * An internal review request: before acceptance its response due date and review duration
 * ("starts when accepted"); after acceptance its review due date and the time remaining.
 */
function RequestDeadline({ sop, content, showQueue = false, inactive = false, request }: ReviewerDeadlineProps & { request: InternalReviewerAssignment }) {
  const text = internalReviewEn.panel
  const round = sop.internalReviewRounds?.find((item) => item.assignments.includes(request))
  const active = !inactive && sop.status === 'in-review' && !!round && round === sop.internalReviewRounds?.at(-1) && round.status === 'open' &&
    round.version === sop.version && latestAssignmentOf(round, request.userId) === request && isOpenDecision(request.decision)
  const reviewDueAt = request.reviewDueDate ? endOfLocalDay(request.reviewDueDate) : undefined
  const now = useDeadlineClock(request.acceptedAt ? reviewDueAt : undefined, active && !!request.acceptedAt)
  const remaining = reviewDueAt ? new Date(reviewDueAt).getTime() - now : undefined
  const overdue = active && remaining !== undefined && remaining <= 0
  const duration = request.reviewDurationDays
  // A request that ended before acceptance (declined, withdrawn or removed) has no deadline left to show.
  if (!active && !request.acceptedAt) return null
  return (
    <span className="flex w-full flex-col gap-0.5 text-xs text-text-gray">
      {showQueue && active && <span className="font-semibold text-maroon">{content.active}</span>}
      {!request.acceptedAt ? <>
        <span>{request.responseDueDate ? dated(text.responseDue, endOfLocalDay(request.responseDueDate)) : text.noResponseDeadline}</span>
        <span>{duration === undefined ? text.noReviewDeadline : duration === 1 ? text.durationOne : text.durationDays.replace('{count}', String(duration))}</span>
      </> : <>
        <span>{reviewDueAt ? dated(text.reviewDue, reviewDueAt) : text.noReviewDeadline}</span>
        {active && remaining !== undefined && (
          <span className={overdue ? 'font-semibold text-status-rejected-fg' : ''}>
            {overdue ? text.reviewOverdue : text.remainingTime.replace('{duration}', formatReviewDuration(remaining))}
          </span>
        )}
      </>}
    </span>
  )
}
