import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { FormDialog } from '../ui/FormDialog'
import { CopyButton } from '../ui/CopyButton'
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
  // Only the name is required. Email and description are optional, as in the database (validate_division_management
  // saves an empty email as null and an empty description as ''); an email is checked only when filled in.
  const nameInvalid = !name.trim() || name.trim().length > 100
  const emailInvalid = !!email.trim() && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)
  const descriptionInvalid = description.trim().length > DIVISION_DESCRIPTION_MAX
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
    <TextField ref={emailRef} name="divisionEmail" type="email" label={text.email} placeholder={text.emailPlaceholder} value={email} onChange={(event) => setEmail(event.target.value)}
      error={attempted && emailInvalid ? text.invalidEmail : undefined} />
    <TextAreaField ref={descriptionRef} name="divisionDescription" label={text.description} value={description} onChange={(event) => setDescription(event.target.value)}
      maxLength={DIVISION_DESCRIPTION_MAX} counter={text.descriptionCounter.replace('{count}', String(description.length)).replace('{max}', String(DIVISION_DESCRIPTION_MAX))}
      error={attempted && descriptionInvalid ? text.descriptionLong : undefined} />
    {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
  </FormDialog>
}

/** A division's details: Description ("Not provided." when empty) and Email, then Close. Read-only, like DepartmentPreview. */
export function DivisionPreview({ division, onClose }: { division: DivisionRecord; onClose: () => void }) {
  // One block, so the dialog's gap between children doesn't separate the title, Description and Email.
  return <FormDialog open title={division.name} confirmLabel={text.close} onConfirm={() => {}} onClose={onClose}>
    <dl className="-mt-1 space-y-4 text-sm">
      <div>
        <dt className="font-medium text-maroon">{text.description}</dt>
        {/* null (never set) and '' (saved empty) both count as none. */}
        {division.description?.trim()
          ? <dd className="mt-1 break-words text-black">{division.description}</dd>
          : <dd className="mt-1 text-text-gray">{text.notProvided}</dd>}
      </div>
      <EmailDetail email={division.email} />
    </dl>
  </FormDialog>
}

/** The Email row of a details dialog: the address with its copy icon, or "No email recorded." (muted, no copy icon). */
export function EmailDetail({ email }: { email?: string | null }) {
  return <div>
    <dt className="font-medium text-maroon">{text.email}</dt>
    {email
      // The address and its copy icon stay together; the confirmation takes its own line below.
      ? <dd className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5"><span className="min-w-0 break-all text-black">{email}</span>
        <CopyButton text={email} label={text.copy} copiedText={text.copied} failedText={text.copyFailed} /></dd>
      : <dd className="mt-1 text-text-gray">{text.missingEmail}</dd>}
  </div>
}
