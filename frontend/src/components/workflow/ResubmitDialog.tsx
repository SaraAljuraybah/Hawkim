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

/**
 * "Resubmit for review": back to the same Reviewer 1, like the first submission. An
 * optional due date for Reviewer 1 (every earlier deadline is cleared) and optional
 * comments. Uses the Submit dialog's field texts.
 */
export function ResubmitDialog({ sop, content, onSubmit, onClose }: ResubmitDialogProps) {
  const text = content.resubmit
  const fields = content.submit
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [dateError, setDateError] = useState('')
  // The store refused the resubmission (the code's own message is for developers, not shown).
  const [failed, setFailed] = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)

  function confirm() {
    if (!parseDueDate(dueDate).valid) {
      const range = dueDateRange()
      flushSync(() =>
        setDateError(fields.errors.dateInvalid.replace('{min}', formatDate(range.min)).replace('{max}', formatDate(range.max))),
      )
      dateRef.current?.focus()
      return false
    }
    try {
      onSubmit({ dueDate: dueDate || undefined, note: note.trim() || undefined })
    } catch {
      setFailed(true)
      return false
    }
  }

  return (
    <FormDialog
      open
      title={text.title}
      description={text.description.replace('{version}', sop.version)}
      confirmLabel={text.confirm}
      cancelLabel={content.cancel}
      onConfirm={confirm}
      onClose={onClose}
    >
      {failed && (
        <p role="alert" className="text-sm text-status-rejected-fg">
          {text.failed}
        </p>
      )}
      <ReviewDueDateField
        ref={dateRef}
        name="reviewDueDate"
        text={fields.reviewDate}
        value={dueDate}
        error={dateError}
        onChange={(value) => {
          setDueDate(value)
          setDateError('')
        }}
      />
      <TextAreaField
        name="note"
        rows={3}
        label={fields.note.label}
        placeholder={fields.note.placeholder}
        maxLength={SUBMIT_COMMENT_MAX}
        resizable={false}
        counter={fields.note.counter.replace('{count}', String(note.length)).replace('{max}', String(SUBMIT_COMMENT_MAX))}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </FormDialog>
  )
}
