import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { reviewFlowEn } from '../../content/reviewFlow.en'
import type { Sop } from '../../data/mock/types'
import { formatDate, formatDateTime } from '../../lib/format'
import { eligibleReviewers } from '../../lib/reviewFlow'
import { dueAtOfDate, dueDateRange, parseDueDate } from '../../lib/workflow'
import type { SubmitOptions } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { SelectField } from '../ui/SelectField'
import { TextAreaField } from '../ui/TextAreaField'
import { TextField } from '../ui/TextField'

interface SubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (options: SubmitOptions) => void
  onClose: () => void
}

/** The author explicitly selects one first reviewer; no approvers are assigned at submission. */
export function SubmitDialog({ sop, content, onSubmit, onClose }: SubmitDialogProps) {
  const text = content.submit
  const { activeUsers } = useUsers()
  const options = eligibleReviewers(sop, sop.departmentId, activeUsers)
  const [reviewerId, setReviewerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [dateError, setDateError] = useState('')
  // The store refused the submission (the code's own message is for developers, not shown).
  const [failed, setFailed] = useState(false)
  const reviewerRef = useRef<HTMLSelectElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const range = dueDateRange()
  const parsed = parseDueDate(dueDate)
  // "Time given: 11 days · Due Oct 29, 2026, 11:59 PM" (nothing when empty or invalid).
  const timeGivenId = useId()
  const timeGiven =
    parsed.days === undefined
      ? undefined
      : (parsed.days === 1 ? text.reviewDate.oneDay : text.reviewDate.days.replace('{count}', String(parsed.days))).replace(
          '{date}',
          formatDateTime(dueAtOfDate(dueDate)),
        )
  function confirm() {
    if (!options.some((u) => u.id === reviewerId)) {
      flushSync(() => setError(reviewFlowEn.selectRequired))
      reviewerRef.current?.focus()
      return false
    }
    if (!parsed.valid) {
      flushSync(() => setDateError(text.errors.dateInvalid.replace('{min}', formatDate(range.min)).replace('{max}', formatDate(range.max))))
      dateRef.current?.focus()
      return false
    }
    try { onSubmit({ reviewerId, dueDate: dueDate || undefined, note: note.trim() || undefined }) }
    catch { setFailed(true); return false }
  }
  return (
    <FormDialog open title={text.title} confirmLabel={text.confirm} cancelLabel={content.cancel} onConfirm={confirm} onClose={onClose}>
      {options.length === 0 && <p role="alert" className="text-sm text-status-rejected-fg">{reviewFlowEn.noneEligible}</p>}
      {failed && <p role="alert" className="text-sm text-status-rejected-fg">{text.errors.submitFailed}</p>}
      <SelectField ref={reviewerRef} name="reviewer1" label={reviewFlowEn.reviewer1} placeholder={reviewFlowEn.choose}
        options={options.map((u) => ({ value: u.id, label: u.name }))} value={reviewerId} error={error}
        onChange={(event) => { setReviewerId(event.target.value); setError('') }} />
      <div>
        {/* The help text is the field's hint; the time given and the real deadline (end of that
            day) follow on their own line once a date is picked, also linked to the field. */}
        <TextField ref={dateRef} name="reviewDueDate" type="date" min={range.min} max={range.max} label={text.reviewDate.label}
          hint={text.reviewDate.help} aria-describedby={timeGiven ? timeGivenId : undefined}
          value={dueDate} error={dateError} onChange={(event) => { setDueDate(event.target.value); setDateError('') }} />
        {timeGiven && <p id={timeGivenId} className="mt-1 text-sm text-text-gray">{timeGiven}</p>}
      </div>
      <TextAreaField name="note" rows={3} label={text.note.label} placeholder={text.note.placeholder} maxLength={500} resizable={false}
        counter={text.note.counter.replace('{count}', String(note.length)).replace('{max}', '500')} value={note} onChange={(event) => setNote(event.target.value)} />
    </FormDialog>
  )
}
