import { useId, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { approvalEn } from '../../content/approval.en'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop } from '../../data/mock/types'
import { approvalReadiness, type ApprovalSubmissionOptions } from '../../lib/approval'
import { formatDate } from '../../lib/format'
import { approvalDueDateRange, parseApprovalDueDate } from '../../lib/workflow'
import { useDepartments } from '../../state/departmentsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { ReviewDueDateField } from './ReviewDueDateField'

interface SubmitForApprovalDialogProps {
  sop: Sop
  onSubmit: (options: ApprovalSubmissionOptions) => void
  onClose: () => void
}

/** Explicit Author attestations belong to this version and review round only. */
export function SubmitForApprovalDialog({ sop, onSubmit, onClose }: SubmitForApprovalDialogProps) {
  const text = approvalEn.dialog
  const user = useCurrentUser()
  const { users } = useUsers()
  const { departments } = useDepartments()
  const environment = { users, departments }
  // Keep the opening snapshot: a stale dialog cannot submit a later version or round.
  const [snapshot] = useState(() => ({ version: sop.version, internalReviewRoundId: sop.internalReviewRounds?.at(-1)?.id ?? '' }))
  const [noExternalReviewsRequired, setNoExternalReviewsRequired] = useState(false)
  const [feedbackAddressed, setFeedbackAddressed] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [dateError, setDateError] = useState('')
  const errorRef = useRef<HTMLDivElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const externalHintId = useId()
  const readiness = approvalReadiness(sop, user.id, environment)

  function confirm() {
    const options: ApprovalSubmissionOptions = {
      ...snapshot,
      noExternalReviewsRequired,
      feedbackAddressed,
      dueDate: dueDate || undefined,
    }
    const current = approvalReadiness(sop, user.id, environment, options)
    if (!current.ready) {
      flushSync(() => setErrors(current.reasons))
      errorRef.current?.focus()
      return false
    }
    if (!parseApprovalDueDate(dueDate).valid) {
      const range = approvalDueDateRange()
      flushSync(() => setDateError(text.dateInvalid.replace('{min}', formatDate(range.min)).replace('{max}', formatDate(range.max))))
      dateRef.current?.focus()
      return false
    }
    try {
      onSubmit(options)
    } catch (error) {
      flushSync(() => setErrors([error instanceof Error ? error.message : text.failed]))
      errorRef.current?.focus()
      return false
    }
  }

  return (
    <FormDialog open title={text.title} description={text.description} confirmLabel={approvalEn.action}
      cancelLabel={text.cancel} onConfirm={confirm} onClose={onClose}>
      {errors.length > 0 && (
        <div ref={errorRef} role="alert" tabIndex={-1} className="rounded-lg border border-status-rejected-fg/20 bg-status-rejected-bg p-3 text-sm text-status-rejected-fg">
          <ul className="list-disc space-y-1 pl-4">{errors.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        </div>
      )}
      {readiness.qualityController && (
        <div className="rounded-lg border border-beige bg-beige/30 p-3 text-sm">
          <p className="text-text-gray">{text.controller}</p>
          <p className="mt-1 font-medium text-maroon">{readiness.qualityController.name}</p>
        </div>
      )}
      {readiness.requiresExternalConfirmation && (
        <div>
          <label className="flex cursor-pointer items-start gap-3 text-sm text-maroon">
            <input type="checkbox" name="noExternalReviewsRequired" checked={noExternalReviewsRequired}
              aria-describedby={externalHintId} className="mt-0.5 size-4 shrink-0 cursor-pointer accent-maroon"
              onChange={(event) => { setNoExternalReviewsRequired(event.target.checked); setErrors([]) }} />
            <span>{text.noExternalReviews}</span>
          </label>
          <p id={externalHintId} className="mt-2 text-sm text-text-gray">{text.noExternalReviewsHint}</p>
        </div>
      )}
      {readiness.requiresFeedbackConfirmation && (
        <label className="flex cursor-pointer items-start gap-3 text-sm text-maroon">
          <input type="checkbox" name="feedbackAddressed" checked={feedbackAddressed}
            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-maroon"
            onChange={(event) => { setFeedbackAddressed(event.target.checked); setErrors([]) }} />
          <span>{text.feedbackAddressed}</span>
        </label>
      )}
      <ReviewDueDateField ref={dateRef} stage="approval" name="approvalDueDate" value={dueDate} error={dateError}
        text={{ ...sopWorkflowEn.dialogs.submit.reviewDate, label: text.dueDate, help: text.dueDateHelp }}
        onChange={(value) => { setDueDate(value); setDateError(''); setErrors([]) }} />
    </FormDialog>
  )
}
