import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, CircleCheck, Pencil } from 'lucide-react'
import { DeleteUserButton } from '../../components/admin/DeleteUserButton'
import { DetailRow, DetailsCard, DetailsHeader, EmailDetail, StaffPermissionBadges } from '../../components/admin/DetailsCard'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { Button } from '../../components/ui/Button'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { ADMIN_USERS_PATH, adminAdminPath, adminUserEditPath } from '../../lib/routes'
import { divisionLabel, isSystemAdmin } from '../../lib/userAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'
import type { AdminUsersLocationState } from './AdminUsersPage'

/** Set by Add User, to say the user was added (or reactivated) and whether their invitation went out. */
export interface UserDetailsLocationState {
  added?: boolean
  invitationFailed?: boolean
  /** Add Staff brought back a deactivated staff member. */
  reactivated?: boolean
}

/**
 * A staff member's page in the admin portal ("/admin/users/:id", PBI 17, 19): their details, and
 * Edit Staff and Delete Staff at the top right, laid out like an Admin's page. Edit Staff opens the edit form,
 * which saves to the database. A System Admin has no division, department or position, so those
 * aren't listed for them. Deleted and unknown staff show Not Found.
 */
export function UserDetailsPage() {
  const { id } = useParams()
  // Another user starts fresh (no messages).
  return <UserDetails key={id} id={id} />
}

function UserDetails({ id }: { id: string | undefined }) {
  const text = adminEn.userDetails
  const { activeUsers } = useUsers()
  const user = activeUsers.find((item) => item.id === id)
  useDocumentTitle(user ? adminEn.pageTitle.replace('{page}', user.name) : undefined)

  if (!user) return <NotFoundPage embedded />
  // Administrators are managed on Manage Organization → Admins.
  if (isSystemAdmin(user)) return <Navigate to={adminAdminPath(user.id)} replace />

  return (
    <>
      <Link
        to={text.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.label}
      </Link>
      <UserPanels user={user} />
    </>
  )
}

function UserPanels({ user }: { user: User }) {
  const text = adminEn.userDetails
  const { getDepartment } = useDepartments()
  const navigate = useNavigate()
  const location = useLocation()

  const [added, setAdded] = useState(() => !!(location.state as UserDetailsLocationState | null)?.added)
  const [invitationFailed] = useState(() => !!(location.state as UserDetailsLocationState | null)?.invitationFailed)
  const [reactivated] = useState(() => !!(location.state as UserDetailsLocationState | null)?.reactivated)
  const [deleteRefused, setDeleteRefused] = useState<{ title: string; reasons: string[] }>()
  const deleteErrorRef = useRef<HTMLDivElement>(null)

  const department = getDepartment(user.departmentId)

  function deleted(message: string) {
    const state: AdminUsersLocationState = { deleted: message }
    navigate(ADMIN_USERS_PATH, { state })
  }

  function refuseDelete(title: string, reasons: string[]) {
    setAdded(false)
    flushSync(() => setDeleteRefused({ title, reasons }))
    deleteErrorRef.current?.focus()
  }

  // Same order as My Profile; an empty value shows notSet. A System Admin has no
  // organizational fields.
  const details: [string, string | undefined][] = [
    [text.details.phone, user.phone],
    ...(isSystemAdmin(user)
      ? []
      : ([
          [text.details.division, divisionLabel(department)],
          [text.details.department, department?.name],
          [text.details.position, user.position],
        ] as [string, string | undefined][])),
  ]
  const permissions = user.permissions.map((permission) => usersEn.permissions[permission])
  const email = user.email.trim()

  return (
    <>
      {/* Header, with Edit Staff and Delete Staff at the top right (as on an Admin's page) */}
      <DetailsHeader
        user={user}
        badges={<StaffPermissionBadges labels={permissions} />}
        actions={
          <>
            <Button to={adminUserEditPath(user.id)}>
              <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {text.edit}
            </Button>
            <DeleteUserButton user={user} onDeleted={deleted} onRefused={refuseDelete} label={text.delete} busyLabel={text.deleting} />
          </>
        }
      />

      {deleteRefused && <RefusedBox ref={deleteErrorRef} title={deleteRefused.title} messages={deleteRefused.reasons} />}

      <div role="status">
        {added && invitationFailed && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-pending-fg/25 bg-status-pending-bg px-4 py-3 text-sm font-medium text-status-pending-fg">
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {reactivated ? text.reactivatedInvitationFailed : text.addedInvitationFailed}
          </p>
        )}
        {added && !invitationFailed && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {reactivated ? text.reactivated : text.added}
          </p>
        )}
      </div>

      <DetailsCard id="details-title" title={text.details.title}>
        <DetailRow label={text.details.name}>{user.name.trim() || text.details.notSet}</DetailRow>
        <DetailRow label={text.details.email}>
          {email ? (
            <EmailDetail email={email} copyLabel={text.copyEmail.replace('{name}', user.name)} copiedText={text.copied} failedText={text.copyFailed} />
          ) : (
            text.details.notSet
          )}
        </DetailRow>
        {details.map(([label, value]) => (
          <DetailRow key={label} label={label}>
            {value?.trim() || text.details.notSet}
          </DetailRow>
        ))}
        <DetailRow label={text.details.permission}>
          {permissions.length > 0 ? <StaffPermissionBadges labels={permissions} /> : text.details.notSet}
        </DetailRow>
      </DetailsCard>
    </>
  )
}
