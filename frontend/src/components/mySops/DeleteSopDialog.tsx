import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MySopsContent } from '../../content/types'
import { REVIEW_TEXT_MAX } from '../../lib/internalReview'
import { deleteErrorText } from '../../lib/mySops'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'

interface DeleteSopDialogProps {
  /** The SOP's title (the dialog's title). */
  title: string
  content: MySopsContent['deleteSop']
  /** Deletes the SOP with the trimmed justification; throws when refused. */
  onConfirm: (reason: string) => Promise<void>
  /** Called whenever the dialog closes (cancelled, or after the delete). */
  onClose: () => void
}

/**
 * The main author confirms permanently deleting an SOP, with a required justification.
 * Focus starts on the Justification field; while deleting, the dialog can't be closed or
 * submitted again. A refusal is shown in the dialog and the SOP stays.
 */
export function DeleteSopDialog({ title, content, onConfirm, onClose }: DeleteSopDialogProps) {
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState('')
  const [error, setError] = useState('')
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  async function confirm() {
    if (!reason.trim()) {
      flushSync(() => setReasonError(content.justificationRequired))
      reasonRef.current?.focus()
      return false
    }
    setError('')
    try {
      await onConfirm(reason.trim())
    } catch (failure) {
      setError(deleteErrorText(failure, content))
      return false
    }
  }

  return (
    <FormDialog
      open
      title={content.title.replace('{title}', title)}
      description={content.warning}
      confirmLabel={content.confirm}
      cancelLabel={content.cancel}
      confirmVariant="danger"
      busyLabel={content.deleting}
      lockWhileBusy
      onConfirm={confirm}
      onClose={onClose}
    >
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
      <TextAreaField
        ref={reasonRef}
        name="deleteJustification"
        label={content.justificationLabel}
        required
        requiredMark
        rows={4}
        maxLength={REVIEW_TEXT_MAX}
        error={reasonError || undefined}
        value={reason}
        onChange={(event) => { setReason(event.target.value); setReasonError(''); setError('') }}
      />
    </FormDialog>
  )
}
