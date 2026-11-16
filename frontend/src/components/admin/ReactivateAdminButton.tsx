import { useRef, useState } from 'react'
import { LoaderCircle, RotateCcw } from 'lucide-react'
import { adminsEn } from '../../content/admins.en'
import type { User } from '../../data/mock/types'
import { ReactivateAdminError } from '../../services/admins'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { IconButton } from '../ui/IconButton'

interface ReactivateAdminButtonProps {
  admin: User
  /** After the server reactivated them; `message` is adminsEn.reactivate.done. */
  onReactivated: (message: string) => void
  /** The server refused: the title and the reason. Nothing changed. */
  onRefused: (title: string, reasons: string[]) => void
  /** A visible label (a deleted Admin's page): a maroon filled button instead of the icon-only button. */
  labeled?: boolean
}

/**
 * Reactivate for a deleted Admin, shown only to the Super Admin: in the last column of the Deactivated Admins tab
 * (where Active Admins has Delete) and on the deleted Admin's page. The same layout as Reactivate Staff: it asks
 * first; Reactivate then makes ONE server call (reactivate_admin), which checks again that the caller is the
 * Super Admin. Nothing changes on screen until the server has done it; meanwhile another press does nothing.
 */
export function ReactivateAdminButton({ admin, onReactivated, onRefused, labeled = false }: ReactivateAdminButtonProps) {
  const text = adminsEn.reactivate
  const { reactivateAdmin } = useUsers()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const named = (line: string) => line.replace('{name}', admin.name)

  async function confirm() {
    setConfirming(false)
    if (pending.current) return
    pending.current = true
    setBusy(true)
    buttonRef.current?.focus()
    try {
      await reactivateAdmin(admin.id)
    } catch (error) {
      onRefused(named(text.refused), [text.failures[error instanceof ReactivateAdminError ? error.reason : 'failed']])
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
