import { useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { adminEn } from '../../content/admin.en'
import type { User } from '../../data/mock/types'
import { deleteBlockers } from '../../lib/userAdmin'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { IconButton } from '../ui/IconButton'
import { blockerMessage } from './blockerMessages'

interface DeleteUserButtonProps {
  user: User
  /** After the user was deleted; `message` is "{name} deleted.". */
  onDeleted: (message: string) => void
  /** Deleting was refused (their own account, or the last admin): the title and the reasons. */
  onRefused: (title: string, reasons: string[]) => void
}

/**
 * The Trash icon button of Delete User (the Users list and a user's page). It always opens the
 * warning dialog; Delete then removes the user in this browser, unless the rules refuse it
 * (lib/userAdmin.ts deleteBlockers). Focus returns to the button when the dialog is cancelled.
 */
export function DeleteUserButton({ user, onDeleted, onRefused }: DeleteUserButtonProps) {
  const text = adminEn.deleteUser
  const admin = useCurrentUser()
  const { activeUsers, deleteUser } = useUsers()
  const { sops } = useSops()
  const [confirming, setConfirming] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  function confirm() {
    setConfirming(false)
    const rules = { actorId: admin.id, users: activeUsers, sops }
    const blockers = deleteBlockers(user, rules)
    if (blockers.length > 0) {
      onRefused(text.refused.replace('{name}', user.name), blockers.map((blocker) => blockerMessage(blocker, user, adminEn.userDetails.blockers, false)))
      return
    }
    deleteUser(user.id, rules)
    onDeleted(text.done.replace('{name}', user.name))
  }

  return (
    <>
      <IconButton ref={buttonRef} label={text.button.replace('{name}', user.name)} icon={Trash2} danger onClick={() => setConfirming(true)} />
      <ConfirmDialog
        open={confirming}
        danger
        title={text.title}
        description={text.description.replace('{name}', user.name)}
        cancelLabel={text.cancel}
        confirmLabel={text.confirm}
        onConfirm={confirm}
        onCancel={() => {
          setConfirming(false)
          buttonRef.current?.focus()
        }}
      />
    </>
  )
}
