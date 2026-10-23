import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import type { SopWorkflowContent } from '../../content/types'
import { internalReviewEn } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { formatDate, formatDateTime } from '../../lib/format'
import { formatReviewDuration } from '../../lib/reviewDuration'
import { dueDateRange, parseDueDate, SUBMIT_COMMENT_MAX } from '../../lib/workflow'
import type { ResubmitOptions } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { ReviewDueDateField } from './ReviewDueDateField'

interface ResubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (options: ResubmitOptions) => void
  onClose: () => void
}

/** Internal rounds restart one shared allocation; legacy rounds accept a fresh deadline. */
export function ResubmitDialog(props: ResubmitDialogProps) {
  return props.sop.internalReviewRounds?.length ? <InternalResubmitDialog {...props} /> : <LegacyResubmitDialog {...props} />
}

function InternalResubmitDialog({ sop, content, onSubmit, onClose }: ResubmitDialogProps) {
  const text = content.resubmit
  const { nameOf } = useUsers()
  const [failed, setFailed] = useState(false)
  const round = sop.internalReviewRounds!.at(-1)!
  const nowTimestamp = useDeadlineClock(undefined, true)
  const now = new Date(nowTimestamp)
  const nextDueAt = round.assignedDueDays === null ? undefined : new Date(now.getFullYear(), now.getMonth(), now.getDate() + round.assignedDueDays, 23, 59, 59, 999)
  const reviewers = round.assignments.filter((person) => person.cancellationReason !== 'author-cancelled')
  function confirm() {
    try { onSubmit({}) }
    catch { setFailed(true); return false }
  }
  return <FormDialog open title={text.title} confirmLabel={text.confirm} cancelLabel={content.cancel} onConfirm={confirm} onClose={onClose}>
    {failed && <p role="alert" className="text-sm text-status-rejected-fg">{text.failed}</p>}
    <p className="text-sm text-text-gray">{internalReviewEn.panel.resubmitHelp}</p>
    {nextDueAt ? <div className="text-sm text-maroon">
      <p>{internalReviewEn.panel.requestDeadline}: <time dateTime={nextDueAt.toISOString()}>{formatDateTime(nextDueAt.toISOString())}</time></p>
      <p className="mt-1 text-text-gray">{internalReviewEn.panel.timeGiven.replace('{duration}', formatReviewDuration(nextDueAt.getTime() - now.getTime()))}</p>
    </div> : <p className="text-sm text-maroon">{internalReviewEn.panel.noDeadline}</p>}
    <ul className="grid list-none gap-3 rounded-lg border border-beige bg-beige/40 p-4 text-sm font-medium text-maroon sm:grid-cols-2">
      {reviewers.map((reviewer) => <li key={reviewer.id}>{nameOf(reviewer.userId)}</li>)}
    </ul>
  </FormDialog>
}

/** Legacy resubmission clears earlier deadlines and accepts an optional new date and comments. */
function LegacyResubmitDialog({ content, onSubmit, onClose }: ResubmitDialogProps) {
  const text = content.resubmit
  const fields = content.submit
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [dateError, setDateError] = useState('')
  const [failed, setFailed] = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)
  function confirm() {
    if (!parseDueDate(dueDate).valid) {
      const range = dueDateRange()
      flushSync(() => setDateError(fields.errors.dateInvalid.replace('{min}', formatDate(range.min))))
      dateRef.current?.focus()
      return false
    }
    try { onSubmit({ dueDate: dueDate || undefined, note: note.trim() || undefined }) }
    catch { setFailed(true); return false }
  }
  return <FormDialog open title={text.title} confirmLabel={text.confirm} cancelLabel={content.cancel} onConfirm={confirm} onClose={onClose}>
    {failed && <p role="alert" className="text-sm text-status-rejected-fg">{text.failed}</p>}
    <ReviewDueDateField ref={dateRef} name="reviewDueDate" text={fields.reviewDate} value={dueDate} error={dateError}
      onChange={(value) => { setDueDate(value); setDateError(''); setFailed(false) }} />
    <TextAreaField name="note" rows={3} label={fields.note.label} placeholder={fields.note.placeholder} maxLength={SUBMIT_COMMENT_MAX} resizable={false}
      counter={fields.note.counter.replace('{count}', String(note.length)).replace('{max}', String(SUBMIT_COMMENT_MAX))}
      value={note} onChange={(event) => { setNote(event.target.value); setFailed(false) }} />
  </FormDialog>
}
