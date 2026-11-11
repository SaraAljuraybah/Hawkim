import { useRef, useState } from 'react'
import { Crown, LoaderCircle } from 'lucide-react'
import { adminsEn } from '../../content/admins.en'
import type { User } from '../../data/mock/types'
import { AdminActionError, transferSuperAdmin } from '../../services/admins'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'

interface MakeSuperAdminButtonProps {
  admin: User
  /** After the server moved the role; `superAdminId` is the new Super Admin's id. */
  onTransferred: (superAdminId: string, message: string) => void
  /** The server refused: the title and the reason. Nothing changed. */
  onFailed: (title: string, reasons: string[]) => void
}

/**
 * Make Super Admin, on a regular Admin's page and shown only to the Super Admin. It asks first
 * (Transfer Super Admin Role?); Cancel, Escape or the backdrop change nothing. Confirm Transfer makes
 * ONE server call that moves the role atomically and checks, at that moment, that the caller is still
 * the Super Admin and the recipient an active Admin. While it runs, another press does nothing.
 */
export function MakeSuperAdminButton({ admin, onTransferred, onFailed }: MakeSuperAdminButtonProps) {
  const text = adminsEn.transfer
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const named = (line: string) => line.replace('{name}', admin.name)

  async function confirm() {
    setConfirming(false)
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const superAdminId = await transferSuperAdmin(admin.id)
      onTransferred(superAdminId, named(text.done))
    } catch (error) {
      onFailed(text.notTransferred, [adminsEn.failures[error instanceof AdminActionError ? error.reason : 'failed']])
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <>
      <Button aria-disabled={busy || undefined} onClick={() => !busy && setConfirming(true)}>
        {busy
          ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
          : <Crown aria-hidden="true" className="size-4 text-gold" strokeWidth={1.75} />}
        {busy ? text.transferring : text.button}
      </Button>
      <ConfirmDialog
        open={confirming}
        title={text.title}
        description={named(text.intro)}
        cancelLabel={text.cancel}
        confirmLabel={text.confirm}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      >
        <p className="mt-3">{text.proceed}</p>
        <ul className="mt-1.5 list-disc space-y-1 pl-5">
          {text.consequences.map((line) => <li key={line}>{named(line)}</li>)}
        </ul>
        <p className="mt-3">{text.effect}</p>
      </ConfirmDialog>
    </>
  )
}
