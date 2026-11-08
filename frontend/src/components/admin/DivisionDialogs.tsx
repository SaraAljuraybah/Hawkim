import { useState } from 'react'
import { Pencil } from 'lucide-react'
import { FormDialog } from '../ui/FormDialog'
import { Button } from '../ui/Button'
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
  // All three are required here (also when editing a division saved without an email or description).
  // The database accepts an empty email or description, so this stricter rule needs no database change.
  const nameInvalid = !name.trim() || name.trim().length > 100
  const emailMissing = !email.trim()
  const emailInvalid = !emailMissing && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)
  const descriptionMissing = !description.trim()
  const descriptionInvalid = description.trim().length > DIVISION_DESCRIPTION_MAX
  return <FormDialog open title={division ? text.editDivision : text.addDivision} confirmLabel={text.save} cancelLabel={text.cancel}
    onClose={onClose} onConfirm={async () => {
      setAttempted(true)
      if (nameInvalid || emailMissing || emailInvalid || descriptionMissing || descriptionInvalid) return false
      try { await saveDivision({ name, email, description }, division); onSaved?.() }
      catch (reason) { setError((reason as Error).message); return false }
    }}>
    <TextField name="divisionName" label={text.name} required requiredMark value={name} onChange={(event) => setName(event.target.value)} error={attempted && nameInvalid ? text.requiredName : undefined} />
    <TextAreaField name="divisionDescription" label={text.description} required requiredMark value={description} onChange={(event) => setDescription(event.target.value)}
      maxLength={DIVISION_DESCRIPTION_MAX} counter={text.descriptionCounter.replace('{count}', String(description.length)).replace('{max}', String(DIVISION_DESCRIPTION_MAX))}
      error={attempted ? (descriptionMissing ? text.requiredDescription : descriptionInvalid ? text.descriptionLong : undefined) : undefined} />
    <TextField name="divisionEmail" type="email" label={text.email} required requiredMark value={email} onChange={(event) => setEmail(event.target.value)}
      error={attempted ? (emailMissing ? text.requiredEmail : emailInvalid ? text.invalidEmail : undefined) : undefined} />
    {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
  </FormDialog>
}

export function DivisionPreview({ division, onEdit, onClose }: { division: DivisionRecord; onEdit: () => void; onClose: () => void }) {
  // One block, so the dialog's gap between children doesn't separate the title, Description and Email.
  return <FormDialog open title={division.name} confirmLabel={text.close} onConfirm={() => {}} onClose={onClose}>
    <div className="-mt-1 flex items-start gap-4">
      <dl className="min-w-0 flex-1 space-y-4 text-sm">
        {division.description && <div>
          <dt className="font-medium text-maroon">{text.description}</dt>
          <dd className="mt-1 break-words text-black">{division.description}</dd>
        </div>}
        <EmailDetail email={division.email} />
      </dl>
      <Button type="button" size="sm" variant="secondary" onClick={onEdit} className="shrink-0">
        <Pencil className="size-4" aria-hidden="true" strokeWidth={1.75} />
        {text.edit}
      </Button>
    </div>
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
