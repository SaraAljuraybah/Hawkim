import { useRef, useState } from 'react'
import { internalReviewEn as text } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { currentInternalRound, isInternalReviewPending } from '../../lib/internalReview'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { Button } from '../ui/Button'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'

export function InternalReviewActions({ sop, onComplete }: { sop: Sop; onComplete: (message: string) => void }) {
  const user = useCurrentUser()
  const store = useSops()
  const round = currentInternalRound(sop)
  const assignment = round?.assignments.find((person) => person.userId === user.id)
  // Capture the exact request when opening the dialog; a later round cannot receive a stale decision.
  const [target, setTarget] = useState<{ roundId: string; assignmentId: string; decision: 'completed' | 'returned' } | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const commentRef = useRef<HTMLTextAreaElement | null>(null)
  if (!round || !assignment || !isInternalReviewPending(sop, user.id) || !user.permissions.includes('reviewer') || user.permissions.includes('admin')) return null
  function close() { setTarget(null); requestAnimationFrame(() => triggerRef.current?.isConnected && triggerRef.current.focus()) }
  function open(decision: 'completed' | 'returned', trigger: HTMLButtonElement) {
    triggerRef.current = trigger; setComment(''); setError(''); setTarget({ roundId: round!.id, assignmentId: assignment!.id, decision })
  }
  function confirm() {
    if (!target) return false
    if (target.decision === 'returned' && !comment.trim()) { setError(text.actions.requiredReason); commentRef.current?.focus(); return false }
    try { store.decideInternalReview(sop.id, target.roundId, target.assignmentId, target.decision, comment); setTarget(null); onComplete(text.actions.updated) }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.status.closed); return false }
  }
  function begin() {
    try { store.beginInternalReview(sop.id, round!.id, assignment!.id); onComplete(text.actions.updated) }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.status.closed) }
  }
  return <div className="space-y-3">
    {error && !target && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
    {assignment.startedAt && <p className="text-sm text-maroon">{text.actions.inProgress}</p>}
    <div className="flex flex-wrap gap-3">
      {!assignment.startedAt && <Button variant="secondary" onClick={begin}>{text.actions.start}</Button>}
      <Button onClick={(event) => open('completed', event.currentTarget)}>{text.actions.complete}</Button>
      <Button variant="secondary" onClick={(event) => open('returned', event.currentTarget)}>{text.actions.reject}</Button>
    </div>
    {target && <FormDialog open title={target.decision === 'returned' ? text.actions.reject : text.actions.complete}
      confirmLabel={text.actions.confirm} cancelLabel={text.actions.cancel} onConfirm={confirm} onClose={close}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <TextAreaField ref={commentRef} name="internalReviewFeedback" label={target.decision === 'returned' ? text.actions.rejectionReason : text.actions.comment}
        required={target.decision === 'returned'} rows={4} maxLength={1000} value={comment} onChange={(event) => { setComment(event.target.value); setError('') }} />
    </FormDialog>}
  </div>
}
