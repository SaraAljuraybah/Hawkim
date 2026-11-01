import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { internalReviewEn as text } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { InternalReviewerAssignment, InternalReviewRound, Sop } from '../../data/mock/types'
import { canChangeReviewDeadline, canResendRequest, REVIEW_TEXT_MAX } from '../../lib/internalReview'
import { isInactiveDecision, latestAssignmentOf, RequestNotResendableError } from '../../lib/internalReviewStatus'
import { fixedResponseDueDate } from '../../lib/fixedResponseDeadline'
import { formatDate } from '../../lib/format'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { RequestStatusBadge, ReviewRequestDetails } from './ReviewRequestDetails'
import { ReviewRequestsTable, type ReviewRequestResponse } from './ReviewRequestsTable'
import { DecisionBadge } from './DecisionBadge'
import { ReviewDeadlineDialog } from './ReviewDeadlineDialog'
import { ReviewerDeadline } from './ReviewerDeadline'

interface Props {
  sop: Sop
  canRemove: boolean
  inactive?: boolean
  /** Every request in a table per version (the author's SOP page), instead of the cards per reviewer. */
  table?: boolean
  /** Responding from the table's comments dialog. */
  response?: ReviewRequestResponse
  /** Keep the author's initial review controls available before there are requests. */
  showEmpty?: boolean
  /** Box heading (also the section's accessible name). */
  title?: string
  actions?: ReactNode
  children?: ReactNode
}

const TITLE_ID = 'internal-review-title'

/**
 * Every review request, grouped by reviewer (newest request first): its status, when it was sent,
 * its version, its deadlines, and any reason or comments. The main author can remove a reviewer
 * from the current version's review.
 */
