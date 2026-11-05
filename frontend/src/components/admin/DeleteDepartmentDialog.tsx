import { useState } from 'react'
import { FormDialog } from '../ui/FormDialog'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { deleteDepartment, type ManagedDepartment, type SopDisposition } from '../../services/organizationAdmin'

export function DeleteDepartmentDialog({ department, onClose, onDeleted }: {
  department: Pick<ManagedDepartment, 'id' | 'name' | 'sops' | 'updated_at' | 'deletion_job_id'>; onClose: () => void; onDeleted: () => void
}) {
  const pending = !!department.deletion_job_id
  const [disposition, setDisposition] = useState<SopDisposition>(pending ? 'delete' : department.sops ? 'others' : 'empty')
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  return <FormDialog open title={text.deleteTitle.replace('{name}', department.name)} confirmLabel={pending ? text.retryCleanup : text.delete} cancelLabel={text.cancel}
    onClose={onClose} onConfirm={async () => {
      if (!pending && disposition === 'delete' && !confirmed) { setError(text.confirmDestruction); return false }
      try { await deleteDepartment(department, disposition); onDeleted() }
      catch (reason) { setError((reason as Error).message); return false }
    }}>
    <p className="text-sm text-text-gray">{pending ? text.cleanupDescription : department.sops ? text.sopChoice : text.deleteDepartmentText}</p>
    {!pending && department.sops > 0 && <fieldset className="space-y-3">
      <legend className="sr-only">{text.sopChoice}</legend>
      {(['others', 'delete'] as const).map((option) => <label key={option} className="flex items-center gap-2 text-sm">
        <input type="radio" name="sopDisposition" value={option} checked={disposition === option} onChange={() => { setDisposition(option); setConfirmed(false); setError('') }} />
        {option === 'others' ? text.moveOthers : text.deleteSops}
      </label>)}
      <p className="text-sm text-text-gray">{disposition === 'delete' ? text.deleteSopsWarning : text.moveOthersText}</p>
      {disposition === 'delete' && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />{text.confirmDestruction}</label>}
    </fieldset>}
    {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
  </FormDialog>
}
