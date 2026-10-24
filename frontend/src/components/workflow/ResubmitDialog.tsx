import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { dueDateRange, parseDueDate, SUBMIT_COMMENT_MAX } from '../../lib/workflow'
import type { ResubmitOptions } from '../../state/sopsContext'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { ReviewDueDateField } from './ReviewDueDateField'

interface ResubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (options: ResubmitOptions) => void
  onClose: () => void
}

/** Legacy resubmission clears earlier deadlines and accepts an optional new date and comments. Internal reviews send a new version with Request reviews. */
export function ResubmitDialog({ content, onSubmit, onClose }: ResubmitDialogProps) {
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
