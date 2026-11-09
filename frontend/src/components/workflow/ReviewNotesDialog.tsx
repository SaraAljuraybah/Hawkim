import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { sopWorkflowEn } from '../../content/workflow.en'
import { formatReviewDate } from '../../lib/format'
import { responseFailure, type ReviewNote } from '../../lib/reviewRequestRows'
import { RESPONSE_MAX } from '../../lib/workflow'
import { Button } from '../ui/Button'
import { TextAreaField } from '../ui/TextAreaField'

interface ReviewNotesDialogProps {
  title: string
  notes: ReviewNote[]
  labels: Record<ReviewNote['kind'], string>
  closeLabel: string
  /** Offers Response. Left out when this reviewer can't be responded to. */
  response?: {
    /** Who receives it, e.g. "Noura Alqahtani (Reviewer)". */
    recipients: string
    /** Saves the response; if it throws, the dialog stays open and says so. */
    onSend: (text: string) => Promise<void>
  }
  /** Called whenever the dialog closes (Close, Escape or backdrop); the caller returns focus. */
  onClose: () => void
}

/**
 * A small modal with a reviewer's comments and reasons, built on the native <dialog> like the
 * other dialogs: dims and inerts the page, closes on Escape and keeps Tab inside. Focus starts on
 * the first button. Response opens a text area below the comments, which stay visible.
 */
export function ReviewNotesDialog({ title, notes, labels, closeLabel, response, onClose }: ReviewNotesDialogProps) {
  const text = sopWorkflowEn.dialogs.response
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const recipientsId = useId()
  const [responding, setResponding] = useState(false)
  const [reply, setReply] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const dialog = dialogRef.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  useEffect(() => {
    if (responding) fieldRef.current?.focus()
  }, [responding])

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !response) return
    if (!reply.trim()) {
      flushSync(() => setError(text.required))
      fieldRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await response.onSend(reply.trim())
      dialogRef.current?.close()
    } catch (caught) {
      flushSync(() => setError(text[responseFailure(caught)]))
      fieldRef.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  // Keep Tab / Shift+Tab inside the dialog.
  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, textarea')
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
      onClose={onClose}
      onKeyDown={handleKeyDown}
      // A click on the dimmed backdrop targets the <dialog> itself.
      onClick={(event) => event.target === dialogRef.current && dialogRef.current?.close()}
      className={`m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] ${responding ? 'max-w-xl' : 'max-w-md'} overflow-y-auto rounded-xl border border-beige bg-white p-5 shadow-xl backdrop:bg-maroon/40 sm:p-6`}
    >
      <form noValidate onSubmit={send}>
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
        {responding && response && (
          <div className="mt-5 space-y-3">
            <p id={recipientsId} className="text-sm text-text-gray">
              {text.description.replace('{names}', response.recipients)}
            </p>
            <TextAreaField
              ref={fieldRef}
              name="response"
              rows={5}
              label={text.label}
              required
              maxLength={RESPONSE_MAX}
              aria-describedby={recipientsId}
              counter={text.counter.replace('{count}', String(reply.length)).replace('{max}', String(RESPONSE_MAX))}
              value={reply}
              error={error}
              onChange={(event) => {
                setReply(event.target.value)
                if (error) setError(undefined)
              }}
            />
          </div>
        )}
        {/* A refused response can reload the SOP and take the form away: the reason stays. */}
        {error && !response && <p role="alert" className="mt-4 text-sm text-status-rejected-fg">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button size="sm" onClick={() => dialogRef.current?.close()}>
            {closeLabel}
          </Button>
          {/* Keys keep these two separate buttons: reusing one as it turns into submit would send the form on the same click. */}
          {response && !responding && (
            <Button key="response" size="sm" onClick={() => setResponding(true)}>
              {text.label}
            </Button>
          )}
          {response && responding && (
            <Button key="send" size="sm" type="submit" aria-disabled={busy || undefined}>
              {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
              {text.confirm}
            </Button>
          )}
        </div>
      </form>
    </dialog>
  )
}
