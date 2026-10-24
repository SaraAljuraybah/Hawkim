import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { internalReviewEn as text } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { InternalReviewerAssignment, Sop } from '../../data/mock/types'
import { formatDate, formatDateTime } from '../../lib/format'
import { REVIEW_TEXT_MAX } from '../../lib/internalReview'
import { latestAssignmentOf } from '../../lib/internalReviewStatus'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { DecisionBadge } from './DecisionBadge'
import { ReviewerDeadline } from './ReviewerDeadline'

interface Props { sop: Sop; canRemove: boolean }
/** Every request stays visible in its version's round; the main author can remove a reviewer from the current one. */
export function InternalReviewPanel({ sop, canRemove }: Props) {
  const { nameOf } = useUsers()
  const store = useSops()
  const [target, setTarget] = useState<{ roundId: string; assignment: InternalReviewerAssignment } | null>(null)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const statusRef = useRef<HTMLDivElement | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)
  const rounds = sop.internalReviewRounds ?? []
  if (!rounds.length) return null
  function close() { setTarget(null); requestAnimationFrame(() => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); else statusRef.current?.focus() }) }
  function remove() {
    if (!target) return false
    if (!reason.trim()) { flushSync(() => setReasonError(text.panel.removeRequired)); reasonRef.current?.focus(); return false }
    try { store.removeInternalReviewer(sop.id, target.roundId, target.assignment.id, reason); setMessage(text.panel.removed.replace('{name}', nameOf(target.assignment.userId))) }
    catch (failure) { setError(failure instanceof Error ? failure.message : text.status.closed); return false }
  }
  return <Card title={text.panel.title} titleId="internal-review-title" className="mt-6">
    <div role="status" ref={statusRef} tabIndex={-1} className="rounded-sm text-sm text-maroon">{message}</div>
    <ol className="space-y-5">{rounds.map((round, index) => {
      const latest = index === rounds.length - 1
      const removable = canRemove && latest && sop.status === 'in-review' && round.version === sop.version
      return <li key={round.id} className="rounded-lg border border-beige p-4">
        <h3 className="text-base font-semibold text-maroon">{text.panel.round.replace('{number}', String(index + 1)).replace('{version}', round.version)}</h3>
        <p className="mt-1 text-sm text-maroon">{round.status === 'completed' && (!latest || round.version !== sop.version || sop.status !== 'in-review') ? text.panel.decisions.completed : text.panel.states[round.status]}</p>
        <p className="mt-1 text-xs text-text-gray">{text.panel.requested.replace('{date}', formatDateTime(round.requestedAt))}</p>
        <ul className="mt-4 space-y-4">{round.assignments.map((assignment) => {
          const comment = sop.comments.find((item) => item.id === assignment.commentId)
          return <li key={assignment.id} className="border-t border-beige pt-3 first:border-0 first:pt-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-maroon">{nameOf(assignment.userId)}</span>
              <DecisionBadge decision={assignment.decision} labels={text.panel.decisions} />
            </div>
            <ReviewerDeadline sop={sop} reviewer={assignment} content={sopWorkflowEn.reviewerDeadline} />
            {assignment.acceptedAt && <p className="mt-1 text-xs text-text-gray">{text.panel.accepted.replace('{date}', formatDateTime(assignment.acceptedAt))}</p>}
            {assignment.withdrawnAt && assignment.responseDueDate && <p className="mt-1 text-xs text-text-gray">{text.panel.withdrawn.replace('{date}', formatDate(assignment.responseDueDate))}</p>}
            {assignment.declineReason && <p className="mt-2 text-sm whitespace-pre-wrap break-words text-maroon">{text.panel.declineReason.replace('{reason}', assignment.declineReason)}</p>}
            {assignment.decidedAt && <p className="mt-1 text-xs text-text-gray">{text.panel.decided.replace('{date}', formatDateTime(assignment.decidedAt))}</p>}
            {comment && <p className="mt-2 text-sm whitespace-pre-wrap break-words text-maroon">{comment.text}</p>}
            {assignment.removedAt && <p className="mt-2 text-sm whitespace-pre-wrap break-words text-maroon">{text.panel.removedLine.replace('{date}', formatDateTime(assignment.removedAt)).replace('{reason}', assignment.removalReason ?? '')}</p>}
            {assignment.cancellationReason && <p className="mt-2 text-sm text-text-gray">{text.panel.cancellationReasons[assignment.cancellationReason]}</p>}
            {removable && assignment.decision !== 'removed' && latestAssignmentOf(round, assignment.userId) === assignment &&
              <Button size="sm" variant="secondary" className="mt-2" aria-label={text.panel.removeFor.replace('{name}', nameOf(assignment.userId))}
                onClick={(event) => { triggerRef.current = event.currentTarget; setTarget({ roundId: round.id, assignment }); setReason(''); setReasonError(''); setError('') }}>{text.panel.remove}</Button>}
          </li>
        })}</ul>
      </li>
    })}</ol>
    {target && <FormDialog open title={text.panel.removeTitle.replace('{name}', nameOf(target.assignment.userId))}
      description={text.panel.removeHelp} confirmLabel={text.panel.remove} cancelLabel={text.panel.removeKeep} onConfirm={remove} onClose={close}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <TextAreaField ref={reasonRef} name="removalReason" label={text.panel.removeReason} required rows={4} maxLength={REVIEW_TEXT_MAX}
        error={reasonError || undefined} value={reason} onChange={(event) => { setReason(event.target.value); setReasonError(''); setError('') }} />
    </FormDialog>}
  </Card>
}
