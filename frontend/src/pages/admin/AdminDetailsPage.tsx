import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, CircleCheck, Info, LoaderCircle, Pencil } from 'lucide-react'
import { AdminRoleBadge } from '../../components/admin/AdminRoleBadge'
import { DeleteAdminButton } from '../../components/admin/DeleteAdminButton'
import { MakeSuperAdminButton } from '../../components/admin/MakeSuperAdminButton'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
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

  // Same order as Edit Admin.
  const details: [string, string | undefined][] = [
    [text.name, admin.name],
    [text.email, admin.email],
    [text.phone, admin.phone],
  ]

  const explanation = role === 'superAdmin' ? (isSelf ? text.ownSuperAdmin : text.superAdminReadOnly) : ''

  return (
    <>
      {/* Header, with the actions at the top right */}
      <div className="mt-5 flex flex-wrap items-start gap-4">
        <UserAvatar user={admin} className="size-14 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl break-words tracking-tight sm:text-3xl">{admin.name}</h1>
          <AdminRoleBadge role={role} className="mt-2" />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {mayEdit && (
            <Button variant="secondary" size="sm" to={adminAdminEditPath(admin.id)}>
              <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {text.edit}
            </Button>
          )}
          {mayTransfer && <MakeSuperAdminButton admin={admin} onTransferred={transferred} onFailed={refuse} />}
          {mayDelete && <DeleteAdminButton admin={admin} onDeleted={deleted} onFailed={refuse} />}
        </div>
      </div>

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

      <div className="mt-6 grid max-w-3xl gap-6">
        <section aria-labelledby="admin-details-title" className="rounded-xl border border-beige bg-white p-5 sm:p-6">
          <h2 id="admin-details-title" className="text-lg">
            {text.title}
          </h2>
          <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-bold text-maroon">{label}</dt>
                {label === text.email && value?.trim() ? (
                  // The address and its copy icon stay together, as on Divisions and Departments; the confirmation takes its own line.
                  <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-maroon max-sm:mb-1">
                    <span className="min-w-0 break-all">{value}</span>
                    <CopyButton text={value} label={text.copyEmail.replace('{name}', admin.name)} copiedText={text.copied} failedText={text.copyFailed} />
                  </dd>
                ) : (
                  <dd className="min-w-0 break-words text-maroon max-sm:mb-1">{value?.trim() || text.notSet}</dd>
                )}
              </div>
            ))}
            <div className="contents">
              <dt className="font-bold text-maroon">{text.role}</dt>
              <dd className="min-w-0 max-sm:mb-1">
                <AdminRoleBadge role={role} />
              </dd>
            </div>
          </dl>
          {explanation && (
            <p className="mt-5 flex items-start gap-2 border-t border-beige pt-4 text-sm text-text-gray">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-maroon" strokeWidth={1.75} />
              {explanation}
            </p>
          )}
        </section>
      </div>
    </>
  )
}
