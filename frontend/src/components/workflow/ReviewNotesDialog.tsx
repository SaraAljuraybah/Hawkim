import { useEffect, useId, useRef } from 'react'
import { formatReviewDate } from '../../lib/format'
import type { ReviewNote } from '../../lib/reviewRequestRows'
import { Button } from '../ui/Button'

interface ReviewNotesDialogProps {
  title: string
  notes: ReviewNote[]
  labels: Record<ReviewNote['kind'], string>
  closeLabel: string
  /** Called whenever the dialog closes (Close, Escape or backdrop); the caller returns focus. */
  onClose: () => void
}

/**
 * A small read-only modal with a reviewer's comments and reasons, built on the native <dialog>
 * like the other dialogs: dims and inerts the page and closes on Escape. Focus starts on Close.
 */
export function ReviewNotesDialog({ title, notes, labels, closeLabel, onClose }: ReviewNotesDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  // showModal focuses the first control, which is Close.
  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      // A click on the dimmed backdrop targets the <dialog> itself.
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-beige bg-white p-5 shadow-xl backdrop:bg-maroon/40 sm:p-6"
    >
      <h2 id={titleId} className="text-lg break-words">
        {title}
      </h2>
      <dl className="mt-4 space-y-4 text-sm">
        {notes.map((note) => (
          <div key={note.kind}>
            <dt className="font-medium text-maroon">{labels[note.kind]}</dt>
            {note.date && (
              <dd className="text-text-gray">
                <time dateTime={note.date}>{formatReviewDate(note.date)}</time>
              </dd>
            )}
            <dd className="mt-1 whitespace-pre-wrap break-words text-maroon">{note.text}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex justify-end">
        <Button size="sm" variant="secondary" onClick={() => dialogRef.current?.close()}>
          {closeLabel}
        </Button>
      </div>
    </dialog>
  )
}
