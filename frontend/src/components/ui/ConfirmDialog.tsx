import { useEffect, useId, useRef, type KeyboardEvent } from 'react'
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
}

/**
 * Modal confirmation built on the native <dialog> (showModal): dims the page,
 * makes it inert, closes on Escape. Focus starts on the safe choice and Tab
 * wraps between the two buttons. The caller decides where focus goes afterwards.
 */
export function ConfirmDialog({ open, title, description, cancelLabel, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
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
          <h2 id={titleId} className="text-lg">
            {title}
          </h2>
          <p id={descriptionId} className="mt-2 text-text-gray">
            {description}
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" autoFocus onClick={() => dialogRef.current?.close()}>
              {cancelLabel}
            </Button>
            <Button
              onClick={() => {
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
