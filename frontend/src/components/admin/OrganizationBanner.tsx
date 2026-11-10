import { useContext, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Pencil, Pill } from 'lucide-react'
import { FormDialog } from '../ui/FormDialog'
import { IconButton } from '../ui/IconButton'
import { TextField } from '../ui/TextField'
import { organizationAdminEn } from '../../content/organizationAdmin.en'
import type { User } from '../../data/mock/types'
import { useOrganizationName } from '../../hooks/useOrganizationName'
import { organizationNameProblem, saveOrganizationName } from '../../services/organizationSettings'
import { SuperAdminContext } from '../../state/superAdminContext'

const text = organizationAdminEn.organizationName

/**
 * The organization's name in the admin top bar, on every admin page: it loads the name, and gives the
 * Super Admin (once it is known who that is) the pencil and the Edit Organization Name dialog. Nothing
 * while the name is loading or can't be read. The server checks who may change it in any case.
 */
export function OrganizationName({ user }: { user: Pick<User, 'id'> }) {
  const organization = useOrganizationName()
  const superAdmin = useContext(SuperAdminContext)
  const canEdit = superAdmin?.status === 'ready' && superAdmin.superAdminId === user.id
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState('')
  const trigger = useRef<HTMLElement | null>(null)
  if (organization.status !== 'ready') return null
  const close = () => { setEditing(false); trigger.current?.focus() }
  return (
    <>
      <OrganizationBanner name={organization.name} canEdit={canEdit}
        onEdit={() => { trigger.current = document.activeElement as HTMLElement; setSaved(''); setEditing(true) }} />
      {/* Announces a saved name (the new name is already on screen). */}
      <p role="status" className="sr-only">{saved}</p>
      {editing && <OrganizationNameForm name={organization.name} onClose={close}
        onSaved={(name) => { organization.set(name); setSaved(text.saved) }} />}
    </>
  )
}

/**
 * The name as shown in the top bar: a pill icon in a maroon circle (from sm), the name in maroon with a
 * thin gold line under it, and the pencil for the Super Admin. A long name is cut with "…" (the full
 * name stays in the tooltip and for screen readers). Without a name, the Super Admin sees
 * "Organization name not set" with the pencil; everyone else sees nothing. Not a heading: each page
 * keeps its own h1.
 */
export function OrganizationBanner({ name, canEdit, onEdit }: { name: string | null; canEdit: boolean; onEdit: () => void }) {
  if (!name && !canEdit) return null
  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <span aria-hidden="true" className="hidden size-9 shrink-0 items-center justify-center rounded-full bg-maroon text-offwhite sm:inline-flex">
        <Pill className="size-[1.125rem]" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        {name ? (
          <p title={name} className="truncate text-base leading-tight font-semibold text-maroon sm:text-lg">
            <span className="sr-only">{text.label}: </span>
            {name}
          </p>
        ) : (
          <p className="truncate text-sm leading-tight text-text-gray">{text.notSet}</p>
        )}
        {/* Decoration only (no text in gold). */}
        <span aria-hidden="true" className="mt-1 block h-0.5 w-12 max-w-full rounded-full bg-gold" />
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
