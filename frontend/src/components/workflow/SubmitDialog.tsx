import { useRef, useState } from 'react'
import type { SopWorkflowContent } from '../../content/types'
import { internalReviewEn } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { formatDate } from '../../lib/format'
import { eligibleReviewers } from '../../lib/reviewFlow'
import { dueDateRange, parseDueDate } from '../../lib/workflow'
import type { SubmitOptions } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { CheckboxGroup } from '../ui/CheckboxGroup'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { TextField } from '../ui/TextField'

interface SubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (options: SubmitOptions) => void
  onClose: () => void
}

/** A single request activates every selected internal reviewer at the same time. */
export function SubmitDialog({ sop, content, onSubmit, onClose }: SubmitDialogProps) {
  const text = internalReviewEn.submit
  const { activeUsers } = useUsers()
  const options = eligibleReviewers(sop, sop.departmentId, activeUsers)
  const [reviewerIds, setReviewerIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [reviewerDueDates, setReviewerDueDates] = useState<Record<string, string>>({})
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const firstRef = useRef<HTMLInputElement>(null)
  const range = dueDateRange()
  function confirm() {
    if (!reviewerIds.length || reviewerIds.some((id) => !options.some((user) => user.id === id))) {
      setError(text.reviewerRequired)
      firstRef.current?.focus()
      return false
    }
    const dates = Object.fromEntries(reviewerIds.filter((id) => reviewerDueDates[id]?.trim()).map((id) => [id, reviewerDueDates[id]]))
    if (![dueDate, ...Object.values(dates)].every((date) => parseDueDate(date).valid)) {
      setError(text.dateInvalid.replace('{min}', formatDate(range.min)).replace('{max}', formatDate(range.max)))
      return false
    }
    try { onSubmit({ reviewerIds, dueDate: dueDate || undefined, reviewerDueDates: dates, note: note.trim() || undefined }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : text.reviewerRequired); return false }
  }
  return (
    <FormDialog open title={text.title} confirmLabel={text.confirm} cancelLabel={text.cancel} onConfirm={confirm} onClose={onClose}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <CheckboxGroup firstRef={firstRef} name="internalReviewers" legend={text.reviewers} hint={text.reviewersHelp}
        options={options.map((user) => ({ value: user.id, label: user.name }))} value={reviewerIds}
        emptyText={text.noneEligible} onChange={(next) => { setReviewerIds(next); setError('') }} />
      <TextField name="reviewRequestDueDate" type="date" min={range.min} max={range.max} label={text.requestDate}
        hint={text.datesHelp} value={dueDate} onChange={(event) => { setDueDate(event.target.value); setError('') }} />
      {reviewerIds.map((id) => <fieldset key={id} className="rounded-lg border border-beige p-3">
        <legend className="px-1 text-sm font-medium text-maroon">{options.find((user) => user.id === id)?.name}</legend>
        <TextField name={'reviewerDueDate-' + id} type="date" min={range.min} max={range.max} label={text.taskDate}
          value={reviewerDueDates[id] ?? ''} onChange={(event) => { setReviewerDueDates((previous) => ({ ...previous, [id]: event.target.value })); setError('') }} />
      </fieldset>)}
      <TextAreaField name="note" rows={3} label={text.note} maxLength={500} resizable={false}
        counter={content.submit.note.counter.replace('{count}', String(note.length)).replace('{max}', '500')} value={note} onChange={(event) => setNote(event.target.value)} />
    </FormDialog>
  )
}
