import { useRef, useState } from 'react'
import { LoaderCircle, Trash2 } from 'lucide-react'
import { adminsEn } from '../../content/admins.en'
import type { User } from '../../data/mock/types'
import { AdminActionError } from '../../services/admins'
import { useUsers } from '../../state/usersContext'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { IconButton } from '../ui/IconButton'

interface DeleteAdminButtonProps {
  admin: User
  /** After the server deleted them; `message` is "{name} deleted.". */
  onDeleted: (message: string) => void
  /** The server refused: the title and the reason. */
  onFailed: (title: string, reasons: string[]) => void
  /** Show "Delete Admin" beside the Trash icon (an Admin's page), instead of the icon-only button (the list). */
  labeled?: boolean
}

/**
 * Delete Admin's Trash button, shown only to the Super Admin for a regular Admin. It asks first,
 * naming the person; the server then checks again that the caller is the Super Admin and the target
 * isn't. While it runs, another press does nothing.
 */
export function DeleteAdminButton({ admin, onDeleted, onFailed, labeled = false }: DeleteAdminButtonProps) {
  const text = adminsEn.delete
  const { deleteAdmin } = useUsers()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  async function confirm() {
    setConfirming(false)
    if (busy) return
    setBusy(true)
    try {
      await deleteAdmin(admin.id)
    } catch (error) {
      setBusy(false)
      onFailed(text.notDeleted, [adminsEn.failures[error instanceof AdminActionError ? error.reason : 'failed']])
      return
    }
    onDeleted(text.done.replace('{name}', admin.name))
  }

  return (
    <>
      {labeled ? (
        <Button ref={buttonRef} variant="burgundy" size="sm" aria-disabled={busy || undefined} onClick={() => !busy && setConfirming(true)}>
          {busy
            ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
            : <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />}
          {busy ? text.deleting : text.label}
        </Button>
      ) : (
        <IconButton
          ref={buttonRef}
          label={text.button.replace('{name}', admin.name)}
          icon={Trash2}
          danger
          disabledReason={busy ? text.deleting : undefined}
          onClick={() => setConfirming(true)}
        />
      )}
      <ConfirmDialog
        open={confirming}
        title={text.title}
        description={text.description.replace('{name}', admin.name).replace('{email}', admin.email)}
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
