import { useState } from 'react'
import { Copy, Pencil } from 'lucide-react'
import { FormDialog } from '../ui/FormDialog'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { TextField } from '../ui/TextField'
import { TextAreaField } from '../ui/TextAreaField'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { saveDivision, type DivisionRecord } from '../../services/organizationAdmin'

export function DivisionForm({ division, onClose, onSaved }: { division?: DivisionRecord; onClose: () => void; onSaved?: () => void }) {
  const [name, setName] = useState(division?.name ?? '')
  const [email, setEmail] = useState(division?.email ?? '')
  const [description, setDescription] = useState(division?.description ?? '')
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const nameInvalid = !name.trim() || name.trim().length > 100
  // Optional; when given it must be valid (the database applies the same rule).
  const emailInvalid = email.trim() !== '' && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254)
  const descriptionInvalid = description.trim().length > 500
  return <FormDialog open title={division ? text.editDivision : text.addDivision} confirmLabel={text.save} cancelLabel={text.cancel}
    onClose={onClose} onConfirm={async () => {
      setAttempted(true)
      if (nameInvalid || emailInvalid || descriptionInvalid) return false
      try { await saveDivision({ name, email, description }, division); onSaved?.() }
      catch (reason) { setError((reason as Error).message); return false }
    }}>
    <TextField name="divisionName" label={text.name} required requiredMark value={name} onChange={(event) => setName(event.target.value)} error={attempted && nameInvalid ? text.requiredName : undefined} />
    <TextAreaField name="divisionDescription" label={text.description} value={description} onChange={(event) => setDescription(event.target.value)} error={attempted && descriptionInvalid ? text.descriptionLong : undefined} />
    <TextField name="divisionEmail" type="email" label={text.email} value={email} onChange={(event) => setEmail(event.target.value)} error={attempted && emailInvalid ? text.invalidEmail : undefined} />
    {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
  </FormDialog>
}

export function DivisionPreview({ division, onEdit, onClose }: { division: DivisionRecord; onEdit: () => void; onClose: () => void }) {
  const [feedback, setFeedback] = useState('')
  return <FormDialog
  open
  title={division.name}
  confirmLabel={text.close}
  onConfirm={() => {}}
  onClose={onClose}
>
  <div className="flex justify-end">
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={onEdit}
    >
      <Pencil
        className="size-4"
        aria-hidden="true"
        strokeWidth={1.75}
      />
      {text.edit}
    </Button>
  </div>
    {division.description && <div><p className="mb-1.5 text-sm font-medium text-maroon">{text.description}</p>
      <p className="text-black">{division.description}</p></div>}
    {division.email ? <TextField name="divisionEmailPreview" type="email" label={text.email} value={division.email} readOnly
      endAdornment={<IconButton bare icon={Copy} label={text.copy} onClick={async () => {
        try { await navigator.clipboard.writeText(division.email!); setFeedback(text.copied) }
        catch { setFeedback(text.copyFailed) }
      }} />} />
      : <div><p className="mb-1.5 text-sm font-medium text-maroon">{text.email}</p><p className="text-text-gray">{text.missingEmail}</p></div>}
    <p role="status" className="-mt-3 text-xs text-text-gray">{feedback}</p>
  </FormDialog>
}
