import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDateTime } from '../../lib/format'
import { personOption } from '../../lib/people'
import { hasPermission } from '../../lib/permissions'
import { addDays, DUE_DAYS_MAX, DUE_DAYS_MIN, isAuthorOrCoAuthor, isValidDueDays } from '../../lib/workflow'
import { useDepartments } from '../../state/departmentsContext'
import type { SubmitOptions } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { PeoplePicker } from '../ui/PeoplePicker'
import { TextAreaField } from '../ui/TextAreaField'
import { TextField } from '../ui/TextField'

const NOTE_MAX = 500

type Field = 'reviewers' | 'approvers' | 'reviewDays' | 'approvalDays'
type Errors = Partial<Record<Field, string>>

interface SubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (options: SubmitOptions) => void
  onClose: () => void
}

/**
 * Optional due days: empty is valid (no due date); otherwise a whole number
 * from 1 to 30.
 */
function parseDays(text: string): { valid: boolean; days?: number } {
  const trimmed = text.trim()
  if (!trimmed) return { valid: true }
  const days = Number(trimmed)
  return /^\d+$/.test(trimmed) && isValidDueDays(days) ? { valid: true, days } : { valid: false }
}

/**
 * "Submit for review": the author picks the reviewers, the approvers and how many
 * days each stage has (PBI 6). Separation of duties: the author and co-authors are
 * never offered, and nobody can be both a reviewer and an approver.
 */
export function SubmitDialog({ sop, content, onSubmit, onClose }: SubmitDialogProps) {
  const text = content.submit
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [approverIds, setApproverIds] = useState<string[]>([])
  const [reviewDays, setReviewDays] = useState('')
  const [approvalDays, setApprovalDays] = useState('')
  const [note, setNote] = useState('')
  // "Due Oct 5, 2026, 3:19 PM": the review due date if the SOP were submitted now.
  const [reviewDueHint, setReviewDueHint] = useState<string>()
  const [errors, setErrors] = useState<Errors>({})
  // Approvers removed because they were then picked as reviewers (only while they still are).
  const [uncheckedIds, setUncheckedIds] = useState<string[]>([])
  const reviewersRef = useRef<HTMLInputElement>(null)
  const approversRef = useRef<HTMLInputElement>(null)
  const reviewDaysRef = useRef<HTMLInputElement>(null)
  const approvalDaysRef = useRef<HTMLInputElement>(null)

  const { activeUsers, nameOf } = useUsers()
  const { nameOf: departmentName } = useDepartments()
  const eligible = activeUsers.filter((user) => !isAuthorOrCoAuthor(sop, user.id))
  const reviewerOptions = eligible.filter((user) => hasPermission(user, 'reviewer')).map((user) => personOption(user, departmentName))
  const approverOptions = eligible
    .filter((user) => hasPermission(user, 'approver') && !reviewerIds.includes(user.id))
    .map((user) => personOption(user, departmentName))

  function clearError(field: Field) {
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function chooseReviewers(next: string[]) {
    setReviewerIds(next)
    clearError('reviewers')
    // Someone picked as a reviewer can't also approve: remove them from approvers and say so.
    const removed = approverIds.filter((id) => next.includes(id))
    if (removed.length > 0) setApproverIds(approverIds.filter((id) => !next.includes(id)))
    setUncheckedIds([...uncheckedIds.filter((id) => next.includes(id)), ...removed])
  }

  function confirm() {
    const review = parseDays(reviewDays)
    const approval = parseDays(approvalDays)
    const next: Errors = {
      reviewers: reviewerIds.length > 0 ? undefined : text.errors.reviewersRequired,
      approvers: approverIds.length > 0 ? undefined : text.errors.approversRequired,
      reviewDays: review.valid ? undefined : text.errors.daysInvalid,
      approvalDays: approval.valid ? undefined : text.errors.daysInvalid,
    }
    // Render the messages before moving focus, so screen readers read them with the field.
    flushSync(() => setErrors(next))
    const firstInvalid = (
      [
        ['reviewers', reviewersRef],
        ['approvers', approversRef],
        ['reviewDays', reviewDaysRef],
        ['approvalDays', approvalDaysRef],
      ] as const
    ).find(([field]) => next[field])
    if (firstInvalid) {
      firstInvalid[1].current?.focus()
      return false
    }
    onSubmit({
      reviewerIds,
      approverIds,
      reviewDueDays: review.days,
      approvalDueDays: approval.days,
      note: note.trim() || undefined,
    })
  }

  return (
    <FormDialog
      open
      title={text.title}
      description={text.description}
      confirmLabel={text.confirm}
      cancelLabel={content.cancel}
      onConfirm={confirm}
      onClose={onClose}
    >
      <PeoplePicker
        label={text.reviewers.label}
        hint={text.reviewers.hint}
        options={reviewerOptions}
        value={reviewerIds}
        error={errors.reviewers}
        inputRef={reviewersRef}
        onChange={chooseReviewers}
      />
      <div>
        <PeoplePicker
          label={text.approvers.label}
          hint={text.approvers.hint}
          options={approverOptions}
          value={approverIds}
          error={errors.approvers}
          inputRef={approversRef}
          onChange={(next) => {
            setApproverIds(next)
            clearError('approvers')
          }}
        />
        <p role="status" className="text-sm text-maroon">
          {uncheckedIds.length > 0 && (
            <span className="mt-1.5 block">
              {text.approvers.unchecked.replace('{names}', uncheckedIds.map((id) => nameOf(id)).join(', '))}
            </span>
          )}
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          ref={reviewDaysRef}
          name="reviewDueDays"
          type="number"
          inputMode="numeric"
          min={DUE_DAYS_MIN}
          max={DUE_DAYS_MAX}
          step={1}
          label={text.reviewDays.label}
          hint={reviewDueHint ?? text.reviewDays.hint}
          value={reviewDays}
          error={errors.reviewDays}
          onChange={(event) => {
            setReviewDays(event.target.value)
            clearError('reviewDays')
            const { days } = parseDays(event.target.value)
            setReviewDueHint(
              days ? text.reviewDays.dueHint.replace('{date}', formatDateTime(addDays(new Date().toISOString(), days))) : undefined,
            )
          }}
        />
        <TextField
          ref={approvalDaysRef}
          name="approvalDueDays"
          type="number"
          inputMode="numeric"
          min={DUE_DAYS_MIN}
          max={DUE_DAYS_MAX}
          step={1}
          label={text.approvalDays.label}
          hint={text.approvalDays.hint}
          value={approvalDays}
          error={errors.approvalDays}
          onChange={(event) => {
            setApprovalDays(event.target.value)
            clearError('approvalDays')
          }}
        />
      </div>
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
