import { useEffect, useId, useRef } from 'react'
import { X } from 'lucide-react'
import { PdfViewer } from '../sops/PdfViewer'

interface PreviewDialogProps {
  /** Heading, e.g. "SOP-081 · v2". */
  title: string
  url: string
  /** Accessible name of the embedded viewer. */
  viewerTitle: string
  closeLabel: string
  fallback: { text: string; openPdf: string; newTabHint: string }
  /** Called whenever the dialog closes (Close, Escape or backdrop); the caller returns focus. */
  onClose: () => void
}

/**
 * A large modal with the PDF of one version, built on the native <dialog> like the
 * other dialogs: dims and inerts the page and closes on Escape. Focus starts on Close.
 */
export function PreviewDialog({ title, url, viewerTitle, closeLabel, fallback, onClose }: PreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) {
      dialog.showModal()
      closeRef.current?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the dimmed backdrop targets the <dialog> itself.
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto rounded-xl border border-beige bg-white p-0 shadow-xl backdrop:bg-maroon/40"
    >
      <div className="flex items-center justify-between gap-3 border-b border-beige px-5 py-3">
        <h2 id={titleId} className="min-w-0 text-lg break-words">
          {title}
        </h2>
        <button
          ref={closeRef}
          type="button"
          aria-label={closeLabel}
          onClick={() => dialogRef.current?.close()}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-beige text-maroon transition-colors hover:bg-beige"
        >
          <X aria-hidden="true" className="size-4" strokeWidth={2} />
        </button>
      </div>
      <div className="p-3 sm:p-4">
        <PdfViewer url={url} title={viewerTitle} fallback={fallback} />
      </div>
    </dialog>
  )
}
