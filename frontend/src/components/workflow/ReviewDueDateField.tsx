import { useId, type Ref } from 'react'
import type { SopWorkflowContent } from '../../content/types'
import { formatDateTime } from '../../lib/format'
import { dueAtOfDate, dueDateRange, parseDueDate } from '../../lib/workflow'
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
  ref?: Ref<HTMLInputElement>
}

/**
 * Optional review due date (Submit, Resubmit, Forward): a date from tomorrow to 30 days
 * ahead. The help text is the field's hint; once a valid date is picked, "Time given:
 * N days · Due {date}" follows on its own line, with the real deadline (the end of that
 * day, as reviewerDueAt counts it), also linked to the field. Callers validate with
 * parseDueDate and show `error`.
 */
export function ReviewDueDateField({ name, value, onChange, text, error, disabled, ref }: ReviewDueDateFieldProps) {
  const timeGivenId = useId()
  const range = dueDateRange()
  const { days } = parseDueDate(value)
  const timeGiven =
    days === undefined || disabled
      ? undefined
      : (days === 1 ? text.oneDay : text.days.replace('{count}', String(days))).replace(
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