export function InternalReviewPanel({ sop, canRemove, inactive = false, table = false, response, showEmpty = false, title = text.panel.title, actions, children }: Props) {
  const { nameOf } = useUsers()
  const store = useSops()
  const [target, setTarget] = useState<{ roundId: string; assignment: InternalReviewerAssignment } | null>(null)
  const [editing, setEditing] = useState<{ roundId: string; assignment: InternalReviewerAssignment } | null>(null)
  const [resending, setResending] = useState<InternalReviewerAssignment | null>(null)
  const [resendError, setResendError] = useState('')
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const reasonRef = useRef<HTMLTextAreaElement | null>(null)
  const rounds = sop.internalReviewRounds ?? []
  if (!rounds.length && !showEmpty) return null
  const current = rounds.at(-1)
  const legacyReviewers = rounds.length ? [] : sop.reviewers
  const removable = !inactive && canRemove && sop.status === 'in-review' && current?.version === sop.version
  // Reviewers in the order they were first asked; each one's requests newest first.
  const requests = rounds.flatMap((round) => round.assignments.map((assignment) => ({ round, assignment })))
  const requestsOf = (userId: string) => requests.filter((item) => item.assignment.userId === userId)
  const reviewerIds = [...new Set(requests.map((item) => item.assignment.userId))]
  function askToRemove(round: InternalReviewRound, assignment: InternalReviewerAssignment, trigger: HTMLButtonElement) {
    triggerRef.current = trigger
    setTarget({ roundId: round.id, assignment })
    setReason('')
    setReasonError('')
    setError('')
  }
  function closeEditing() {
    setEditing(null)
    requestAnimationFrame(() => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); else document.getElementById(TITLE_ID)?.focus() })
  }
  function closeResending() {
    setResending(null)
    setResendError('')
    // The button is gone after sending: focus moves to the panel heading instead.
    requestAnimationFrame(() => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); else document.getElementById(TITLE_ID)?.focus() })
  }
  async function resend() {
    if (!resending) return false
    try {
      await store.resendInternalReview(sop.id, resending.id)
      setMessage(text.panel.sendAgain.sent.replace('{name}', nameOf(resending.userId)))
    } catch (failure) {
      setResendError(failure instanceof RequestNotResendableError ? text.panel.sendAgain.unavailable : text.panel.sendAgain.failed)
      return false
    }
  }
  const isLatestRequest = (round: InternalReviewRound, assignment: InternalReviewerAssignment) => round === current && assignment === latestAssignmentOf(current, assignment.userId)
  // After a removal the Remove button may be gone: focus moves to the panel heading instead.
  function close() { setTarget(null); requestAnimationFrame(() => { if (triggerRef.current?.isConnected) triggerRef.current.focus(); else document.getElementById(TITLE_ID)?.focus() }) }
  async function remove() {
    if (!target) return false
    if (!reason.trim()) { flushSync(() => setReasonError(text.panel.removeRequired)); reasonRef.current?.focus(); return false }
    try { await store.removeInternalReviewer(sop.id, target.roundId, target.assignment.id, reason); setMessage(text.panel.removed.replace('{name}', nameOf(target.assignment.userId))) }
    catch (failure) { setError(failure instanceof Error ? failure.message : text.status.closed); return false }
  }
  return <Card title={title} titleId={TITLE_ID} focusableTitle actions={actions} className="mt-6">
    {children}
    {/* Announced to screen readers only; the list itself shows the change. */}
    <div role="status" className="sr-only">{message}</div>
    {!reviewerIds.length && !legacyReviewers.length && <p className="text-sm text-text-gray">{text.panel.noActive}</p>}
    {legacyReviewers.length > 0 && <ul className="space-y-4">{legacyReviewers.map((reviewer) => <li key={reviewer.userId} className="rounded-lg border border-beige p-4">
      <h3 className="mb-2 text-base font-semibold text-maroon">{nameOf(reviewer.userId)}</h3>
      <DecisionBadge decision={reviewer.decision} labels={sopWorkflowEn.people.decisions} />
      <ReviewerDeadline sop={sop} reviewer={reviewer} content={sopWorkflowEn.reviewerDeadline} showQueue inactive={inactive} />
    </li>)}</ul>}
    {table && requests.length > 0 && <ReviewRequestsTable sop={sop} response={response} onRemove={askToRemove}
      canRemove={(round, assignment) => removable && isLatestRequest(round, assignment) && (assignment.decision === 'expired' || !isInactiveDecision(assignment.decision))}
      canEditDeadline={(round, assignment) => canRemove && canChangeReviewDeadline(sop, round, assignment)}
      onEditDeadline={(round, assignment, trigger) => { triggerRef.current = trigger; setEditing({ roundId: round.id, assignment }) }}
      canResend={(round, assignment) => !inactive && canRemove && canResendRequest(sop, round, assignment)}
      onResend={(_, assignment, trigger) => { triggerRef.current = trigger; setResendError(''); setResending(assignment) }} />}
    {!table && reviewerIds.length > 0 && <ul className="space-y-4">{reviewerIds.map((userId) => {
      const own = requestsOf(userId).reverse()
      const name = nameOf(userId)
      return <li key={userId} className="rounded-lg border border-beige p-4">
        <h3 className="text-base font-semibold text-maroon">{name}</h3>
        <ul aria-label={text.panel.reviewerHistory.replace('{name}', name)} className="mt-2 space-y-3">{own.map(({ round, assignment }) =>
          <li key={assignment.id} className="border-t border-beige pt-3 first:border-0 first:pt-0">
            <RequestStatusBadge sop={sop} request={assignment} inactive={inactive} />
            <ReviewRequestDetails sop={sop} request={assignment} inactive={inactive} />
            {removable && isLatestRequest(round, assignment) && assignment.decision !== 'removed' &&
              <Button size="sm" variant="secondary" className="mt-2" aria-label={text.panel.removeFor.replace('{name}', name)}
                onClick={(event) => askToRemove(round, assignment, event.currentTarget)}>{text.panel.remove}</Button>}
          </li>)}</ul>
      </li>
    })}</ul>}
    {editing && <ReviewDeadlineDialog request={editing.assignment} name={nameOf(editing.assignment.userId)} onClose={closeEditing}
      onSubmit={async (days) => {
        await store.changeReviewDeadline(sop.id, editing.roundId, editing.assignment.id, days)
        setMessage(text.panel.deadline.changed.replace('{name}', nameOf(editing.assignment.userId)))
      }} />}
    {resending && <FormDialog open title={text.panel.sendAgain.title}
      description={text.panel.sendAgain.description.replace('{name}', nameOf(resending.userId)).replace('{date}', formatDate(fixedResponseDueDate()))}
      confirmLabel={text.panel.sendAgain.confirm} cancelLabel={text.panel.sendAgain.cancel} onConfirm={resend} onClose={closeResending}>
      {resendError && <p role="alert" className="text-sm text-status-rejected-fg">{resendError}</p>}
    </FormDialog>}
    {target && <FormDialog open title={text.panel.removeTitle.replace('{name}', nameOf(target.assignment.userId))}
      confirmLabel={text.panel.remove} closeLabel={text.panel.table.close} onConfirm={remove} onClose={close}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <TextAreaField ref={reasonRef} name="removalReason" label={text.panel.removeReason} required rows={4} maxLength={REVIEW_TEXT_MAX}
        error={reasonError || undefined} value={reason} onChange={(event) => { setReason(event.target.value); setReasonError(''); setError('') }} />
    </FormDialog>}
  </Card>
}
