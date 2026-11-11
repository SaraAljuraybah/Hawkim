import { organizationEn as content } from '../../content/organization.en'
import { usersEn } from '../../content/users.en'
import type { OrganizationEmployee } from '../../services/organization'
import { DetailRow, EmailDetail, StaffPermissionBadges } from '../admin/DetailsCard'
import { FormDialog } from '../ui/FormDialog'

export interface StaffProfilePreviewPerson {
  person: OrganizationEmployee
  /** Their department and its division, from the row they were opened from (no division: undefined). */
  departmentName: string
  divisionName?: string
}

/**
 * A staff member's Profile Preview on Organizational Structure, opened from their name: the same dialog as
 * the other previews (the name as the title, Close at the bottom, Escape and the backdrop close it), with the
 * details laid out like a staff member's page. It shows only what Organizational Structure already gives
 * every viewer (get_organizational_structure): email (with its copy button), position, division, department
 * and permissions as gold badges; never phone numbers or account details.
 */
export function StaffProfilePreview({ preview, onClose }: { preview: StaffProfilePreviewPerson; onClose: () => void }) {
  const text = content.profilePreview
  const { person } = preview
  const permissions = person.permissions.map((permission) => usersEn.permissions[permission])
  const email = person.email?.trim()
  return (
    <FormDialog open title={person.name} confirmLabel={text.close} onConfirm={() => {}} onClose={onClose}>
      <dl className="divide-y divide-beige text-left">
        <DetailRow label={text.email}>
          {email
            ? <EmailDetail email={email} copyLabel={content.copyEmail(person.name)} copiedText={content.copied} failedText={content.copyFailed} />
            : text.notSet}
        </DetailRow>
        <DetailRow label={text.position}>{person.position?.trim() || text.notSet}</DetailRow>
        <DetailRow label={text.division}>{preview.divisionName?.trim() || text.notSet}</DetailRow>
        <DetailRow label={text.department}>{preview.departmentName.trim() || text.notSet}</DetailRow>
        <DetailRow label={text.permission}>
          {permissions.length > 0 ? <StaffPermissionBadges labels={permissions} /> : text.notSet}
        </DetailRow>
      </dl>
    </FormDialog>
  )
}
