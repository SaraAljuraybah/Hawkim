import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FormDialog } from '../ui/FormDialog'
import { TextField } from '../ui/TextField'
import { TextAreaField } from '../ui/TextAreaField'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { saveDivision, type DivisionRecord } from '../../services/organizationAdmin'

/** The most a division description may have; the database allows the same (validate_division_management). */
export const DIVISION_DESCRIPTION_MAX = 500

export function DivisionForm({ division, onClose, onSaved }: { division?: DivisionRecord; onClose: () => void; onSaved?: () => void }) {
  const [name, setName] = useState(division?.name ?? '')
  const [email, setEmail] = useState(division?.email ?? '')
  const [description, setDescription] = useState(division?.description ?? '')
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)
  // Name, email and description are all required, as in the database (save_division, 20261119130000); blank counts as empty.
  const nameInvalid = !name.trim() || name.trim().length > 100
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
      catch (reason) { setError((reason as Error).message); return false }
    }}>
    <TextField ref={nameRef} name="divisionName" label={text.name} required requiredMark value={name} onChange={(event) => setName(event.target.value)} error={attempted && nameInvalid ? text.requiredName : undefined} />
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
