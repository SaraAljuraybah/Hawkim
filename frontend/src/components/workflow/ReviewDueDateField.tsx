import { useId, useRef, type KeyboardEvent, type Ref } from 'react'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import type { SopWorkflowContent } from '../../content/types'
import { formatDateTime, formatReviewDateTime } from '../../lib/format'
import { endOfRiyadhDay } from '../../lib/riyadhWorkingDays'
import { formatReviewDuration } from '../../lib/reviewDuration'
import { parseResponseDueDate, responseDueDateRange, responseTimeMilliseconds } from '../../lib/responseTime'
import { approvalDueDateRange, dueAtOfDate, dueDateRange, parseApprovalDueDate, parseDueDate, reviewDateDueAt } from '../../lib/workflow'
import { AlertPopup } from '../ui/AlertPopup'
import { TextField } from '../ui/TextField'

interface ReviewDueDateFieldProps {
  name: string
  /** A date input value ("2026-10-29"), or '' for no due date. */
  value: string
  onChange: (value: string) => void
  /** Label, help text and the "Time given…" templates. */
  text: SopWorkflowContent['dialogs']['submit']['reviewDate']
  error?: string
  disabled?: boolean
  /**
   * Approval retains its existing tomorrow-through-30-days restriction. A review request's
   * response due date follows the working-hours rule (lib/responseTime) and shows its error in a pop-up.
   */
  stage?: 'review' | 'approval' | 'response'
  /** Response stage: the pop-up's close button label, and clearing the error when it's closed. */
  closeLabel?: string
  onDismissError?: () => void
  ref?: Ref<HTMLInputElement>
}

/**
 * Optional deadline with an accessible allocation and a Riyadh review end-of-day preview.
 * Review accepts today and future dates; approval retains its existing range.
 */
export function ReviewDueDateField({ name, value, onChange, text, error, disabled, stage = 'review', closeLabel = '', onDismissError, ref }: ReviewDueDateFieldProps) {
  const timeGivenId = useId()
  const alertId = useId()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const nowTimestamp = useDeadlineClock(undefined, !disabled)
  const now = new Date(nowTimestamp)
  const range = stage === 'approval' ? approvalDueDateRange(now) : stage === 'response' ? responseDueDateRange(now) : dueDateRange(now)
  const { valid, days } = stage === 'approval' ? parseApprovalDueDate(value, now) : stage === 'response' ? parseResponseDueDate(value, now) : parseDueDate(value, now)
  const timeGiven =
    !valid || days === undefined || disabled
      ? undefined
      : (stage === 'approval'
          ? days === 1 ? text.oneDay : text.days.replace('{count}', String(days))
          : text.duration.replace('{duration}', formatReviewDuration(stage === 'response'
            ? responseTimeMilliseconds(value, now)
            : new Date(reviewDateDueAt(value)).getTime() - now.getTime()))
        ).replace(
          '{date}',
          stage === 'response' ? formatReviewDateTime(endOfRiyadhDay(value)) : stage === 'review' ? formatReviewDateTime(reviewDateDueAt(value)) : formatDateTime(dueAtOfDate(value)),
        )
  // The response due date's error is shown in a pop-up instead of under the field.
  const popup = stage === 'response' && !!error

  function dismiss() {
    onDismissError?.()
    wrapperRef.current?.querySelector('input')?.focus()
  }

  // Escape in the date input closes the pop-up first; a second Escape closes the dialog.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!popup || event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    dismiss()
  }

  return (
    <div ref={wrapperRef} className="relative" onKeyDown={onKeyDown}>
      <TextField
        ref={ref}
        name={name}
        type="date"
        min={range.min}
        max={range.max}
        label={text.label}
        hint={text.help}
        aria-describedby={[timeGiven ? timeGivenId : undefined, popup ? alertId : undefined].filter(Boolean).join(' ') || undefined}
        value={value}
        error={popup ? undefined : error}
        invalid={popup}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {timeGiven && (
        <p id={timeGivenId} className="mt-1 text-sm text-text-gray">
          {timeGiven}
        </p>
      )}
      {popup && <AlertPopup id={alertId} message={error ?? ''} closeLabel={closeLabel} onClose={dismiss} />}
    </div>
  )
}
