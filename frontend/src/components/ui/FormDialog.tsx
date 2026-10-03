import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { Button } from './Button'

interface FormDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel: string
  cancelLabel: string
  /**
   * Called when the form is submitted. Return false to keep the dialog open
   * (e.g. when a field is invalid); it may also be async (shows a busy state).
   */
  onConfirm: () => boolean | void | Promise<boolean | void>
  /** Called whenever the dialog closes (cancel, Escape, backdrop or after confirming). */
  onClose: () => void
  children?: ReactNode
}

/**
 * Modal dialog with form fields, built on the native <dialog> (showModal), like
 * ConfirmDialog: dims and inerts the page, closes on Escape, keeps Tab inside, and
 * focuses the first field. The caller returns focus to the button that opened it.
 */
export function FormDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  children,
}: FormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const result = await onConfirm()
      if (result !== false) dialogRef.current?.close()
    } finally {
      setBusy(false)
    }
  }

  // Keep Tab / Shift+Tab inside the dialog.
  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [
      ...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), select, textarea, input:not([tabindex="-1"]), a[href]'),
    ].filter((element) => !element.hasAttribute('aria-hidden'))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
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
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      // A click on the dimmed backdrop targets the <dialog> itself.
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-beige bg-white p-0 shadow-xl backdrop:bg-maroon/40"
    >
      {open && (
        <form noValidate onSubmit={handleSubmit} className="p-6">
          <h2 id={titleId} className="text-lg">
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className="mt-2 text-text-gray">
              {description}
            </p>
          )}
          {children && <div className="mt-5 space-y-5">{children}</div>}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
              {cancelLabel}
            </Button>
            <Button type="submit" aria-disabled={busy || undefined}>
              {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
              {confirmLabel}
            </Button>
          </div>
        </form>
      )}
    </dialog>
  )
}
