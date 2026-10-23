import { internalReviewEn as text } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import { formatDateTime } from '../../lib/format'
import { formatReviewDuration } from '../../lib/reviewDuration'
import { dueAtOfDate, reviewAssignedMilliseconds, reviewRemainingMilliseconds } from '../../lib/workflow'

/** New requests share one deadline; historical request and task dates stay intact. */
export function InternalReviewSummary({ sop }: { sop: Sop }) {
  const round = sop.internalReviewRounds?.at(-1)
  const dueAt = round?.dueDate ? dueAtOfDate(round.dueDate) : undefined
  const open = sop.status === 'in-review' && round?.status === 'open' && round.version === sop.version
  const now = useDeadlineClock(dueAt, open)
  if (!round) return null
  const remaining = reviewRemainingMilliseconds(sop, now)
  const allocation = reviewAssignedMilliseconds(sop)
  return <div className="mt-4 space-y-1 border-t border-beige pt-4 text-sm text-maroon">
    <p className="font-semibold">{round.status === 'completed' && sop.status !== 'in-review' ? text.panel.decisions.completed : text.panel.states[round.status]}</p>
    <p>{text.panel.requestDeadline}</p>
    <p className="text-xs text-text-gray">{allocation === undefined ? text.panel.noDeadline : text.panel.timeGiven.replace('{duration}', formatReviewDuration(allocation))}</p>
    {dueAt && <p className="text-xs text-text-gray">{text.panel.due.split('{date}')[0]}<time dateTime={dueAt}>{formatDateTime(dueAt)}</time></p>}
    {open && remaining !== undefined && (remaining <= 0
      ? <p className="text-xs font-semibold text-status-rejected-fg">{text.panel.overdue}</p>
      : <p className="text-xs text-text-gray">{text.panel.remainingTime.replace('{duration}', formatReviewDuration(remaining))}</p>)}
    {sop.status === 'in-review' && round.status === 'completed' && <p>{text.status.awaitingAuthor}</p>}
  </div>
}
