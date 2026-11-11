import { useRef, useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { adminEn } from '../../content/admin.en'
import type { User } from '../../data/mock/types'
import { deleteBlockers, responsibilitiesInProgress } from '../../lib/userAdmin'
import { DeactivateStaffError } from '../../services/people'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { IconButton } from '../ui/IconButton'
import { blockerMessage } from './blockerMessages'

interface DeleteUserButtonProps {
  user: User
  /** After the server deactivated the user; `message` is "{name} deactivated successfully.". */
  onDeleted: (message: string) => void
  /** Deactivating was refused (their own account, SOP work in progress, or by the server): the title and the reasons. */
  onRefused: (title: string, reasons: string[]) => void
  /**
   * A visible label (e.g. "Delete Staff" on a staff member's page): a maroon filled button (like Add Admin) with the
   * Trash icon and this text, instead of the icon-only button. While saving it shows `busyLabel`.
   */
  label?: string
  busyLabel?: string
}

/**
 * The Trash icon button of Delete Staff (the Staff list and a staff member's page). It always opens the
 * warning dialog; Deactivate then deactivates the staff member in the database (deactivate_staff): they
 * lose access to Hawkim, and their account and history are kept. Nothing changes on screen until the
 * server has done it; meanwhile the button can't be pressed again. Refused (here, by lib/userAdmin.ts
 * deleteBlockers and the SOP work count the database also uses, or by the server): onRefused explains
 * why and nothing changes. Focus returns to the button when the dialog is cancelled, and stays on it
 * while saving.
 */
export function DeleteUserButton({ user, onDeleted, onRefused, label, busyLabel }: DeleteUserButtonProps) {
  const text = adminEn.deleteUser
  const admin = useCurrentUser()
  const { activeUsers, deleteUser } = useUsers()
  const { sops } = useSops()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const refusedTitle = text.refused.replace('{name}', user.name)
  const inProgress = (count: number) =>
    (count === 1 ? text.inProgress.one : text.inProgress.other).replace('{name}', user.name).replace('{count}', String(count))

  /** What to say about a deactivation the server refused. */
  function failureMessage(error: unknown): string {
    if (!(error instanceof DeactivateStaffError)) return text.failures.failed
    if (error.reason === 'responsibilities-in-progress') return inProgress(error.blockingSops || 1)
    return text.failures[error.reason]
  }

  async function confirm() {
    setConfirming(false)
    if (busy) return
    const rules = { actorId: admin.id, users: activeUsers, sops }
    const blockers = deleteBlockers(user, rules)
    if (blockers.length > 0) {
      onRefused(refusedTitle, blockers.map((blocker) => blockerMessage(blocker, user, adminEn.userDetails.blockers, false)))
      return
    }
    // The database refuses it too (deactivate_staff); this explains it without a round trip.
    const work = responsibilitiesInProgress(user, sops)
    if (work.total > 0) {
      onRefused(refusedTitle, [inProgress(work.total)])
      return
    }
    setBusy(true)
    buttonRef.current?.focus()
    try {
      await deleteUser(user.id, rules)
    } catch (error) {
      setBusy(false)
      onRefused(refusedTitle, [failureMessage(error)])
      return
    }
    onDeleted(text.done.replace('{name}', user.name))
  }

  return (
    <>
      {label ? (
        <Button ref={buttonRef} aria-disabled={busy || undefined} onClick={() => !busy && setConfirming(true)}>
          {busy
            ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
            : <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          {busy ? (busyLabel ?? label) : label}
        </Button>
      ) : (
        <IconButton
          ref={buttonRef}
          label={text.button.replace('{name}', user.name)}
          icon={Trash2}
          danger
          disabledReason={busy ? text.busy.replace('{name}', user.name) : undefined}
          onClick={() => setConfirming(true)}
        />
      )}
      <ConfirmDialog
        open={confirming}
        title={text.title}
        description={text.description.replace('{name}', user.name)}
        cancelLabel={text.cancel}
        confirmLabel={text.confirm}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setConfirming(false)
          buttonRef.current?.focus()
        }}
      />
    </>
  )
}
