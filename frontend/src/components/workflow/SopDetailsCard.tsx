import { useRef, useState, type ReactNode } from 'react'
import { Pencil } from 'lucide-react'
import { sopWorkflowEn } from '../../content/workflow.en'
import type { Sop } from '../../data/mock/types'
import { formatDate, todayIsoDate } from '../../lib/format'
import { SOP_DESCRIPTION_MAX } from '../../lib/sopDescription'
import { SOP_TITLE_MAX, sopTitleProblem } from '../../lib/sopTitle'
import { Button } from '../ui/Button'
import { FormDialog } from '../ui/FormDialog'
import { TextAreaField } from '../ui/TextAreaField'
import { TextField } from '../ui/TextField'

interface SopDetailsCardProps {
  sop: Sop
  divisionName: string
  departmentName: string
  /** The main author before the SOP is published: Edit is offered. Saves the title and description only. */
  onSave?: (details: { title: string; description: string }) => Promise<void>
  /** After a successful save (the page announces it). */
  onSaved?: () => void
}

/**
 * SOP Details, the card right under Workflow status on the author's SOP page: Title, Description (in its own
 * white box, the full width of the card), Division, Department and Date Added, laid out like the other cards.
 * Long titles and descriptions wrap; the description keeps its line breaks. Only Title and Description can be
 * changed, with Edit (main author, until the SOP is published), in a dialog that saves through
 * update_sop_details: the status, reviewers, decisions and files never change. Division, Department and
 * Date Added are read-only. File upload stays in SOP history.
 */
export function SopDetailsCard({ sop, divisionName, departmentName, onSave, onSaved }: SopDetailsCardProps) {
  const text = sopWorkflowEn.details
  const [editing, setEditing] = useState(false)
  const editRef = useRef<HTMLButtonElement>(null)
  const description = sop.description?.trim()

  return (
    <section aria-labelledby="sop-details-title" className="mt-6 rounded-xl border border-beige bg-white p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id="sop-details-title" tabIndex={-1} className="scroll-mt-24 rounded-sm text-lg">{text.title}</h2>
        {onSave && (
          <Button ref={editRef} size="sm" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
            {text.edit}
          </Button>
        )}
      </div>
      <dl className="divide-y divide-beige">
        <Row label={text.fields.title}>{sop.title}</Row>
        {/* Label above value at every width, so the description box can use the card's full width. */}
        <div className="grid gap-2 py-3">
          <dt className="text-sm font-bold text-maroon">{text.fields.description}</dt>
          <dd className="min-w-0 rounded-lg border border-beige bg-white px-4 py-3 text-[0.9375rem] leading-relaxed break-words whitespace-pre-line text-maroon">
            {description || <span className="text-text-gray">{text.notProvided}</span>}
          </dd>
        </div>
        <Row label={text.fields.division}>{divisionName || text.notProvided}</Row>
        <Row label={text.fields.department}>{departmentName || text.notProvided}</Row>
        <Row label={text.fields.dateAdded}>
          {sop.createdAt
            ? <time dateTime={sop.createdAt}>{formatDate(todayIsoDate(new Date(sop.createdAt)))}</time>
            : text.notProvided}
        </Row>
      </dl>
      {editing && onSave && (
        <SopDetailsDialog
          sop={sop}
          onSave={onSave}
          onSaved={onSaved}
          onClose={() => {
            setEditing(false)
            editRef.current?.focus()
          }}
        />
      )}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline sm:gap-6">
      <dt className="text-sm font-bold text-maroon">{label}</dt>
      <dd className="min-w-0 text-base break-words text-maroon">{children}</dd>
    </div>
  )
}

/**
 * Edit SOP Details: the current Title (required, up to 50 characters, as when adding an SOP) and Description
 * (optional, up to 1000). Save Changes checks them first; a failed save keeps the dialog open with what was
 * typed and says so. Cancel, Escape and the backdrop discard the changes.
 */
function SopDetailsDialog({ sop, onSave, onSaved, onClose }: {
  sop: Sop
  onSave: (details: { title: string; description: string }) => Promise<void>
  onSaved?: () => void
  onClose: () => void
}) {
  const text = sopWorkflowEn.details
  const dialog = text.dialog
  const [title, setTitle] = useState(sop.title)
  const [description, setDescription] = useState(sop.description ?? '')
  const [errors, setErrors] = useState<{ title?: string; description?: string }>({})
  const [failed, setFailed] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  const count = (value: string, max: number) => dialog.counter.replace('{count}', String(value.length)).replace('{max}', String(max))

  function check() {
    const problem = sopTitleProblem(title)
    const next = {
      title: problem === 'required' ? dialog.errors.titleRequired : problem === 'too-long' ? dialog.errors.titleTooLong : undefined,
      description: description.trim().length > SOP_DESCRIPTION_MAX ? dialog.errors.descriptionTooLong : undefined,
    }
    setErrors(next)
    return next
  }

  async function save() {
    const found = check()
    if (found.title || found.description) {
      if (found.title) titleRef.current?.focus()
      else descriptionRef.current?.focus()
      return false
    }
    setFailed(false)
    try {
      await onSave({ title: title.trim(), description: description.trim() })
    } catch {
      // What was typed stays; the message is announced (role="alert").
      setFailed(true)
      return false
    }
    onSaved?.()
  }

  return (
    <FormDialog open title={dialog.title} description={dialog.description} cancelLabel={dialog.cancel}
      confirmLabel={dialog.save} busyLabel={dialog.saving} lockWhileBusy onConfirm={save} onClose={onClose}>
      <TextField
        ref={titleRef}
        name="sopTitle"
        label={text.fields.title}
        hint={dialog.titleHint}
        required
        requiredMark
        maxLength={SOP_TITLE_MAX}
        counter={count(title, SOP_TITLE_MAX)}
        value={title}
        error={errors.title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <TextAreaField
        ref={descriptionRef}
        name="sopDescription"
        label={text.fields.description}
        rows={6}
        maxLength={SOP_DESCRIPTION_MAX}
        counter={count(description, SOP_DESCRIPTION_MAX)}
        value={description}
        error={errors.description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div role="alert">
        {failed && <p className="text-sm font-medium text-status-rejected-fg">{dialog.failed}</p>}
      </div>
    </FormDialog>
  )
}
