import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { SopWorkflowContent } from '../../content/types'
import { RESPONSE_MAX } from '../../lib/workflow'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'

interface ResponseDialogProps {
  content: SopWorkflowContent['dialogs']
  /** Who receives the response, e.g. "Noura Alqahtani (Reviewer)". */
  recipients: string
  onSubmit: (text: string) => void
  onClose: () => void
}

/** Response: the author or a co-author replies to the latest round of comments (required, up to 1000 characters). */
export function ResponseDialog({ content, recipients, onSubmit, onClose }: ResponseDialogProps) {
  const text = content.response
  const [response, setResponse] = useState('')
  const [error, setError] = useState<string>()
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  return (
    <FormDialog
      open
      title={text.title}
      description={text.description.replace('{names}', recipients)}
      confirmLabel={text.confirm}
      cancelLabel={content.cancel}
      onClose={onClose}
      onConfirm={() => {
        if (!response.trim()) {
          flushSync(() => setError(text.required))
          fieldRef.current?.focus()
          return false
        }
        onSubmit(response.trim())
      }}
    >
      <TextAreaField
        ref={fieldRef}
        name="response"
        rows={5}
        label={text.label}
        required
        maxLength={RESPONSE_MAX}
        counter={text.counter.replace('{count}', String(response.length)).replace('{max}', String(RESPONSE_MAX))}
        value={response}
        error={error}
        onChange={(event) => {
          setResponse(event.target.value)
          if (error) setError(undefined)
        }}
      />
    </FormDialog>
  )
}
