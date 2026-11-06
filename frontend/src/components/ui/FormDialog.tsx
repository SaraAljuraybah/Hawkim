import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { Button } from './Button'

interface FormDialogProps {
  open: boolean
  title: string
  description?: ReactNode
  confirmLabel: string
  /** The cancel button's text. Leave it out for a dialog closed with × (see closeLabel). */
  cancelLabel?: string
  /** Accessible name of a × close button in the top-right corner, in place of the cancel button. */
  closeLabel?: string
  /**
   * Called when the form is submitted. Return false to keep the dialog open
   * (e.g. when a field is invalid); it may also be async (shows a busy state).
   */
  onConfirm: () => boolean | void | Promise<boolean | void>
  /** Called whenever the dialog closes (cancel, Escape, backdrop or after confirming). */
  onClose: () => void
  /** Decorative icon centred above the title, in a soft beige circle; the title and description are centred too. */
  icon?: ReactNode
  /** The confirm button's look: `danger` for a destructive action (e.g. Delete). Default primary. */
  confirmVariant?: 'primary' | 'danger'
  /** The confirm button's text while busy (e.g. "Deleting…"). Default: confirmLabel. */
  busyLabel?: string
  /** While busy, Cancel, ×, Escape and the backdrop don't close the dialog (it can't be left mid-action). */
  lockWhileBusy?: boolean
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
  closeLabel,
  onConfirm,
  onClose,
  icon,
  confirmVariant = 'primary',
  busyLabel,
  lockWhileBusy = false,
  children,
}: FormDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [busy, setBusy] = useState(false)
  const titleId = useId()
  const descriptionId = useId()
  const locked = lockWhileBusy && busy

  function close() {
    if (!locked) dialogRef.current?.close()
  }

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
      // Escape: kept open while locked.
      onCancel={(event) => locked && event.preventDefault()}
      onKeyDown={handleKeyDown}
      // A click on the dimmed backdrop targets the <dialog> itself.
      onClick={(event) => event.target === dialogRef.current && close()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-beige bg-white p-0 shadow-xl backdrop:bg-maroon/40"
    >
      {open && (
        <form noValidate onSubmit={handleSubmit} className="p-6">
          {icon && (
            <div aria-hidden="true" className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-beige text-maroon">
              {icon}
            </div>
          )}
          <h2 id={titleId} className={icon ? 'px-10 text-center text-lg' : closeLabel ? 'pr-10 text-lg' : 'text-lg'}>
            {title}
          </h2>
          {description && (
            <p id={descriptionId} className={icon ? 'mt-2 text-center text-text-gray' : 'mt-2 text-text-gray'}>
              {description}
            </p>
          )}
          {children && <div className="mt-5 space-y-5">{children}</div>}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {cancelLabel && (
              <Button variant="secondary" aria-disabled={locked || undefined} onClick={close}>
                {cancelLabel}
              </Button>
            )}
            <Button type="submit" variant={confirmVariant} aria-disabled={busy || undefined}>
              {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
              {busy && busyLabel ? busyLabel : confirmLabel}
            </Button>
          </div>
        </form>
      )}
      {/* After the form, so focus still starts on the first field. */}
      {open && closeLabel && (
        <button
          type="button"
          aria-label={closeLabel}
          aria-disabled={locked || undefined}
          onClick={close}
          className="absolute top-4 right-4 inline-flex size-9 items-center justify-center rounded-lg border border-beige text-maroon transition-colors hover:bg-beige"
        >
          <X aria-hidden="true" className="size-4" strokeWidth={2} />
        </button>
      )}
    </dialog>
  )
}
