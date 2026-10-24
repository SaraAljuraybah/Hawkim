import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { internalReviewEn as text } from '../../content/internalReview.en'
import type { InternalReviewerAssignment, Sop } from '../../data/mock/types'
import { REVIEW_TEXT_MAX } from '../../lib/internalReview'
import { latestAssignmentOf } from '../../lib/internalReviewStatus'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { RequestStatusBadge, ReviewRequestDetails } from './ReviewRequestDetails'

interface Props { sop: Sop; canRemove: boolean }

/**
 * Every review request, grouped by reviewer (newest request first): its status, when it was sent,
 * its version, its deadlines, and any reason or comments. The main author can remove a reviewer
 * from the current version's review.
 */
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
  const current = rounds.at(-1)!
  const removable = canRemove && sop.status === 'in-review' && current.version === sop.version
  // Reviewers in the order they were first asked; each one's requests newest first.
  const requests = rounds.flatMap((round) => round.assignments.map((assignment) => ({ round, assignment })))
  const reviewerIds = [...new Set(requests.map((item) => item.assignment.userId))]
  function close() { setTarget(null); requestAnimationFrame(() => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); else statusRef.current?.focus() }) }
  function remove() {
    if (!target) return false
    if (!reason.trim()) { flushSync(() => setReasonError(text.panel.removeRequired)); reasonRef.current?.focus(); return false }
    try { store.removeInternalReviewer(sop.id, target.roundId, target.assignment.id, reason); setMessage(text.panel.removed.replace('{name}', nameOf(target.assignment.userId))) }
    catch (failure) { setError(failure instanceof Error ? failure.message : text.status.closed); return false }
  }
  return <Card title={text.panel.title} titleId="internal-review-title" className="mt-6">
    <div role="status" ref={statusRef} tabIndex={-1} className="rounded-sm text-sm text-maroon">{message}</div>
    <ul className="space-y-4">{reviewerIds.map((userId) => {
      const own = requests.filter((item) => item.assignment.userId === userId).reverse()
      const latest = latestAssignmentOf(current, userId)
      const name = nameOf(userId)
      return <li key={userId} className="rounded-lg border border-beige p-4">
        <h3 className="text-base font-semibold text-maroon">{name}</h3>
        <ul aria-label={text.panel.reviewerHistory.replace('{name}', name)} className="mt-2 space-y-3">{own.map(({ round, assignment }) =>
          <li key={assignment.id} className="border-t border-beige pt-3 first:border-0 first:pt-0">
            <RequestStatusBadge sop={sop} request={assignment} />
            <ReviewRequestDetails sop={sop} request={assignment} />
            {removable && round === current && assignment === latest && assignment.decision !== 'removed' &&
              <Button size="sm" variant="secondary" className="mt-2" aria-label={text.panel.removeFor.replace('{name}', name)}
                onClick={(event) => { triggerRef.current = event.currentTarget; setTarget({ roundId: round.id, assignment }); setReason(''); setReasonError(''); setError('') }}>{text.panel.remove}</Button>}
          </li>)}</ul>
      </li>
    })}</ul>
    {target && <FormDialog open title={text.panel.removeTitle.replace('{name}', nameOf(target.assignment.userId))}
      description={text.panel.removeHelp} confirmLabel={text.panel.remove} cancelLabel={text.panel.removeKeep} onConfirm={remove} onClose={close}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <TextAreaField ref={reasonRef} name="removalReason" label={text.panel.removeReason} required rows={4} maxLength={REVIEW_TEXT_MAX}
        error={reasonError || undefined} value={reason} onChange={(event) => { setReason(event.target.value); setReasonError(''); setError('') }} />
    </FormDialog>}
  </Card>
}
