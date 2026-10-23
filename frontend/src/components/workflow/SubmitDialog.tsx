import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { internalReviewEn } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { eligibleReviewers } from '../../lib/reviewFlow'
import { dueDateRange, parseDueDate, SUBMIT_COMMENT_MAX } from '../../lib/workflow'
import type { SubmitOptions } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { CheckboxGroup } from '../ui/CheckboxGroup'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { ReviewDueDateField } from './ReviewDueDateField'

interface SubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (options: SubmitOptions) => void
  onClose: () => void
}

/** One request activates all selected internal reviewers, with independent deadlines. */
export function SubmitDialog({ sop, content, onSubmit, onClose }: SubmitDialogProps) {
  const text = internalReviewEn.submit
  const fields = content.submit
  const { activeUsers } = useUsers()
  const options = eligibleReviewers(sop, sop.departmentId, activeUsers)
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [reviewerDueDates, setReviewerDueDates] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [dateErrors, setDateErrors] = useState<Record<string, string>>({})
  const [failed, setFailed] = useState(false)
  const firstRef = useRef<HTMLInputElement>(null)
  const requestRef = useRef<HTMLInputElement>(null)
  const taskRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function confirm() {
    if (!reviewerIds.length || reviewerIds.some((id) => !options.some((user) => user.id === id))) {
      flushSync(() => setError(text.reviewerRequired))
      firstRef.current?.focus()
      return false
    }
    const dates = Object.fromEntries(reviewerIds.filter((id) => reviewerDueDates[id]?.trim()).map((id) => [id, reviewerDueDates[id]]))
    const range = dueDateRange()
    const invalid = text.dateInvalid.replace('{min}', formatDate(range.min)).replace('{max}', formatDate(range.max))
    const errors: Record<string, string> = {}
    if (!parseDueDate(dueDate).valid) errors.request = invalid
    for (const id of reviewerIds) if (!parseDueDate(dates[id] ?? '').valid) errors['task-' + id] = invalid
    if (Object.keys(errors).length) {
      flushSync(() => setDateErrors(errors))
      if (errors.request) requestRef.current?.focus()
      else taskRefs.current[reviewerIds.find((id) => errors['task-' + id])!]?.focus()
      return false
    }
    try { onSubmit({ reviewerIds, dueDate: dueDate || undefined, reviewerDueDates: dates, note: note.trim() || undefined }) }
    catch { setFailed(true); return false }
  }
  return (
    <FormDialog open title={text.title} confirmLabel={text.confirm} cancelLabel={content.cancel} onConfirm={confirm} onClose={onClose}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      {failed && <p role="alert" className="text-sm text-status-rejected-fg">{fields.errors.submitFailed}</p>}
      <CheckboxGroup firstRef={firstRef} name="internalReviewers" legend={text.reviewers} hint={text.reviewersHelp}
        options={options.map((user) => ({ value: user.id, label: user.name }))} value={reviewerIds}
        emptyText={text.noneEligible} onChange={(next) => { setReviewerIds(next); setError(''); setFailed(false) }} />
      <ReviewDueDateField ref={requestRef} name="reviewRequestDueDate"
        text={{ ...fields.reviewDate, label: text.requestDate, help: text.datesHelp }}
        value={dueDate} error={dateErrors.request}
        onChange={(value) => { setDueDate(value); setDateErrors((previous) => ({ ...previous, request: '' })); setFailed(false) }} />
      {reviewerIds.map((id) => <fieldset key={id} className="rounded-lg border border-beige p-3">
        <legend className="px-1 text-sm font-medium text-maroon">{options.find((user) => user.id === id)?.name}</legend>
        <ReviewDueDateField ref={(element) => { taskRefs.current[id] = element }} name={'reviewerDueDate-' + id}
          text={{ ...fields.reviewDate, label: text.taskDate }} value={reviewerDueDates[id] ?? ''} error={dateErrors['task-' + id]}
          onChange={(value) => {
            setReviewerDueDates((previous) => ({ ...previous, [id]: value }))
            setDateErrors((previous) => ({ ...previous, ['task-' + id]: '' }))
            setFailed(false)
          }} />
      </fieldset>)}
      <TextAreaField name="note" rows={3} label={fields.note.label} placeholder={fields.note.placeholder} maxLength={SUBMIT_COMMENT_MAX} resizable={false}
        counter={fields.note.counter.replace('{count}', String(note.length)).replace('{max}', String(SUBMIT_COMMENT_MAX))}
        value={note} onChange={(event) => { setNote(event.target.value); setFailed(false) }} />
    </FormDialog>
  )
}
