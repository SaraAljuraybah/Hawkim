import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'
import { DetailRow, EmailDetail, StaffPermissionBadges } from './DetailsCard'
import { FormDialog } from '../ui/FormDialog'

const text = adminEn.usersList.invitations

/**
 * Preview on a Sent Invitations row: the same dialog as the other previews (the name as the title, Close at
 * the bottom, Escape and the backdrop close it), with the details entered in Add Staff, in its order.
 * The invitation's status and sent date are in the table, not repeated here.
 */
export function InvitationPreview({ user, divisionName, departmentName, onClose }: {
  user: User
  divisionName?: string
  departmentName?: string
  onClose: () => void
}) {
  const labels = text.preview
  const permissions = user.permissions.map((permission) => usersEn.permissions[permission])
  const email = user.email.trim()
  return (
    <FormDialog open title={user.name} confirmLabel={labels.close} onConfirm={() => {}} onClose={onClose}>
      <dl className="divide-y divide-beige text-left">
        <DetailRow label={labels.name}>{user.name.trim() || labels.notSet}</DetailRow>
        <DetailRow label={labels.email}>
          {email
            ? <EmailDetail email={email} copyLabel={text.copyEmail.replace('{name}', user.name)} copiedText={text.copied} failedText={text.copyFailed} />
            : labels.notSet}
        </DetailRow>
        <DetailRow label={labels.phone}>{user.phone?.trim() || labels.notSet}</DetailRow>
        <DetailRow label={labels.division}>{divisionName?.trim() || labels.notSet}</DetailRow>
        <DetailRow label={labels.department}>{departmentName?.trim() || labels.notSet}</DetailRow>
        <DetailRow label={labels.position}>{user.position?.trim() || labels.notSet}</DetailRow>
        <DetailRow label={labels.permission}>
          {permissions.length > 0 ? <StaffPermissionBadges labels={permissions} /> : labels.notSet}
        </DetailRow>
      </dl>
    </FormDialog>
  )
}
