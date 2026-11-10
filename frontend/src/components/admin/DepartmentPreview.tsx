import { FormDialog } from '../ui/FormDialog'
import { organizationAdminEn as text } from '../../content/organizationAdmin.en'
import type { ManagedDepartment } from '../../services/organizationAdmin'
import { EmailDetail } from './DivisionDialogs'

/**
 * A department's details on Divisions and Departments, in the same dialog as DivisionPreview:
 * the name as the title, then Division, Description and Email, and Close. Read-only (no Edit).
 * `divisionName` is undefined for a legacy department without a division.
 */
export function DepartmentPreview({ department, divisionName, onClose }: { department: ManagedDepartment; divisionName?: string; onClose: () => void }) {
  return <FormDialog open title={department.name} confirmLabel={text.close} onConfirm={() => {}} onClose={onClose}>
    <dl className="-mt-1 space-y-4 text-sm">
      <div>
        <dt className="font-medium text-maroon">{text.division}</dt>
        {divisionName
          ? <dd className="mt-1 break-words text-black">{divisionName}</dd>
          : <dd className="mt-1 text-text-gray">{text.divisionNone}</dd>}
      </div>
      <div>
        <dt className="font-medium text-maroon">{text.description}</dt>
        {department.description.trim()
          ? <dd className="mt-1 break-words text-black">{department.description}</dd>
          : <dd className="mt-1 text-text-gray">{text.notProvided}</dd>}
      </div>
      <EmailDetail email={department.email} />
    </dl>
  </FormDialog>
}
