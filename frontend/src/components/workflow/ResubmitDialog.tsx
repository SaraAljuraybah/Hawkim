import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { internalReviewEn } from '../../content/internalReview.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { dueDateRange, parseDueDate, reviewerAssignedDays, SUBMIT_COMMENT_MAX } from '../../lib/workflow'
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

/** Internal rounds restart their allocations; legacy rounds accept a fresh first deadline. */
export function ResubmitDialog(props: ResubmitDialogProps) {
  return props.sop.internalReviewRounds?.length ? <InternalResubmitDialog {...props} /> : <LegacyResubmitDialog {...props} />
}

function InternalResubmitDialog({ sop, content, onSubmit, onClose }: ResubmitDialogProps) {
  const text = content.resubmit
  const { nameOf } = useUsers()
  const [failed, setFailed] = useState(false)
  const round = sop.internalReviewRounds!.at(-1)!
  const deadlines = sopWorkflowEn.reviewerDeadline
  const days = (count?: number) => count === undefined ? deadlines.noDeadline : count === 1 ? deadlines.assignedOneDay : deadlines.assignedDays.replace('{count}', String(count))
  const reviewers = round.assignments.filter((person) => person.cancellationReason !== 'author-cancelled')
  function confirm() {
    try { onSubmit({}) }
    catch { setFailed(true); return false }
  }
  return <FormDialog open title={text.title} confirmLabel={text.confirm} cancelLabel={content.cancel} onConfirm={confirm} onClose={onClose}>
    {failed && <p role="alert" className="text-sm text-status-rejected-fg">{text.failed}</p>}
    <p className="text-sm text-text-gray">{internalReviewEn.panel.resubmitHelp}</p>
    <p className="text-sm text-maroon">{internalReviewEn.panel.requestDeadline}: {round.assignedDueDays === null ? internalReviewEn.panel.noDeadline : days(round.assignedDueDays)}</p>
    <dl className="grid gap-3 rounded-lg border border-beige bg-beige/40 p-4 text-sm sm:grid-cols-2">
      {reviewers.map((reviewer) => <div key={reviewer.id}>
        <dt className="font-medium text-maroon">{nameOf(reviewer.userId)}</dt>
        <dd className="mt-0.5 text-text-gray">{days(reviewerAssignedDays(sop, reviewer))}</dd>
      </div>)}
    </dl>
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
      flushSync(() => setDateError(fields.errors.dateInvalid.replace('{min}', formatDate(range.min)).replace('{max}', formatDate(range.max))))
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
