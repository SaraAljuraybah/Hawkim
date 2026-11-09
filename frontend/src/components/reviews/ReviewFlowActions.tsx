import { useRef, useState } from 'react'
import { reviewFlowEn as text } from '../../content/reviewFlow.en'
import type { Sop } from '../../data/mock/types'
import { currentDepartmentReview, eligibleReviewers, qualityController, type ReviewAction } from '../../lib/reviewFlow'
import { useDepartments } from '../../state/departmentsContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { TextField } from '../ui/TextField'

interface Props { sop: Sop; onComplete: (message: string) => void }
/** Existing reviewers may decide or repeat a saved handoff; only Authors assign reviewers. */
export function ReviewFlowActions({ sop, onComplete }: Props) {
  const flow = sop.reviewFlow!
  const store = useSops()
  const { users } = useUsers()
  const { departments } = useDepartments()
  const [dialog, setDialog] = useState<'forward' | 'complete' | 'return-review' | 'return-author' | null>(null)
  const [forwardTarget, setForwardTarget] = useState<string>()
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const commentRef = useRef<HTMLTextAreaElement>(null)
  const stage = flow.stage
  const representative = stage.endsWith('representative')
  const forward = stage === 'reviewer-1' || representative
  const complete = stage === 'reviewer-2' || stage.endsWith('-reviewer')
  const decision = stage.endsWith('-decision')
  const departmentReview = currentDepartmentReview(sop)
  const departmentId = stage === 'reviewer-1' ? sop.departmentId : departmentReview?.departmentId ?? ''
  const retainedId = stage === 'reviewer-1' ? flow.reviewer2Id : departmentReview?.reviewerId
  // A saved plan alone must not create a new assignment. Only an existing, eligible
  // reviewer can receive a repeat handoff, with their original deadline unchanged.
  const retainedReviewer = retainedId && sop.reviewers.some((person) => person.userId === retainedId && person.decision !== 'cancelled')
    ? eligibleReviewers(sop, departmentId, users).find((person) => person.id === retainedId)
    : undefined
  const controller = qualityController(sop, { users, departments })
  const routingPending = decision || stage === 'quality-routing' || forward && !retainedReviewer
  function open(next: NonNullable<typeof dialog>, trigger: HTMLElement) {
    triggerRef.current = trigger
    setError(''); setComment(''); setForwardTarget(next === 'forward' ? retainedReviewer?.id : undefined); setDialog(next)
  }
  function close() {
    setDialog(null)
    requestAnimationFrame(() => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); else panelRef.current?.focus() })
  }
  function act(action: ReviewAction) {
    try { store.reviewAction(sop.id, action); setDialog(null); onComplete(text.updated) }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.selectRequired); return false }
  }
  function confirm() {
    if (dialog === 'forward') {
      if (!forward || !retainedReviewer || retainedReviewer.id !== forwardTarget) { setError(text.authorRoutingPending); return false }
      return act({ type: 'forward', reviewerId: retainedReviewer.id, text: comment })
    }
    if (dialog === 'complete') return act({ type: 'complete', text: comment })
    if (dialog === 'return-author' || dialog === 'return-review') {
      if (!comment.trim()) { setError(text.commentRequired); commentRef.current?.focus(); return false }
      return act({ type: dialog, text: comment })
    }
    return false
  }
  const title = dialog === 'forward' ? text.forward : dialog === 'complete' ? text.complete : dialog === 'return-review' ? text.returnReview : text.returnAuthor
  return (
    <div ref={panelRef} tabIndex={-1} className="space-y-4 focus:outline-none">
      {routingPending && <p role="status" className="text-sm text-text-gray">{text.authorRoutingPending}</p>}
      {stage === 'quality-routing' && <p role="status" className="text-sm text-maroon">{controller ? text.qualityAssigned + ': ' + controller.name : text.qualityMissing}</p>}
      {!dialog && error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {forward && retainedReviewer && <Button onClick={(event) => open('forward', event.currentTarget)}>{text.forward}</Button>}
        {complete && <Button onClick={(event) => open('complete', event.currentTarget)}>{text.complete}</Button>}
        {stage === 'reviewer-2' && <Button variant="secondary" onClick={(event) => open('return-review', event.currentTarget)}>{text.returnReview}</Button>}
        <Button variant="secondary" onClick={(event) => open('return-author', event.currentTarget)}>{text.returnAuthor}</Button>
      </div>
      {dialog && <FormDialog open title={title} description={dialog === 'return-review' ? text.returnReviewHelp : undefined}
        confirmLabel={text.confirm} cancelLabel={text.cancel} onConfirm={confirm} onClose={close}>
        {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
        {dialog === 'forward' && <>
          <TextField name="existingReviewer" label={representative ? text.assignedReviewer : text.reviewer2}
            value={users.find((person) => person.id === forwardTarget)?.name ?? ''} readOnly hint={text.savedHandoff} />
        </>}
        <TextAreaField ref={commentRef} name="reviewComment" rows={4} label={dialog.startsWith('return-') ? text.requiredComment : text.comment} maxLength={1000} value={comment} onChange={(event) => { setComment(event.target.value); setError('') }} />
      </FormDialog>}
    </div>
  )
}
