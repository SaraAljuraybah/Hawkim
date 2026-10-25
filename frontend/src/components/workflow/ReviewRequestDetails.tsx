import { internalReviewEn as text } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { InternalReviewerAssignment, Sop } from '../../data/mock/types'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import { formatDate, formatDateTime } from '../../lib/format'
import { endOfLocalDay, isActiveRequest } from '../../lib/internalReviewStatus'
import { DecisionBadge } from './DecisionBadge'
import { ReviewerDeadline } from './ReviewerDeadline'

/** The request's status; an accepted request past its review due date shows as Overdue (nothing else changes). */
export function RequestStatusBadge({ sop, request }: { sop: Sop; request: InternalReviewerAssignment }) {
  const active = isActiveRequest(sop, request) && request.decision === 'accepted'
  const reviewDueAt = request.reviewDueDate ? endOfLocalDay(request.reviewDueDate) : undefined
  const now = useDeadlineClock(reviewDueAt, active && !!reviewDueAt)
  const overdue = active && !!reviewDueAt && new Date(reviewDueAt).getTime() <= now
  return <DecisionBadge decision={overdue ? 'overdue' : request.decision} labels={text.panel.decisions} />
}

/**
 * One review request: when it was sent, its version, its deadlines (response due date and review
 * duration before acceptance; review due date and time remaining after), and any reason or comments.
 * `compact` (the author's SOP page) shows only the version and deadlines; when it was sent, accepted
 * and decided, and the decision comment, stay in the Review timeline.
 */
export function ReviewRequestDetails({ sop, request, compact = false }: { sop: Sop; request: InternalReviewerAssignment; compact?: boolean }) {
  const version = sop.internalReviewRounds?.find((round) => round.assignments.includes(request))?.version
  const comment = compact ? undefined : sop.comments.find((item) => item.id === request.commentId)
  const line = 'text-xs text-text-gray'
  const quote = 'text-sm whitespace-pre-wrap break-words text-maroon'
  return <div className="mt-1 space-y-1">
    {compact ? version && <p className={line}>{text.panel.version.replace('{version}', version)}</p> : <p className={line}>
      {text.panel.sent.split('{date}')[0]}<time dateTime={request.assignedAt}>{formatDateTime(request.assignedAt)}</time>
      {version && <><span aria-hidden="true"> · </span><span className="sr-only">, </span>{text.panel.version.replace('{version}', version)}</>}
    </p>}
    <ReviewerDeadline sop={sop} reviewer={request} content={sopWorkflowEn.reviewerDeadline} />
    {!compact && request.acceptedAt && <p className={line}>{text.panel.accepted.replace('{date}', formatDateTime(request.acceptedAt))}</p>}
    {request.withdrawnAt && request.responseDueDate && <p className={line}>{text.panel.withdrawn.replace('{date}', formatDate(request.responseDueDate))}</p>}
    {request.declineReason && <>
      {request.decidedAt && <p className={line}>{text.panel.declined.replace('{date}', formatDateTime(request.decidedAt))}</p>}
      <p className={quote}>{text.panel.declineReason.replace('{reason}', request.declineReason)}</p>
    </>}
    {!compact && !request.declineReason && request.decidedAt && <p className={line}>{text.panel.decided.replace('{date}', formatDateTime(request.decidedAt))}</p>}
    {comment && <p className={quote}>{comment.text}</p>}
    {request.removedAt && <p className={quote}>{text.panel.removedLine.replace('{date}', formatDateTime(request.removedAt)).replace('{reason}', request.removalReason ?? '')}</p>}
  </div>
}
