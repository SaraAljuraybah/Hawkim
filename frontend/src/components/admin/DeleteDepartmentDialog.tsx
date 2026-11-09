import { useState } from 'react'
import { FormDialog } from '../ui/FormDialog'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import { deleteDepartment, type ManagedDepartment } from '../../services/organizationAdmin'

/**
 * Deletes a department without SOPs (a department with SOPs can't be deleted: its Delete icon is disabled and
 * the database refuses). A department whose deletion was confirmed earlier but whose file cleanup is still
 * pending gets "Retry file cleanup" instead.
 */
export function DeleteDepartmentDialog({ department, onClose, onDeleted }: {
  department: Pick<ManagedDepartment, 'id' | 'name' | 'updated_at' | 'deletion_job_id'>; onClose: () => void; onDeleted: () => void
}) {
  const pending = !!department.deletion_job_id
  const [error, setError] = useState('')
  return <FormDialog open title={text.deleteTitle.replace('{name}', department.name)} confirmLabel={pending ? text.retryCleanup : text.delete} cancelLabel={text.cancel}
    onClose={onClose} onConfirm={async () => {
      try { await deleteDepartment(department, pending ? 'delete' : 'empty'); onDeleted() }
      catch (reason) { setError((reason as Error).message); return false }
    }}>
    <p className="text-sm text-text-gray">{pending ? text.cleanupDescription : text.deleteDepartmentText}</p>
    {error && <p role="alert" className="text-sm text-status-rejected-fg">{error}</p>}
  </FormDialog>
}
