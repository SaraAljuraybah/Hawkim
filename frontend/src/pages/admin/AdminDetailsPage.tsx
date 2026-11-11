import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, CircleCheck, Info, LoaderCircle, Pencil } from 'lucide-react'
import { AdminRoleBadge } from '../../components/admin/AdminRoleBadge'
import { DeleteAdminButton } from '../../components/admin/DeleteAdminButton'
import { DetailRow, DetailsCard, DetailsHeader, EmailDetail } from '../../components/admin/DetailsCard'
import { MakeSuperAdminButton } from '../../components/admin/MakeSuperAdminButton'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { Button } from '../../components/ui/Button'
import { adminsEn } from '../../content/admins.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useSuperAdmin, type SuperAdminState } from '../../hooks/useSuperAdmin'
import { adminRole, canDeleteAdmin, canEditAdmin, canMakeSuperAdmin } from '../../lib/adminAccess'
import { ADMIN_ADMINS_PATH, adminAdminEditPath } from '../../lib/routes'
import { isSystemAdmin } from '../../lib/userAdmin'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'
import type { AdminAdminsLocationState } from './AdminAdminsPage'

/** Set by Add Admin, to say the Admin was added and whether their invitation went out. */
export interface AdminDetailsLocationState {
  added?: boolean
  invitationFailed?: boolean
}

/**
 * An administrator's page ("/admin/admins/:id"): name, email, phone and role, with the actions the
 * signed-in administrator may take. The Super Admin sees Edit, Make Super Admin and Delete on a
 * regular Admin; a regular Admin sees Edit on regular Admins and only the details of the Super Admin.
 * Staff and deleted or unknown accounts show Not Found.
 */
export function AdminDetailsPage() {
  const { id } = useParams()
  // Another administrator starts fresh (no messages).
  return <AdminDetails key={id} id={id} />
}

function AdminDetails({ id }: { id: string | undefined }) {
  const { status, activeUsers } = useUsers()
  const superAdmin = useSuperAdmin()
  const admin = activeUsers.find((user) => user.id === id && isSystemAdmin(user))
  useDocumentTitle(admin ? adminsEn.pageTitle.replace('{page}', admin.name) : undefined)

  if (status === 'loading' || superAdmin.status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-text-gray">
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
        {adminsEn.list.loading}
      </p>
    )
  }
  if (!admin) return <NotFoundPage embedded />

  return (
    <>
      <Link
        to={adminsEn.details.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {adminsEn.details.back.label}
      </Link>
      <AdminPanels admin={admin} superAdmin={superAdmin} />
    </>
  )
}

function AdminPanels({ admin, superAdmin }: { admin: User; superAdmin: SuperAdminState }) {
  const text = adminsEn.details
  const viewer = useCurrentUser()
  const navigate = useNavigate()
  const location = useLocation()
  const arrived = location.state as AdminDetailsLocationState | null

  const [added, setAdded] = useState(() => !!arrived?.added)
  const [invitationFailed] = useState(() => !!arrived?.invitationFailed)
  const [notice, setNotice] = useState('')
  const [refused, setRefused] = useState<{ title: string; reasons: string[] }>()
  const noticeRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)

  const superAdminId = superAdmin.status === 'ready' ? superAdmin.superAdminId : null
  // Until the Super Admin is known, only viewing is offered (the server decides in any case).
  const known = superAdmin.status === 'ready'
  const role = adminRole(admin.id, superAdminId)
  const isSelf = admin.id === viewer.id
  const mayEdit = known && canEditAdmin(viewer.id, admin.id, superAdminId)
  const mayTransfer = known && canMakeSuperAdmin(viewer.id, admin.id, superAdminId)
  const mayDelete = known && canDeleteAdmin(viewer.id, admin.id, superAdminId)

  function refuse(title: string, reasons: string[]) {
    setAdded(false)
    setNotice('')
    flushSync(() => setRefused({ title, reasons }))
    refusedRef.current?.focus()
    // The role may have moved elsewhere: show who holds it now.
    superAdmin.reload()
  }

  function transferred(newSuperAdminId: string, message: string) {
    superAdmin.set(newSuperAdminId)
    setAdded(false)
    setRefused(undefined)
    flushSync(() => setNotice(message))
    noticeRef.current?.focus()
  }

  function deleted(message: string) {
    const state: AdminAdminsLocationState = { notice: message }
    navigate(ADMIN_ADMINS_PATH, { state })
  }

  const email = admin.email.trim()

  const explanation = role === 'superAdmin' ? (isSelf ? text.ownSuperAdmin : text.superAdminReadOnly) : ''

  return (
    <>
      {/* Header, with the actions at the top right */}
      <DetailsHeader
        user={admin}
        badges={<AdminRoleBadge role={role} />}
        actions={
          mayEdit || mayTransfer || mayDelete ? (
            <>
              {mayEdit && (
                <Button to={adminAdminEditPath(admin.id)}>
                  <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
                  {text.edit}
                </Button>
              )}
              {mayTransfer && <MakeSuperAdminButton admin={admin} onTransferred={transferred} onFailed={refuse} />}
              {mayDelete && <DeleteAdminButton admin={admin} onDeleted={deleted} onFailed={refuse} labeled />}
            </>
          ) : undefined
        }
      />

      {refused && <RefusedBox ref={refusedRef} title={refused.title} messages={refused.reasons} />}

      <div role="status" ref={noticeRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        {notice && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {notice}
          </p>
        )}
        {added && invitationFailed && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-pending-fg/25 bg-status-pending-bg px-4 py-3 text-sm font-medium text-status-pending-fg">
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {text.addedInvitationFailed}
          </p>
        )}
        {added && !invitationFailed && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {text.added}
          </p>
        )}
      </div>

      {/* The same Details card as a staff member's page; same order as Edit Admin */}
      <DetailsCard
        id="admin-details-title"
        title={text.title}
        footer={
          explanation && (
            <p className="mt-5 flex items-start gap-2 border-t border-beige pt-4 text-sm text-text-gray">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-maroon" strokeWidth={1.75} />
              {explanation}
            </p>
          )
        }
      >
        <DetailRow label={text.name}>{admin.name.trim() || text.notSet}</DetailRow>
        <DetailRow label={text.email}>
          {email ? (
            <EmailDetail email={email} copyLabel={text.copyEmail.replace('{name}', admin.name)} copiedText={text.copied} failedText={text.copyFailed} />
          ) : (
            text.notSet
          )}
        </DetailRow>
        <DetailRow label={text.phone}>{admin.phone?.trim() || text.notSet}</DetailRow>
        <DetailRow label={text.role}>
          <AdminRoleBadge role={role} />
        </DetailRow>
      </DetailsCard>
    </>
  )
}
