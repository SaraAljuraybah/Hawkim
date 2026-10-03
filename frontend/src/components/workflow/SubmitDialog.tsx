import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { getDepartmentName } from '../../data/mock/departments'
import { users } from '../../data/mock/users'
import { hasPermission } from '../../lib/permissions'
import { FormDialog } from '../ui/FormDialog'
import { SelectField } from '../ui/SelectField'
import { TextAreaField } from '../ui/TextAreaField'

const NOTE_MAX = 500

interface SubmitDialogProps {
  content: SopWorkflowContent['dialogs']
  /** The SOP's author (never offered as reviewer or approver). */
  authorId: string
  onSubmit: (reviewerId: string, approverId: string, note?: string) => void
  onClose: () => void
}

/**
 * "Submit for review": the author picks the reviewer and the approver (PBI 6).
 * Separation of duties: the reviewer and approver lists exclude the author, and
 * the approver list also excludes the selected reviewer.
 */
export function SubmitDialog({ content, authorId, onSubmit, onClose }: SubmitDialogProps) {
  const text = content.submit
  const [reviewerId, setReviewerId] = useState('')
  const [approverId, setApproverId] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<{ reviewer?: string; approver?: string }>({})
  const reviewerRef = useRef<HTMLSelectElement>(null)
  const approverRef = useRef<HTMLSelectElement>(null)

  const option = (user: (typeof users)[number]) => ({
    value: user.id,
    label: `${user.name} — ${getDepartmentName(user.departmentId)}`,
  })
  const reviewers = users.filter((user) => user.id !== authorId && hasPermission(user, 'reviewer')).map(option)
  const approvers = users
    .filter((user) => user.id !== authorId && user.id !== reviewerId && hasPermission(user, 'approver'))
    .map(option)

  function chooseReviewer(id: string) {
    setReviewerId(id)
    // The same person can't also approve.
    if (id === approverId) setApproverId('')
    if (errors.reviewer) setErrors((prev) => ({ ...prev, reviewer: undefined }))
  }

  function confirm() {
    const next = {
      reviewer: reviewerId ? undefined : text.errors.reviewerRequired,
      approver: approverId ? undefined : text.errors.approverRequired,
    }
    flushSync(() => setErrors(next))
    if (next.reviewer) {
      reviewerRef.current?.focus()
      return false
    }
    if (next.approver) {
      approverRef.current?.focus()
      return false
    }
    onSubmit(reviewerId, approverId, note.trim() || undefined)
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
      <SelectField
        ref={reviewerRef}
        name="reviewer"
        label={text.reviewer.label}
        placeholder={text.reviewer.placeholder}
        options={reviewers}
        value={reviewerId}
        error={errors.reviewer}
        onChange={(event) => chooseReviewer(event.target.value)}
      />
      <SelectField
        ref={approverRef}
        name="approver"
        label={text.approver.label}
        placeholder={text.approver.placeholder}
        options={approvers}
        value={approverId}
        error={errors.approver}
        onChange={(event) => {
          setApproverId(event.target.value)
          if (errors.approver) setErrors((prev) => ({ ...prev, approver: undefined }))
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
