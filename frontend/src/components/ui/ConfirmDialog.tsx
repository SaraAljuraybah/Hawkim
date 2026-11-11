import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Button } from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  /** Label of the safe choice (focused first). */
  cancelLabel: string
  /** Label of the confirming action. */
  confirmLabel: string
  onConfirm: () => void
  /** Called when the dialog closes without confirming (cancel button, Escape, backdrop). */
  onCancel: () => void
  /**
   * Checked when the confirming action is pressed, before the dialog closes: return false to keep
   * it open (e.g. to show an `error`); onConfirm then isn't called.
   */
  canConfirm?: () => boolean
  /** Why the action can't be done, shown in the dialog as an alert. */
  error?: string
  /** More of the message under the description (e.g. a list); read with it. */
  children?: ReactNode
  /**
   * A larger title over smaller (14px) message text, all left-aligned: for a consequential action whose
   * message lists what happens (Delete and Reactivate on Staff).
   */
  prominent?: boolean
}

/**
 * Modal confirmation built on the native <dialog> (showModal): dims the page,
 * makes it inert, closes on Escape. Focus starts on the safe choice and Tab
 * wraps between the two buttons. The caller decides where focus goes afterwards.
 */
export function ConfirmDialog({ open, title, description, cancelLabel, confirmLabel, onConfirm, onCancel, canConfirm, error, children, prominent = false }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const confirmedRef = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      confirmedRef.current = false
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  function handleClose() {
    if (confirmedRef.current) onConfirm()
    else onCancel()
  }

  // Keep Tab / Shift+Tab inside the dialog.
  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const buttons = dialogRef.current.querySelectorAll<HTMLButtonElement>('button')
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={handleClose}
      onKeyDown={handleKeyDown}
      // A click on the dimmed backdrop targets the <dialog> itself.
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-beige bg-white p-0 shadow-xl backdrop:bg-maroon/40"
    >
      {open && (
        <div className="p-6">
          <h2 id={titleId} className={prominent ? 'text-left text-xl break-words sm:text-2xl' : 'text-lg'}>
            {title}
          </h2>
          <div id={descriptionId} className={prominent ? 'mt-3 text-left text-sm text-text-gray' : 'mt-2 text-text-gray'}>
            <p>{description}</p>
            {children}
          </div>
          {/* Stays mounted while open, so a refusal is announced */}
          <div role="alert">{error && <p className="mt-3 text-sm font-medium text-status-rejected-fg">{error}</p>}</div>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" autoFocus onClick={() => dialogRef.current?.close()}>
              {cancelLabel}
            </Button>
            <Button
              onClick={() => {
                if (canConfirm && !canConfirm()) return
                confirmedRef.current = true
                dialogRef.current?.close()
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      )}
    </dialog>
  )
}
