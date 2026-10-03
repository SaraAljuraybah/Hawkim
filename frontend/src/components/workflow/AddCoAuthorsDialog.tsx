import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import type { Sop } from '../../data/mock/types'
import { personOption } from '../../lib/people'
import { hasPermission } from '../../lib/permissions'
import { isApprover, isAuthorOrCoAuthor, isReviewer } from '../../lib/workflow'
import { useUsers } from '../../state/usersContext'
import { FormDialog } from '../ui/FormDialog'
import { PeoplePicker } from '../ui/PeoplePicker'

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
  const inputRef = useRef<HTMLInputElement>(null)

  const { activeUsers } = useUsers()
  const options = activeUsers
    .filter(
      (user) =>
        hasPermission(user, 'author') &&
        !isAuthorOrCoAuthor(sop, user.id) &&
        !isReviewer(sop, user.id) &&
        !isApprover(sop, user.id),
    )
    .map(personOption)

  function confirm() {
    if (options.length === 0) return
    if (selected.length === 0) {
      flushSync(() => setError(text.required))
      inputRef.current?.focus()
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
      <PeoplePicker
        label={text.label}
        hint={text.hint}
        options={options}
        value={selected}
        error={error}
        inputRef={inputRef}
        onChange={(next) => {
          setSelected(next)
          if (error) setError(undefined)
        }}
      />
    </FormDialog>
  )
}
