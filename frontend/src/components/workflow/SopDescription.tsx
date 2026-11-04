import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { flushSync } from 'react-dom'
import { LoaderCircle, Pencil } from 'lucide-react'
import type { SopWorkflowContent } from '../../content/types'
import { SOP_DESCRIPTION_MAX } from '../../lib/sopDescription'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { TextAreaField } from '../ui/TextAreaField'

interface SopDescriptionProps {
  description?: string
  content: SopWorkflowContent['description']
  /** Given only to the main author before publishing: shows the Edit Description button. */
  onSave?: (text: string) => Promise<void>
  /** Called after a save, once focus is back on the edit button (e.g. to announce it). */
  onSaved?: () => void
}

/**
 * The SOP description under the title, in body text at a reading width, with the edit
 * button at the right end of the row. Nothing is shown when it's empty.
 */
export function SopDescription({ description = '', content, onSave, onSaved }: SopDescriptionProps) {
  const text = description.trim()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const editRef = useRef<HTMLButtonElement>(null)
  const fieldRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) return
    const field = fieldRef.current
    field?.focus()
    field?.setSelectionRange(field.value.length, field.value.length)
  }, [editing])

  if (!text && !editing) return null

  function startEditing() {
    setDraft(text)
    setError('')
    setEditing(true)
  }

  function close() {
    flushSync(() => setEditing(false))
    editRef.current?.focus()
  }

  async function save() {
    if (saving || !onSave) return
    if (draft.trim() === text) return close()
    setSaving(true)
    setError('')
    try {
      await onSave(draft)
      close()
      onSaved?.()
    } catch {
      setError(content.failed)
    } finally {
      setSaving(false)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && !saving) {
      event.stopPropagation()
      close()
    }
  }

  if (editing) {
    return (
      <div className="mt-3" onKeyDown={onKeyDown}>
        <TextAreaField
          ref={fieldRef}
          name="description"
          label={content.label}
          maxLength={SOP_DESCRIPTION_MAX}
          counter={content.counter.replace('{count}', String(draft.length)).replace('{max}', String(SOP_DESCRIPTION_MAX))}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-status-rejected-fg">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" aria-disabled={saving || undefined} onClick={save}>
            {saving && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />}
            {content.save}
          </Button>
          <Button size="sm" variant="secondary" aria-disabled={saving || undefined} onClick={() => !saving && close()}>
            {content.cancel}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="max-w-prose leading-relaxed whitespace-pre-wrap break-words text-maroon">{text}</p>
      </div>
      {onSave && (
        // From md up, the same width and right offset as the Preview column of the SOP History
        // table below (card border and padding, then the Download and Delete columns), so the icons line up.
        <span className="flex shrink-0 justify-end md:mr-[calc(11.5rem+1px)] md:w-20 md:justify-center">
          <IconButton ref={editRef} label={content.edit} icon={Pencil} onClick={startEditing} />
        </span>
      )}
    </div>
  )
}
