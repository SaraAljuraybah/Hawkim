import { useRef, useState } from 'react'
import { internalReviewEn as text } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { currentInternalRound, isInternalReviewPending, REVIEW_TEXT_MAX } from '../../lib/internalReview'
import { latestAssignmentOf } from '../../lib/internalReviewStatus'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { Button } from '../ui/Button'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'

type Target = { roundId: string; assignmentId: string; decision: 'completed' | 'returned' | 'declined' }

/** A pending request is accepted or declined first; only an accepted one can be completed or returned. */
export function InternalReviewActions({ sop, onComplete }: { sop: Sop; onComplete: (message: string) => void }) {
  const user = useCurrentUser()
  const store = useSops()
  const round = currentInternalRound(sop)
  const assignment = latestAssignmentOf(round, user.id)
  // Capture the exact request when opening the dialog; a later round cannot receive a stale decision.
  const [target, setTarget] = useState<Target | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [accepting, setAccepting] = useState(false)
  const acceptingRef = useRef(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const commentRef = useRef<HTMLTextAreaElement | null>(null)
  if (!round || !assignment || !isInternalReviewPending(sop, user.id) || !user.permissions.includes('reviewer') || user.permissions.includes('admin')) return null
  function close() { setTarget(null); requestAnimationFrame(() => triggerRef.current?.isConnected && triggerRef.current.focus()) }
  function open(decision: Target['decision'], trigger: HTMLButtonElement) {
    triggerRef.current = trigger; setComment(''); setError(''); setFieldError(''); setTarget({ roundId: round!.id, assignmentId: assignment!.id, decision })
  }
  async function confirm() {
    if (!target) return false
    const required = target.decision === 'returned' ? text.actions.returnRequired : target.decision === 'declined' ? text.actions.declineRequired : ''
    if (required && !comment.trim()) { setFieldError(required); commentRef.current?.focus(); return false }
    try {
      if (target.decision === 'declined') await store.declineInternalReview(sop.id, target.roundId, target.assignmentId, comment)
      else await store.decideInternalReview(sop.id, target.roundId, target.assignmentId, target.decision, comment)
      setTarget(null)
      onComplete(target.decision === 'declined' ? text.actions.declined : target.decision === 'returned' ? text.actions.returned : text.actions.reviewCompleted)
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.status.closed); return false }
  }
  async function accept() {
    if (acceptingRef.current) return
    acceptingRef.current = true
    setAccepting(true)
    try { await store.acceptInternalReview(sop.id, round!.id, assignment!.id); onComplete(text.actions.accepted) }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.status.closed) }
    finally { acceptingRef.current = false; setAccepting(false) }
  }
  const pending = assignment.decision === 'pending'
  // Decline and Return need a reason or comments; Complete takes optional comments.
  const dialog = !target ? undefined : target.decision === 'declined'
    ? { title: text.actions.declineTitle, description: text.actions.declineHelp, label: text.actions.declineReason, confirm: text.actions.decline }
    : target.decision === 'returned'
      ? { title: text.actions.returnToAuthor, description: text.actions.returnHelp, label: text.actions.returnComments, confirm: text.actions.returnToAuthor }
      : { title: text.actions.complete, description: text.actions.completeHelp.replace('{version}', sop.version), label: text.actions.comment, confirm: text.actions.complete }
  return <div className="space-y-3">
    {error && !target && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
    {pending ? <>
      <p className="text-sm text-text-gray">{text.actions.acceptFirst}</p>
      <div className="flex flex-wrap gap-3">
        <Button onClick={accept} disabled={accepting} aria-busy={accepting || undefined}>{text.actions.accept}</Button>
        <Button variant="secondary" disabled={accepting} onClick={(event) => open('declined', event.currentTarget)}>{text.actions.decline}</Button>
      </div>
    </> : <div className="flex flex-wrap gap-3">
      <Button onClick={(event) => open('completed', event.currentTarget)}>{text.actions.complete}</Button>
      <Button variant="secondary" onClick={(event) => open('returned', event.currentTarget)}>{text.actions.returnToAuthor}</Button>
    </div>}
    {target && dialog && <FormDialog open title={dialog.title} description={dialog.description}
      confirmLabel={dialog.confirm} cancelLabel={text.actions.cancel} onConfirm={confirm} onClose={close}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <TextAreaField ref={commentRef} name="internalReviewFeedback" label={dialog.label}
        required={target.decision !== 'completed'} error={fieldError || undefined} rows={4} maxLength={REVIEW_TEXT_MAX} value={comment} onChange={(event) => { setComment(event.target.value); setError(''); setFieldError('') }} />
    </FormDialog>}
  </div>
}
