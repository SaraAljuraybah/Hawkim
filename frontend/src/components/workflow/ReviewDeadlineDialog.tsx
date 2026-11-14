import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { internalReviewEn } from '../../content/internalReview.en'
import type { InternalReviewerAssignment } from '../../data/mock/types'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import { formatDate, formatReviewDate } from '../../lib/format'
import { REVIEW_DURATION_CONFIRM_ABOVE, REVIEW_DURATION_MAX, REVIEW_DURATION_MIN, requestDeadline } from '../../lib/internalReviewStatus'
import { previewPendingDuration, previewReviewDeadline, reviewDeadlineFailure } from '../../lib/reviewDeadline'
import { WORKING_DAY_POLICY } from '../../lib/riyadhWorkingDays'
import { FormDialog } from '../ui/FormDialog'
import { TextField } from '../ui/TextField'

interface ReviewDeadlineDialogProps {
  request: InternalReviewerAssignment
  /** The reviewer's name. */
  name: string
  /** Saves the new duration; if it throws, the dialog stays open and says so. */
  onSubmit: (days: number) => Promise<void>
  onClose: () => void
}

/**
 * Changes an accepted request's review deadline: a number of working days from the acceptance
 * date, as in Submit for Review, with the resulting date shown. A duration above the confirmation
 * limit, or an earlier deadline, may be a mistake: the first press asks, the second saves.
 * A pending request has no deadline yet: its review duration changes instead (PendingDurationDialog).
 */
export function ReviewDeadlineDialog(props: ReviewDeadlineDialogProps) {
  return props.request.decision === 'pending' ? <PendingDurationDialog {...props} /> : <AcceptedDeadlineDialog {...props} />
}

function AcceptedDeadlineDialog({ request, name, onSubmit, onClose }: ReviewDeadlineDialogProps) {
  const { deadline: text, table } = internalReviewEn.panel
  const fieldRef = useRef<HTMLInputElement>(null)
  // A calendar-day duration isn't a number of working days, so it isn't offered as the starting value.
  const [duration, setDuration] = useState(request.deadlinePolicy === WORKING_DAY_POLICY && request.reviewDurationDays ? String(request.reviewDurationDays) : '')
  const [error, setError] = useState('')
  const [failure, setFailure] = useState('')
  const [confirming, setConfirming] = useState(false)
  const now = useDeadlineClock(undefined, true)
  const preview = previewReviewDeadline(request, duration, new Date(now))
  const currentAt = requestDeadline(request)?.dueAt
  const warnings = [
    ...(preview.long ? [internalReviewEn.submit.durationLong.replace('{count}', String(REVIEW_DURATION_CONFIRM_ABOVE))] : []),
    ...(preview.shorter ? [text.shorter] : []),
  ]

  async function confirm() {
    if (preview.problem) {
      flushSync(() => setError(text[preview.problem!]))
      fieldRef.current?.focus()
      return false
    }
    if (warnings.length && !confirming) {
      flushSync(() => setConfirming(true))
      fieldRef.current?.focus()
      return false
    }
    try { await onSubmit(Number(duration.trim())) }
    catch (caught) { flushSync(() => setFailure(text[reviewDeadlineFailure(caught)])); return false }
  }

  return (
    <FormDialog open title={text.title.replace('{name}', name)} confirmLabel={confirming ? text.confirmAgain : text.confirm}
      closeLabel={table.close} onConfirm={confirm} onClose={onClose}>
      {failure && <p role="alert" className="text-sm text-status-rejected-fg">{failure}</p>}
      <p className="text-sm text-text-gray">{currentAt ? text.current.replace('{date}', formatReviewDate(currentAt)) : text.noCurrent}</p>
      <TextField ref={fieldRef} name="reviewDeadlineDays" type="number" inputMode="numeric" required min={REVIEW_DURATION_MIN} max={REVIEW_DURATION_MAX} step={1}
        label={text.label} hint={text.hint.replace('{date}', formatReviewDate(request.acceptedAt!))} value={duration} error={error || undefined}
        onChange={(event) => { setDuration(event.target.value); setError(''); setFailure(''); setConfirming(false) }} />
      <p aria-live="polite" className="text-sm font-medium text-maroon">{preview.dueDate ? text.preview.replace('{date}', formatDate(preview.dueDate)) : ''}</p>
      {confirming && warnings.map((warning) => <p key={warning} role="alert" className="text-sm text-maroon">{warning}</p>)}
    </FormDialog>
  )
}

/**
 * Changes a pending request's review duration, in working days. The review time starts when the
 * reviewer accepts, so there's no deadline to show yet, only the latest it can be (accepted on the
 * last day to accept). The response deadline doesn't change. A duration above the confirmation limit
 * may be a mistake: the first press asks, the second saves.
 */
function PendingDurationDialog({ request, name, onSubmit, onClose }: ReviewDeadlineDialogProps) {
  const { deadline: text, table } = internalReviewEn.panel
  const pending = text.pending
  const fieldRef = useRef<HTMLInputElement>(null)
  const [duration, setDuration] = useState(request.deadlinePolicy === WORKING_DAY_POLICY && request.reviewDurationDays ? String(request.reviewDurationDays) : '')
  const [error, setError] = useState('')
  const [failure, setFailure] = useState('')
  const [confirming, setConfirming] = useState(false)
  const preview = previewPendingDuration(request, duration)
  const current = request.reviewDurationDays === undefined ? pending.noCurrent
    : request.reviewDurationDays === 1 ? pending.currentOne : pending.current.replace('{count}', String(request.reviewDurationDays))

  async function confirm() {
    if (preview.problem) {
      flushSync(() => setError(preview.problem === 'unchanged' ? pending.unchanged : text.invalid))
      fieldRef.current?.focus()
      return false
    }
    if (preview.long && !confirming) {
      flushSync(() => setConfirming(true))
      fieldRef.current?.focus()
      return false
    }
    try { await onSubmit(Number(duration.trim())) }
    catch (caught) { flushSync(() => setFailure(text[reviewDeadlineFailure(caught)])); return false }
  }

  return (
    <FormDialog open title={pending.title.replace('{name}', name)} confirmLabel={confirming ? text.confirmAgain : pending.confirm}
      closeLabel={table.close} onConfirm={confirm} onClose={onClose}>
      {failure && <p role="alert" className="text-sm text-status-rejected-fg">{failure}</p>}
      <p className="text-sm text-text-gray">{current}</p>
      <TextField ref={fieldRef} name="reviewDurationDays" type="number" inputMode="numeric" required min={REVIEW_DURATION_MIN} max={REVIEW_DURATION_MAX} step={1}
        label={text.label} hint={pending.hint.replace('{date}', request.responseDueDate ? formatDate(request.responseDueDate) : '')} value={duration} error={error || undefined}
        onChange={(event) => { setDuration(event.target.value); setError(''); setFailure(''); setConfirming(false) }} />
      {/* Stays mounted so each new date is announced */}
      <p aria-live="polite" className="text-sm font-medium text-maroon">{preview.latestDueDate && preview.problem !== 'invalid' ? pending.preview.replace('{date}', formatDate(preview.latestDueDate)) : ''}</p>
      {confirming && <p role="alert" className="text-sm text-maroon">{internalReviewEn.submit.durationLong.replace('{count}', String(REVIEW_DURATION_CONFIRM_ABOVE))}</p>}
    </FormDialog>
  )
}
