import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { getDepartmentName } from '../../data/mock/departments'
import { users } from '../../data/mock/users'
import type { Sop } from '../../data/mock/types'
import { hasPermission } from '../../lib/permissions'
import { isApprover, isAuthorOrCoAuthor, isReviewer } from '../../lib/workflow'
import { CheckboxGroup } from '../ui/CheckboxGroup'
import { FormDialog } from '../ui/FormDialog'

interface AddCoAuthorsDialogProps {
  sop: Sop
  content: SopWorkflowContent['dialogs']
  onSubmit: (userIds: string[]) => void
  onClose: () => void
}

/**
 * "Add co-authors": other users with the Author permission who aren't already on
 * the SOP. Its reviewers and approvers are never offered (separation of duties).
 */
export function AddCoAuthorsDialog({ sop, content, onSubmit, onClose }: AddCoAuthorsDialogProps) {
  const text = content.addCoAuthors
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string>()
  const firstRef = useRef<HTMLInputElement>(null)

  const options = users
    .filter(
      (user) =>
        hasPermission(user, 'author') &&
        !isAuthorOrCoAuthor(sop, user.id) &&
        !isReviewer(sop, user.id) &&
        !isApprover(sop, user.id),
    )
    .map((user) => ({ value: user.id, label: user.name, description: getDepartmentName(user.departmentId) }))

  function confirm() {
    if (options.length === 0) return
    if (selected.length === 0) {
      flushSync(() => setError(text.required))
      firstRef.current?.focus()
      return false
    }
    onSubmit(selected)
  }

  return (
    <FormDialog
      open
      title={text.title}
      description={text.description}
      confirmLabel={text.confirm}
      cancelLabel={content.cancel}
      onConfirm={confirm}
      onClose={onClose}
    >
      <CheckboxGroup
        name="coAuthors"
        legend={text.label}
        hint={text.hint}
        emptyText={text.empty}
        options={options}
        value={selected}
        error={error}
        firstRef={firstRef}
        onChange={(next) => {
          setSelected(next)
          if (error) setError(undefined)
        }}
      />
    </FormDialog>
  )
}
