import { useRef, useState } from 'react'
import { Send, XCircle } from 'lucide-react'
import { adminEn } from '../../content/admin.en'
import type { User } from '../../data/mock/types'
import { resendMessage } from '../../lib/invitations'
import type { CancelInvitationFailure, ResendFailureReason } from '../../services/invitations'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { IconButton } from '../ui/IconButton'

const text = adminEn.usersList.invitations

interface ResendInvitationButtonProps {
  user: User
  /** Expired: the button works; still Sent: it stays visible, disabled, with the reason as its tooltip. */
  expired: boolean
  resend: (userId: string) => Promise<{ ok: true; email: string } | { ok: false; reason: ResendFailureReason }>
  onSent: (message: string) => void
  onRefused: (title: string, reasons: string[], reason: ResendFailureReason) => void
}

/**
 * Resend on a Sent Invitations row (no confirmation): ONE call to the resend-invitation Edge Function, which
 * makes a new link (the old one stops working) and emails it; the Sent Date and the 24 hours start again.
 * While it runs the button shows a loader and another press does nothing; on failure nothing changes.
 */
export function ResendInvitationButton({ user, expired, resend, onSent, onRefused }: ResendInvitationButtonProps) {
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const named = (line: string) => line.replace('{name}', user.name)

  async function send() {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      const result = await resend(user.id)
      const message = resendMessage(result, { name: user.name, email: user.email })
      if (result.ok) onSent(message)
      else onRefused(named(text.resendRefused), [message], result.reason)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <IconButton
      label={named(text.actions.resend)}
      icon={Send}
      busy={busy}
      disabledReason={busy ? named(text.actions.resending) : expired ? undefined : text.actions.resendUnavailable}
      onClick={() => void send()}
    />
  )
}

interface CancelInvitationButtonProps {
  user: User
  cancel: (userId: string) => Promise<{ ok: true } | { ok: false; reason: CancelInvitationFailure }>
  onCancelled: (message: string) => void
  onRefused: (title: string, reasons: string[], reason: CancelInvitationFailure) => void
}

/**
 * Cancel Invitation on a Sent Invitations row: asks first (the same dialog as Delete Staff), then ONE call to
 * the cancel-invitation Edge Function. The link stops working and the person can't sign in; their staff
 * information is kept and they aren't deactivated. Nothing changes on screen until the server has done it.
 */
export function CancelInvitationButton({ user, cancel, onCancelled, onRefused }: CancelInvitationButtonProps) {
  const dialog = text.cancel
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
    let result: Awaited<ReturnType<typeof cancel>>
    try {
      result = await cancel(user.id)
    } finally {
      pending.current = false
      setBusy(false)
    }
    if (result.ok) onCancelled(named(dialog.done))
    else onRefused(named(dialog.refused), [named(dialog.failures[result.reason])], result.reason)
  }

  return (
    <>
      <IconButton
        ref={buttonRef}
        label={named(text.actions.cancel)}
        icon={XCircle}
        danger
        busy={busy}
        disabledReason={busy ? named(text.actions.cancelling) : undefined}
        onClick={() => setConfirming(true)}
      />
      <ConfirmDialog
        open={confirming}
        prominent
        title={named(dialog.title)}
        description={dialog.description}
        cancelLabel={dialog.keep}
        confirmLabel={dialog.confirm}
        onConfirm={() => void confirm()}
        onCancel={() => {
          setConfirming(false)
          buttonRef.current?.focus()
        }}
      >
        <ul className="mt-3 list-disc space-y-1.5 pl-5">
          {dialog.consequences.map((line) => <li key={line}>{named(line)}</li>)}
        </ul>
      </ConfirmDialog>
    </>
  )
}
