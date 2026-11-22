import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FormDialog } from '../ui/FormDialog'
import { TextField } from '../ui/TextField'
import { TextAreaField } from '../ui/TextAreaField'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { saveDivision, type DivisionRecord } from '../../services/organizationAdmin'
import { divisionNameTaken } from '../../lib/organizationAdmin'

/** The most a division description may have; the database allows the same (validate_division_management). */
export const DIVISION_DESCRIPTION_MAX = 500

export function DivisionForm({ division, divisions = [], onClose, onSaved }: {
  division?: DivisionRecord
  /** The organization's active divisions, to refuse a name already in use before saving (the database refuses it too). */
  divisions?: readonly Pick<DivisionRecord, 'id' | 'name'>[]
  onClose: () => void
  onSaved?: () => void
}) {
  const [name, setName] = useState(division?.name ?? '')
  const [email, setEmail] = useState(division?.email ?? '')
  const [description, setDescription] = useState(division?.description ?? '')
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  // The name the database refused as already in use (another admin may have added it since the list loaded).
  const [refusedName, setRefusedName] = useState<string | undefined>(undefined)
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  // Name, email and description are all required, as in the database (save_division, 20261119130000); blank counts as empty.
  // A name is in use when another active division has it, ignoring case and surrounding spaces (as save_division).
  const nameError = !name.trim() || name.trim().length > 100 ? text.requiredName
    : divisionNameTaken(divisions, name, division?.id) || (refusedName !== undefined && refusedName === name.trim().toLowerCase())
      ? text.divisionNameExists : undefined
  const nameInvalid = !!nameError
  const emailError = !email.trim() ? text.requiredEmail
    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254 ? text.invalidEmail : undefined
  const descriptionError = !description.trim() ? text.requiredDescription
    : description.trim().length > DIVISION_DESCRIPTION_MAX ? text.descriptionLong : undefined
  const emailInvalid = !!emailError
  const descriptionInvalid = !!descriptionError
  return <FormDialog open title={division ? text.editDivision : text.addDivision} confirmLabel={division ? text.saveChanges : text.save} cancelLabel={text.cancel}
    onClose={onClose} onConfirm={async () => {
      // Show the messages before moving focus, so screen readers read them with the field.
      flushSync(() => { setAttempted(true); setError('') })
      // The first invalid field in the visible order: Name, Email, Description.
      const firstInvalid = nameInvalid ? nameRef : emailInvalid ? emailRef : descriptionInvalid ? descriptionRef : undefined
      if (firstInvalid) { firstInvalid.current?.focus(); return false }
      try { await saveDivision({ name, email, description }, division); onSaved?.() }
      catch (reason) {
        const message = (reason as Error).message
        // A name already in use is shown under Name, with focus there; any other refusal below the fields.
        if (message === text.divisionNameExists) {
          flushSync(() => setRefusedName(name.trim().toLowerCase()))
          nameRef.current?.focus()
        } else setError(message)
        return false
      }
    }}>
    <TextField ref={nameRef} name="divisionName" label={text.name} required requiredMark value={name} onChange={(event) => setName(event.target.value)} error={attempted ? nameError : undefined} />
    <TextField ref={emailRef} name="divisionEmail" type="email" label={text.email} required requiredMark placeholder={text.emailPlaceholder} value={email} onChange={(event) => setEmail(event.target.value)}
      error={attempted ? emailError : undefined} />
    <TextAreaField ref={descriptionRef} name="divisionDescription" label={text.description} required requiredMark value={description} onChange={(event) => setDescription(event.target.value)}
      maxLength={DIVISION_DESCRIPTION_MAX} counter={text.descriptionCounter.replace('{count}', String(description.length)).replace('{max}', String(DIVISION_DESCRIPTION_MAX))}
      error={attempted ? descriptionError : undefined} />
    {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
  </FormDialog>
}

// The read-only preview is shared with Organizational Structure (DivisionPreview.tsx, without the admin services).
export { DivisionPreview, EmailDetail } from './DivisionPreview'
