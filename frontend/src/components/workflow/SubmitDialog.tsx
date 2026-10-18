
import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import {
  defaultAssignees,
  dueDateRange,
  parseDueDate,
} from '../../lib/workflow'
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
 * Each reviewer can have an independent optional due date.
 * Assignees currently come from the temporary department rule.
 */
export function SubmitDialog({
  sop,
  content,
  onSubmit,
  onClose,
}: SubmitDialogProps) {
  const text = content.submit

  const [reviewerDueDates, setReviewerDueDates] = useState<
    Record<string, string>
  >({})

  const [dateErrors, setDateErrors] = useState<
    Record<string, string>
  >({})

  const [note, setNote] = useState('')

  const dateRefs = useRef<
    Record<string, HTMLInputElement | null>
  >({})

  const { activeUsers, nameOf } = useUsers()

  const { reviewerIds, approverIds } = defaultAssignees(
    sop,
    activeUsers,
  )

  const noAssignees =
    reviewerIds.length === 0 || approverIds.length === 0

  const range = dueDateRange()

  function hintFor(value: string): string | undefined {
    const { days } = parseDueDate(value)

    if (days === undefined) return undefined

    const template =
      days === 1
        ? text.reviewDate.oneDay
        : text.reviewDate.days.replace(
            '{count}',
            String(days),
          )

    return template.replace(
      '{date}',
      formatDate(value),
    )
  }

  function updateDate(reviewerId: string, value: string) {
    setReviewerDueDates((previous) => ({
      ...previous,
      [reviewerId]: value,
    }))

    setDateErrors((previous) => {
      const next = { ...previous }
      delete next[reviewerId]
      return next
    })
  }

  function confirm() {
    if (noAssignees) return false

    const invalidReviewerId = reviewerIds.find(
      (reviewerId) =>
        !parseDueDate(
          reviewerDueDates[reviewerId] ?? '',
        ).valid,
    )

    if (invalidReviewerId) {
      const error = text.errors.dateInvalid
        .replace('{min}', formatDate(range.min))
        .replace('{max}', formatDate(range.max))

      flushSync(() => {
        setDateErrors({
          [invalidReviewerId]: error,
        })
      })

      dateRefs.current[invalidReviewerId]?.focus()
      return false
    }

    const selectedDates: Record<string, string> = {}

    reviewerIds.forEach((reviewerId) => {
      const selected = reviewerDueDates[reviewerId]

      if (selected) {
        selectedDates[reviewerId] = selected
      }
    })

    onSubmit({
      reviewerIds,
      approverIds,
      reviewerDueDates: selectedDates,
      note: note.trim() || undefined,
    })
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
        <p
          role="alert"
          className="rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg/50 p-3 text-sm font-medium text-status-rejected-fg"
        >
          {text.errors.noAssignees}
        </p>
      )}

      <div className="space-y-4">
        {reviewerIds.map((reviewerId, index) => {
          const value = reviewerDueDates[reviewerId] ?? ''
          const daysHint = hintFor(value)
          const reviewerName = nameOf(reviewerId)

          return (
            <div
              key={reviewerId}
              className="rounded-xl border border-beige bg-white p-4"
            >
              <p className="mb-3 text-sm font-semibold text-maroon">
                {index + 1}. {reviewerName}
              </p>

              <TextField
                ref={(element) => {
                  dateRefs.current[reviewerId] = element
                }}
                name={`reviewDueDate-${reviewerId}`}
                type="date"
                min={range.min}
                max={range.max}
                label={`${text.reviewDate.label} — ${reviewerName}`}
                hint={text.reviewDate.help}
                value={value}
                error={dateErrors[reviewerId]}
                onChange={(event) => {
                  updateDate(
                    reviewerId,
                    event.target.value,
                  )
                }}
              />

              {daysHint && (
                <p className="mt-2 text-sm text-text-gray">
                  {daysHint}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <TextAreaField
        name="note"
        rows={3}
        label={text.note.label}
        placeholder={text.note.placeholder}
        maxLength={NOTE_MAX}
        resizable={false}
        counter={text.note.counter
          .replace('{count}', String(note.length))
          .replace('{max}', String(NOTE_MAX))}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
    </FormDialog>
  )
}
