import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { FormDialog } from '../ui/FormDialog'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { TextField } from '../ui/TextField'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { setEmployeePositions, type ManagedPerson } from '../../services/organizationAdmin'

const MAX_POSITIONS = 10
const MAX_LENGTH = 100

/** Edit an employee's positions in their department. At least one is required (also enforced by the database). */
export function EmployeePositionsDialog({ person, onClose, onSaved }: { person: ManagedPerson; onClose: () => void; onSaved: () => void }) {
  const [titles, setTitles] = useState<string[]>(person.positions.length ? person.positions : [''])
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const filled = titles.map((title) => title.trim()).filter(Boolean)
  const tooLong = (title: string) => title.trim().length > MAX_LENGTH
  const invalid = filled.length === 0 || titles.some(tooLong) || filled.length > MAX_POSITIONS
  return <FormDialog open title={text.positionsTitle.replace('{name}', person.name)} description={text.positionsHint}
    confirmLabel={text.save} cancelLabel={text.cancel} onClose={onClose} onConfirm={async () => {
      setAttempted(true); setError('')
      if (invalid) return false
      try { await setEmployeePositions(person.id, filled); onSaved() }
      catch (reason) { setError((reason as Error).message); return false }
    }}>
    {titles.map((title, index) => <div key={index} className="flex items-end gap-2">
      <TextField className="flex-1" name={`position-${index}`} label={text.positionLabel.replace('{n}', String(index + 1))}
        required={index === 0} requiredMark={index === 0} value={title} autoComplete="off"
        error={attempted && tooLong(title) ? text.positionTooLong : attempted && index === 0 && filled.length === 0 ? text.positionRequired : undefined}
        onChange={(event) => setTitles(titles.map((value, i) => i === index ? event.target.value : value))} />
      {titles.length > 1 && <IconButton icon={Trash2} danger label={text.removePosition.replace('{n}', String(index + 1))}
        onClick={() => setTitles(titles.filter((_, i) => i !== index))} />}
    </div>)}
    {titles.length < MAX_POSITIONS
      ? <Button size="sm" variant="secondary" onClick={() => setTitles([...titles, ''])}><Plus className="size-4" aria-hidden="true" />{text.addPosition}</Button>
      : <p className="text-sm text-text-gray">{text.positionsLimit}</p>}
    {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
  </FormDialog>
}
