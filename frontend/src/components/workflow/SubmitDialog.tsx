import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { internalReviewEn } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { eligibleReviewers } from '../../lib/reviewFlow'
import { dueDateRange, parseDueDate, SUBMIT_COMMENT_MAX } from '../../lib/workflow'
import type { SubmitOptions } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { MultiSelectField } from '../ui/MultiSelectField'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { ReviewDueDateField } from './ReviewDueDateField'

interface SubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (options: SubmitOptions) => void
  onClose: () => void
}

/** One request activates all selected internal reviewers with one shared deadline. */
export function SubmitDialog({ sop, content, onSubmit, onClose }: SubmitDialogProps) {
  const text = internalReviewEn.submit
  const fields = content.submit
  const { activeUsers } = useUsers()
  const options = eligibleReviewers(sop, sop.departmentId, activeUsers)
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [dateError, setDateError] = useState('')
  const [failed, setFailed] = useState(false)
  const firstRef = useRef<HTMLButtonElement>(null)
  const reviewerErrorId = useId()
  const requestRef = useRef<HTMLInputElement>(null)

  function confirm() {
    if (!reviewerIds.length || reviewerIds.some((id) => !options.some((user) => user.id === id))) {
      flushSync(() => setError(text.reviewerRequired))
      firstRef.current?.focus()
      return false
    }
    if (!parseDueDate(dueDate).valid) {
      flushSync(() => setDateError(text.dateInvalid.replace('{min}', formatDate(dueDateRange().min))))
      requestRef.current?.focus()
      return false
    }
    try { onSubmit({ reviewerIds, dueDate: dueDate || undefined, note: note.trim() || undefined }) }
    catch { setFailed(true); return false }
  }
  return (
    <FormDialog open title={text.title} confirmLabel={text.confirm} cancelLabel={content.cancel} onConfirm={confirm} onClose={onClose}>
      {error && <p id={reviewerErrorId} role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      {failed && <p role="alert" className="text-sm text-status-rejected-fg">{fields.errors.submitFailed}</p>}
      <MultiSelectField ref={firstRef} name="internalReviewers" label={text.reviewers} placeholder={text.reviewers}
        invalid={!!error} describedBy={error ? reviewerErrorId : undefined}
        options={options.map((user) => ({ value: user.id, label: user.name }))} value={reviewerIds}
        emptyText={text.noneEligible} onChange={(next) => { setReviewerIds(next); setError(''); setFailed(false) }} />
      <ReviewDueDateField ref={requestRef} name="reviewRequestDueDate"
        text={{ ...fields.reviewDate, label: text.requestDate, help: text.datesHelp }}
        value={dueDate} error={dateError}
        onChange={(value) => { setDueDate(value); setDateError(''); setFailed(false) }} />
      <TextAreaField name="note" rows={3} label={fields.note.label} placeholder={fields.note.placeholder} maxLength={SUBMIT_COMMENT_MAX} resizable={false}
        counter={fields.note.counter.replace('{count}', String(note.length)).replace('{max}', String(SUBMIT_COMMENT_MAX))}
        value={note} onChange={(event) => { setNote(event.target.value); setFailed(false) }} />
    </FormDialog>
  )
}
