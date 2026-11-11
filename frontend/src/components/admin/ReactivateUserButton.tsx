import { useRef, useState } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import { adminEn } from '../../content/admin.en'
import type { User } from '../../data/mock/types'
import { ReactivateStaffError } from '../../services/people'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { IconButton } from '../ui/IconButton'

interface ReactivateUserButtonProps {
  user: User
  /** After the server reactivated them; `message` is adminEn.reactivateUser.done. */
  onReactivated: (message: string) => void
  /** The server refused: the title and the reason. Nothing changed. */
  onRefused: (title: string, reasons: string[]) => void
  /** A visible label (a staff member's page, Edit Staff): a maroon filled button instead of the icon-only button. */
  labeled?: boolean
}

/**
 * Reactivate for a deactivated staff member, in the Action column of the Deactive Staff tab (where Active
 * Staff has Delete), on their page and on Edit Staff. It asks first, in the same layout as Delete; Reactivate
 * then makes ONE server call (reactivate_staff) that makes the same account active again with the permissions
 * and history it had. Nothing changes on screen until the server has done it; meanwhile another press does nothing.
 */
export function ReactivateUserButton({ user, onReactivated, onRefused, labeled = false }: ReactivateUserButtonProps) {
  const text = adminEn.reactivateUser
  const { reactivateUser } = useUsers()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const named = (line: string) => line.replace('{name}', user.name)

  async function confirm() {
    setConfirming(false)
    if (pending.current) return
    pending.current = true
    setBusy(true)
    buttonRef.current?.focus()
    try {
      await reactivateUser(user.id)
    } catch (error) {
      onRefused(named(text.refused), [text.failures[error instanceof ReactivateStaffError ? error.reason : 'failed']])
      return
    } finally {
      pending.current = false
      setBusy(false)
    }
    onReactivated(named(text.done))
  }

  return (
    <>
      {labeled ? (
        <Button ref={buttonRef} aria-disabled={busy || undefined} onClick={() => !busy && setConfirming(true)}>
          {busy
            ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
            : <RotateCcw aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          {busy ? named(text.busy) : text.label}
        </Button>
      ) : (
        <IconButton
          ref={buttonRef}
          label={named(text.button)}
          icon={RotateCcw}
          disabledReason={busy ? named(text.busy) : undefined}
          onClick={() => setConfirming(true)}
        />
      )}
      <ConfirmDialog
        open={confirming}
        prominent
        title={named(text.title)}
        description={text.description}
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
