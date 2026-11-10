import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Pencil, Pill } from 'lucide-react'
import { FormDialog } from '../ui/FormDialog'
import { IconButton } from '../ui/IconButton'
import { TextField } from '../ui/TextField'
import { organizationAdminEn } from '../../content/organizationAdmin.en'
import { organizationNameProblem, saveOrganizationName } from '../../services/organizationSettings'

const text = organizationAdminEn.organizationName

/**
 * The organization's name at the top of Divisions and Departments: a pill icon in a maroon circle, the
 * name with a thin gold line under it, and (for the Super Admin only) a pencil to edit it. Without a
 * name, the Super Admin sees "Organization name not set" with the pencil; everyone else sees nothing.
 * Not a heading: the page keeps its one h1 (the title below it).
 */
export function OrganizationBanner({ name, canEdit, onEdit }: { name: string | null; canEdit: boolean; onEdit: () => void }) {
  if (!name && !canEdit) return null
  return (
    <div className="mb-8 flex items-center gap-4">
      <span aria-hidden="true" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-maroon text-offwhite">
        <Pill className="size-6" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        {name ? (
          <p className="text-xl font-semibold break-words text-maroon sm:text-2xl">
            <span className="sr-only">{text.label}: </span>
            {name}
          </p>
        ) : (
          <p className="text-base text-text-gray">{text.notSet}</p>
        )}
        {/* Decoration only (no text in gold). */}
        <span aria-hidden="true" className="mt-2 block h-0.5 w-16 rounded-full bg-gold" />
      </div>
      {canEdit && <IconButton label={text.edit} icon={Pencil} onClick={onEdit} />}
    </div>
  )
}

/** Edit the organization's name, in the same dialog as Edit Division: one required field, trimmed, at most 200 characters. */
export function OrganizationNameForm({ name, onClose, onSaved }: { name: string | null; onClose: () => void; onSaved: (name: string) => void }) {
  const [value, setValue] = useState(name ?? '')
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const problem = organizationNameProblem(value)
  const invalid = problem && text[problem]
  return (
    <FormDialog open title={text.dialogTitle} confirmLabel={organizationAdminEn.saveChanges} cancelLabel={organizationAdminEn.cancel} onClose={onClose}
      onConfirm={async () => {
        // Show the message before moving focus, so screen readers read it with the field.
        flushSync(() => { setAttempted(true); setError('') })
        if (invalid) { inputRef.current?.focus(); return false }
        try { onSaved(await saveOrganizationName(value.trim())) }
        catch (reason) { setError((reason as Error).message); return false }
      }}>
      <TextField ref={inputRef} name="organizationName" label={text.field} required requiredMark autoComplete="organization" value={value}
        onChange={(event) => setValue(event.target.value)} error={attempted ? invalid : undefined} />
      {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
    </FormDialog>
  )
}
