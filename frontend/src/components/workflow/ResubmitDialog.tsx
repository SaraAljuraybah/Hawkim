import type { SopWorkflowContent } from '../../content/types'
import { getUser } from '../../data/mock/users'
import type { Sop } from '../../data/mock/types'
import { FormDialog } from '../ui/FormDialog'

interface ResubmitDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: () => void
  onClose: () => void
}

/** "Resubmit for review": confirms the same reviewer and approver (shown read-only). */
export function ResubmitDialog({ sop, content, onSubmit, onClose }: ResubmitDialogProps) {
  const text = content.resubmit
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
        <div>
          <dt className="font-medium text-maroon">{text.reviewerLabel}</dt>
          <dd className="mt-0.5 text-text-gray">{getUser(sop.reviewerId)?.name}</dd>
        </div>
        <div>
          <dt className="font-medium text-maroon">{text.approverLabel}</dt>
          <dd className="mt-0.5 text-text-gray">{getUser(sop.approverId)?.name}</dd>
        </div>
      </dl>
    </FormDialog>
  )
}
