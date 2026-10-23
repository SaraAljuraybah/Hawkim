import { useId, type Ref } from 'react'
import { useDeadlineClock } from '../../hooks/useDeadlineClock'
import type { SopWorkflowContent } from '../../content/types'
import { formatDateTime } from '../../lib/format'
import { formatReviewDuration } from '../../lib/reviewDuration'
import { approvalDueDateRange, dueAtOfDate, dueDateRange, parseApprovalDueDate, parseDueDate } from '../../lib/workflow'
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
  /** Approval retains its existing tomorrow-through-30-days restriction. */
  stage?: 'review' | 'approval'
  ref?: Ref<HTMLInputElement>
}

/**
 * Optional deadline with an accessible allocation and local end-of-day preview.
 * Review accepts today and future dates; approval retains its existing range.
 */
export function ReviewDueDateField({ name, value, onChange, text, error, disabled, stage = 'review', ref }: ReviewDueDateFieldProps) {
  const timeGivenId = useId()
  const nowTimestamp = useDeadlineClock(undefined, !disabled)
  const now = new Date(nowTimestamp)
  const range = stage === 'approval' ? approvalDueDateRange(now) : dueDateRange(now)
  const { valid, days } = stage === 'approval' ? parseApprovalDueDate(value, now) : parseDueDate(value, now)
  const timeGiven =
    !valid || days === undefined || disabled
      ? undefined
      : (stage === 'approval'
          ? days === 1 ? text.oneDay : text.days.replace('{count}', String(days))
          : text.duration.replace('{duration}', formatReviewDuration(new Date(dueAtOfDate(value)).getTime() - now.getTime()))
        ).replace(
          '{date}',
          formatDateTime(dueAtOfDate(value)),
        )

  return (
    <div>
      <TextField
        ref={ref}
        name={name}
        type="date"
        min={range.min}
        max={range.max}
        label={text.label}
        hint={text.help}
        aria-describedby={timeGiven ? timeGivenId : undefined}
        value={value}
        error={error}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {timeGiven && (
        <p id={timeGivenId} className="mt-1 text-sm text-text-gray">
          {timeGiven}
        </p>
      )}
    </div>
  )
}
