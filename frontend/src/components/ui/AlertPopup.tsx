import type { KeyboardEvent } from 'react'
import { CircleAlert, X } from 'lucide-react'

interface AlertPopupProps {
  /** Give the field `aria-describedby={id}` so the message stays linked to it. */
  id: string
  message: string
  /** Accessible name of the close button, e.g. "Close message". */
  closeLabel: string
  onClose: () => void
}

/**
 * A small pop-up for a field's error, shown just below the field and over the content under it
 * (place it in a `relative` wrapper). It is announced at once (role="alert") and stays until the
 * user closes it or the caller clears the error. Escape on it closes only the pop-up, not a dialog.
 */
export function AlertPopup({ id, message, closeLabel, onClose }: AlertPopupProps) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  return (
    <div id={id} role="alert" onKeyDown={onKeyDown}
      className="absolute inset-x-0 top-full z-20 mt-1.5 flex items-start gap-2 rounded-lg border border-status-rejected-fg bg-white p-3 shadow-md">
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-rejected-fg" strokeWidth={1.75} />
      <p className="flex-1 text-sm text-maroon">{message}</p>
      <button type="button" aria-label={closeLabel} onClick={onClose}
        className="-my-1 -mr-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-maroon transition-colors hover:bg-beige">
        <X aria-hidden="true" className="size-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}
