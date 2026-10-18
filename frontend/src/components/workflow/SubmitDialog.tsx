import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { daysFromToday, defaultAssignees, dueDateRange, parseDueDate } from '../../lib/workflow'
import type { SubmitOptions } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { TextField } from '../ui/TextField'

const NOTE_MAX = 500

interface SubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (options: SubmitOptions) => void
  onClose: () => void
}

/**
 * "Submit for review" (PBI 6): an optional review due date (1 to 30 days from today)
 * and optional comments. The reviewers and approvers aren't chosen here: for now they
 * come from a temporary rule (defaultAssignees, the SOP's department) until the Admin
 * assigns them. The approval stage has no due date.
 */
export function SubmitDialog({ sop, content, onSubmit, onClose }: SubmitDialogProps) {
  const text = content.submit
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [dateError, setDateError] = useState<string>()
  const dueDateRef = useRef<HTMLInputElement>(null)

  const { activeUsers } = useUsers()
  // TODO: Replace with the Admin's assignment (temporary rule, see defaultAssignees).
  const { reviewerIds, approverIds } = defaultAssignees(sop, activeUsers)
  const noAssignees = reviewerIds.length === 0 || approverIds.length === 0

  const range = dueDateRange()
  const days = parseDueDate(dueDate).valid ? daysFromToday(dueDate) : undefined
  const daysHint =
    days === undefined ? undefined : days === 1 ? text.reviewDate.oneDay : text.reviewDate.days.replace('{count}', String(days))

  function confirm() {
    if (noAssignees) return false
    const review = parseDueDate(dueDate)
    const error = review.valid
      ? undefined
      : text.errors.dateInvalid.replace('{min}', formatDate(range.min)).replace('{max}', formatDate(range.max))
    // Render the message before moving focus, so screen readers read it with the field.
    flushSync(() => setDateError(error))
    if (error) {
      dueDateRef.current?.focus()
      return false
    }
    onSubmit({ reviewerIds, approverIds, reviewDueDays: review.days, note: note.trim() || undefined })
  }

  return (
    <FormDialog
      open
      title={text.title}
      confirmLabel={text.confirm}
      cancelLabel={content.cancel}
      onConfirm={confirm}
      onClose={onClose}
    >
      {noAssignees && (
        <p role="alert" className="rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg/50 p-3 text-sm font-medium text-status-rejected-fg">
          {text.errors.noAssignees}
        </p>
      )}
      <TextField
        ref={dueDateRef}
        name="reviewDueDate"
        type="date"
        min={range.min}
        max={range.max}
        label={text.reviewDate.label}
        hint={daysHint}
        value={dueDate}
        error={dateError}
        onChange={(event) => {
          setDueDate(event.target.value)
          setDateError(undefined)
        }}
      />
      <TextAreaField
        name="note"
        rows={3}
        label={text.note.label}
        placeholder={text.note.placeholder}
        maxLength={NOTE_MAX}
        counter={text.note.counter.replace('{count}', String(note.length)).replace('{max}', String(NOTE_MAX))}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </FormDialog>
  )
}
