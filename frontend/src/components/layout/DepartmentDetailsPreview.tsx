import { organizationEn as content } from '../../content/organization.en'
import { DetailRow, EmailDetail } from '../admin/DetailsCard'
import { FormDialog } from '../ui/FormDialog'

export interface DepartmentDetailsPreviewDepartment {
  name: string
  /** Its division, from the row it was opened from (no division: undefined). */
  divisionName?: string
  description?: string | null
  email?: string | null
}

/**
 * A department's details on Organizational Structure, opened from its name: the same dialog and layout as the
 * staff Profile Preview (StaffProfilePreview: the name as the title, Close at the bottom, Escape and the backdrop
 * close it). Read-only, for every viewer: the division, the description and the email (with its copy button),
 * the same fields as the admin preview on Divisions and Departments, all already readable by every active user.
 * No actions.
 */
export function DepartmentDetailsPreview({ department, onClose }: { department: DepartmentDetailsPreviewDepartment; onClose: () => void }) {
  const text = content.departmentPreview
  const email = department.email?.trim()
  return (
    <FormDialog open title={department.name} confirmLabel={text.close} onConfirm={() => {}} onClose={onClose}>
      <dl className="divide-y divide-beige text-left">
        <DetailRow label={text.division}>{department.divisionName?.trim() || text.notSet}</DetailRow>
        <DetailRow label={text.description}>
          {department.description?.trim() ? <span className="whitespace-pre-line">{department.description}</span> : text.notSet}
        </DetailRow>
        <DetailRow label={text.email}>
          {email
            ? <EmailDetail email={email} copyLabel={content.copyEmail(department.name)} copiedText={content.copied} failedText={content.copyFailed} />
            : text.notSet}
        </DetailRow>
      </dl>
    </FormDialog>
  )
}
