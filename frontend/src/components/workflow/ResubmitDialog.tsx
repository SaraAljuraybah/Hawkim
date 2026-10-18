import type { SopWorkflowContent } from '../../content/types'
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

/** Confirms each reviewer and their original allocation, without approval details. */
export function ResubmitDialog({ sop, content, onSubmit, onClose }: ResubmitDialogProps) {
  const text = content.resubmit
  const { nameOf } = useUsers()
  const days = (count?: number) =>
    count === undefined ? text.noDueDate : count === 1 ? text.oneDay : text.days.replace('{count}', String(count))
  const rows = sop.reviewers.map((reviewer) => ({
    id: reviewer.userId,
    label: nameOf(reviewer.userId),
    value: days(reviewerAssignedDays(sop, reviewer)),
  }))

  return (
    <FormDialog
      open
      title={text.title}
      description={text.description.replace('{version}', sop.version)}
      confirmLabel={text.confirm}
      cancelLabel={content.cancel}
      onConfirm={onSubmit}
      onClose={onClose}
    >
      <dl className="grid gap-3 rounded-lg border border-beige bg-beige/40 p-4 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.id}>
            <dt className="font-medium text-maroon">{row.label}</dt>
            <dd className="mt-0.5 text-text-gray">{text.reviewDaysLabel}: {row.value}</dd>
          </div>
        ))}
      </dl>
    </FormDialog>
  )
}
