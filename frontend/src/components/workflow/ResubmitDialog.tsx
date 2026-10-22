import { useState } from 'react'
import type { SopWorkflowContent } from '../../content/types'
import { internalReviewEn } from '../../content/internalReview.en'
import type { Sop } from '../../data/mock/types'
import { reviewerAssignedDays } from '../../lib/workflow'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'

interface ResubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: () => void
  onClose: () => void
}

/** Confirms the required reviewers and original allocations for a new version's round. */
export function ResubmitDialog({ sop, content, onSubmit, onClose }: ResubmitDialogProps) {
  const text = content.resubmit
  const { nameOf } = useUsers()
  const [error, setError] = useState('')
  const round = sop.internalReviewRounds?.at(-1)
  const days = (count?: number) => count === undefined ? text.noDueDate : count === 1 ? text.oneDay : text.days.replace('{count}', String(count))
  const reviewers = round ? round.assignments.filter((person) => person.cancellationReason !== 'author-cancelled') : sop.reviewers
  const rows = reviewers.map((reviewer) => ({ id: reviewer.userId, label: nameOf(reviewer.userId), value: days(reviewerAssignedDays(sop, reviewer)) }))
  function confirm() {
    try { onSubmit() }
    catch (reason) { setError(reason instanceof Error ? reason.message : internalReviewEn.status.closed); return false }
  }
  return (
    <FormDialog open title={text.title} description={text.description.replace('{version}', sop.version)}
      confirmLabel={text.confirm} cancelLabel={content.cancel} onConfirm={confirm} onClose={onClose}>
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      {round && <>
        <p className="text-sm text-text-gray">{internalReviewEn.panel.resubmitHelp}</p>
        <p className="text-sm text-maroon">{internalReviewEn.panel.requestDeadline}: {days(round.assignedDueDays ?? undefined)}</p>
      </>}
      <dl className="grid gap-3 rounded-lg border border-beige bg-beige/40 p-4 text-sm sm:grid-cols-2">
        {rows.map((row) => <div key={row.id}>
          <dt className="font-medium text-maroon">{row.label}</dt>
          <dd className="mt-0.5 text-text-gray">{text.reviewDaysLabel}: {row.value}</dd>
        </div>)}
      </dl>
    </FormDialog>
  )
}
