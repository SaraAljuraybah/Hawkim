import { internalReviewEn as text } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { formatDateTime } from '../../lib/format'
import { daysFromToday, isOverdue } from '../../lib/workflow'

/** Overall request timing is independent of the individual reviewer task dates. */
export function InternalReviewSummary({ sop }: { sop: Sop }) {
  const round = sop.internalReviewRounds?.at(-1)
  if (!round) return null
  const remaining = round.dueDate ? daysFromToday(round.dueDate) : undefined
  const dueAt = round.dueDate ? new Date(round.dueDate + 'T23:59:59.999').toISOString() : undefined
  const open = sop.status === 'in-review' && round.status === 'open'
  return <div className="mt-4 space-y-1 border-t border-beige pt-4 text-sm text-maroon">
    <p className="font-semibold">{round.status === 'completed' && sop.status !== 'in-review' ? text.panel.decisions.completed : text.panel.states[round.status]}</p>
    <p>{text.panel.requestDeadline}</p>
    <p className="text-xs text-text-gray">{round.assignedDueDays === null ? text.panel.noDeadline : round.assignedDueDays === 1 ? text.panel.oneDay : text.panel.days.replace('{count}', String(round.assignedDueDays))}</p>
    {dueAt && <p className="text-xs text-text-gray">{text.panel.due.split('{date}')[0]}<time dateTime={dueAt}>{formatDateTime(dueAt)}</time></p>}
    {open && remaining !== undefined && <p className="text-xs text-text-gray">{remaining === 1 ? text.panel.remainingOne : text.panel.remaining.replace('{count}', String(remaining))}</p>}
    {open && isOverdue(sop, 'review') && <p className="text-xs font-semibold text-status-rejected-fg">{text.panel.overdue}</p>}
    {sop.status === 'in-review' && round.status === 'completed' && <p>{text.status.awaitingAuthor}</p>}
  </div>
}
