import type { ReactNode } from 'react'
import { internalReviewEn } from '../../content/internalReview.en'
import type { SopWorkflowContent } from '../../content/types'
import type { InternalReviewerAssignment, ReviewerAssignment, Sop } from '../../data/mock/types'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import { formatReviewDateTime as formatDateTime } from '../../lib/format'
import { isActiveRequest, requestDeadline } from '../../lib/internalReviewStatus'
import { WORKING_DAY_POLICY } from '../../lib/riyadhWorkingDays'
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
  const active = !inactive && isActiveRequest(sop, request)
  const deadline = requestDeadline(request)
  const now = useDeadlineClock(deadline?.dueAt, active && !!deadline)
  const remaining = deadline ? new Date(deadline.dueAt).getTime() - now : undefined
  const overdue = active && remaining !== undefined && remaining <= 0
  const duration = request.reviewDurationDays
  const workingDays = request.deadlinePolicy === WORKING_DAY_POLICY
  const durationText = duration === undefined ? text.noReviewDeadline : workingDays
    ? duration === 1 ? text.workingDurationOne : text.workingDurationDays.replace('{count}', String(duration))
    : duration === 1 ? text.durationOne : text.durationDays.replace('{count}', String(duration))
  return (
    <span className="flex w-full flex-col gap-0.5 text-xs text-text-gray">
      {showQueue && active && <span className="font-semibold text-maroon">{content.active}</span>}
      {!request.acceptedAt ? <>
        <span>{deadline ? dated(text.responseDue, deadline.dueAt) : text.noResponseDeadline}</span>
        <span>{durationText}</span>
        {active && remaining !== undefined && <span>{overdue ? text.expiredResponse : text.responseRemaining.replace('{duration}', formatReviewDuration(remaining))}</span>}
      </> : <>
        <span>{deadline ? dated(text.reviewDue, deadline.dueAt) : text.noReviewDeadline}</span>
        {active && remaining !== undefined && (
          <span className={overdue ? 'font-semibold text-status-rejected-fg' : ''}>
            {overdue ? text.reviewOverdue : text.remainingTime.replace('{duration}', formatReviewDuration(remaining))}
          </span>
        )}
      </>}
      {!active && <span>{text.inactiveDeadline}</span>}
    </span>
  )
}
