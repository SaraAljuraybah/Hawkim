import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'

interface ResubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: () => void
  onClose: () => void
}

/** "Resubmit for review": confirms the same reviewers, approvers and due days (shown read-only). */
export function ResubmitDialog({ sop, content, onSubmit, onClose }: ResubmitDialogProps) {
  const text = content.resubmit
  const { nameOf } = useUsers()
  const names = (people: { userId: string }[]) => people.map((p) => nameOf(p.userId)).join(', ')
  const days = (count?: number) =>
    count === undefined ? text.noDueDate : count === 1 ? text.oneDay : text.days.replace('{count}', String(count))
  const rows = [
    { label: text.reviewersLabel, value: names(sop.reviewers) },
    { label: text.approversLabel, value: names(sop.approvers) },
    { label: text.reviewDaysLabel, value: days(sop.reviewDueDays) },
    { label: text.approvalDaysLabel, value: days(sop.approvalDueDays) },
  ]

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
          <div key={row.label}>
            <dt className="font-medium text-maroon">{row.label}</dt>
            <dd className="mt-0.5 text-text-gray">{row.value}</dd>
          </div>
        ))}
      </dl>
    </FormDialog>
  )
}
