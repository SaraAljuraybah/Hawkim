import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CircleCheck, Info, LoaderCircle } from 'lucide-react'
import { AdminRoleBadge } from '../../components/admin/AdminRoleBadge'
import { MakeSuperAdminButton } from '../../components/admin/MakeSuperAdminButton'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserAvatar } from '../../components/admin/UserBits'
import { UserForm } from '../../components/admin/UserForm'
import { Button } from '../../components/ui/Button'
import { adminsEn } from '../../content/admins.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useSuperAdmin } from '../../hooks/useSuperAdmin'
import { adminRole, canEditAdmin, canMakeSuperAdmin } from '../../lib/adminAccess'
import { ADMIN_ADMINS_PATH } from '../../lib/routes'
import { isSystemAdmin, type NewUser } from '../../lib/userAdmin'
import { AdminActionError } from '../../services/admins'
import { ChangeEmailError } from '../../services/people'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'

/**
 * Edit Admin ("/admin/admins/:id/edit"): full name, email and phone, in the same order as the
 * administrator's page. The form never changes the permission. The Super Admin also gets Make Super
 * Admin here (on a regular Admin), which transfers the Super Admin permission after confirming. A regular
 * Admin opening the Super Admin's Edit page gets an explanation instead of the form (the server refuses
 * it as well). A new email also changes the sign-in account. Back and Cancel return to the Admins list
 * (wherever Edit was opened from); leaving with unsaved changes asks first.
 */
export function EditAdminPage() {
  const { id } = useParams()
  // Another administrator starts fresh (their values, no messages).
  return <EditAdmin key={id} id={id} />
}

function EditAdmin({ id }: { id: string | undefined }) {
  const content = adminsEn.edit
  const viewer = useCurrentUser()
  const { status, activeUsers } = useUsers()
  const superAdmin = useSuperAdmin()
  const admin = activeUsers.find((user) => user.id === id && isSystemAdmin(user))
  useDocumentTitle(admin ? adminsEn.pageTitle.replace('{page}', content.title) : undefined)
  const [transferNotice, setTransferNotice] = useState('')
  const [transferRefused, setTransferRefused] = useState<{ title: string; reasons: string[] }>()
  const noticeRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)

  if (status === 'loading' || superAdmin.status === 'loading') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm font-medium text-text-gray">
        <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
        {adminsEn.list.loading}
      </p>
    )
  }
  if (!admin) return <NotFoundPage embedded />

  const superAdminId = superAdmin.superAdminId
  const allowed = superAdmin.status === 'ready' && canEditAdmin(viewer.id, admin.id, superAdminId)
  // Only the current Super Admin, on a regular Admin (the server checks again when confirming).
  const mayTransfer = superAdmin.status === 'ready' && canMakeSuperAdmin(viewer.id, admin.id, superAdminId)

  function transferred(newSuperAdminId: string, message: string) {
    // The viewer is now a regular Admin: this page shows the new Super Admin as read-only.
    superAdmin.set(newSuperAdminId)
    setTransferRefused(undefined)
    flushSync(() => setTransferNotice(message))
    noticeRef.current?.focus()
  }

  function transferFailed(title: string, reasons: string[]) {
    setTransferNotice('')
    flushSync(() => setTransferRefused({ title, reasons }))
    refusedRef.current?.focus()
    // The Super Admin may have changed elsewhere: show who holds it now.
    superAdmin.reload()
  }

  return (
    <>
      <Link
        to={ADMIN_ADMINS_PATH}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {adminsEn.details.back.label}
      </Link>
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-auto items-center gap-3">
          <UserAvatar user={admin} />
          <p className="min-w-0 font-medium break-words text-maroon">{admin.name}</p>
          <AdminRoleBadge role={adminRole(admin.id, superAdminId)} />
        </div>
        {mayTransfer && <MakeSuperAdminButton admin={admin} onTransferred={transferred} onFailed={transferFailed} />}
      </div>

      <div role="status" ref={noticeRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        {transferNotice && (
          <p className="mt-6 flex items-center gap-2.5 rounded-lg border border-status-approved-fg/20 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {transferNotice}
          </p>
        )}
      </div>
      {transferRefused && <RefusedBox ref={refusedRef} title={transferRefused.title} messages={transferRefused.reasons} />}

      {allowed ? (
        <EditAdminForm admin={admin} />
      ) : (
        <div className="mt-8 max-w-2xl rounded-xl border border-beige bg-white p-5 sm:p-6">
          <p className="flex items-start gap-2 text-sm text-text-gray">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-maroon" strokeWidth={1.75} />
            {superAdmin.status === 'ready' ? content.readOnly : adminsEn.list.loadFailed}
          </p>
          <Button variant="secondary" size="sm" to={ADMIN_ADMINS_PATH} className="mt-4">
            {adminsEn.details.back.label}
          </Button>
        </div>
      )}
    </>
  )
}

function EditAdminForm({ admin }: { admin: User }) {
  const content = adminsEn.edit
  const { activeUsers, updateAdmin } = useUsers()
  const [saved, setSaved] = useState('')
  // Starts the form again from the saved values (no errors, nothing unsaved).
  const [savedCount, setSavedCount] = useState(0)
  const [refused, setRefused] = useState<{ title: string; reasons: string[] }>()
  const statusRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)

  function refuse(title: string, reasons: string[]) {
    setSaved('')
    flushSync(() => setRefused({ title, reasons }))
    refusedRef.current?.focus()
  }

  async function save(next: NewUser) {
    try {
      await updateAdmin(admin.id, { name: next.name, email: next.email, phone: next.phone })
    } catch (error) {
      if (error instanceof ChangeEmailError) {
        // The other changes are saved: the form starts again from them, with the email as it was.
        setSavedCount((count) => count + 1)
        refuse(content.emailNotSaved, [content.emailFailures[error.reason]])
      } else {
        refuse(content.notSaved, [content.failures[error instanceof AdminActionError ? error.reason : 'failed']])
      }
      return
    }
    flushSync(() => {
      setRefused(undefined)
      setSaved(content.saved)
      setSavedCount((count) => count + 1)
    })
    // Save is at the bottom of the form: this also brings the message into view.
    statusRef.current?.focus()
  }

  return (
    <>
      {/* Success message after saving (live region stays mounted) */}
      <div role="status" ref={statusRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        {saved && (
          <p className="mt-6 flex items-center gap-2.5 rounded-lg border border-status-approved-fg/20 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {saved}
          </p>
        )}
      </div>

      <UserForm
        key={savedCount}
        initial={{ name: admin.name, email: admin.email, phone: admin.phone ?? '', departmentId: '', position: '', permissions: ['admin'] }}
        // Their own email isn't a duplicate of itself.
        otherUsers={activeUsers.filter((other) => other.id !== admin.id)}
        // Cancel goes to the Admins list, like Back.
        text={{ ...adminsEn.form, back: { ...adminsEn.form.back, href: ADMIN_ADMINS_PATH } }}
        permissionOptions={[]}
        submitLabel={content.submit}
        busyLabel={content.saving}
        notice={refused && <RefusedBox ref={refusedRef} title={refused.title} messages={refused.reasons} />}
        onEdit={() => setSaved('')}
        onSubmit={save}
        unsavedChanges={content.discard}
      />
    </>
  )
}
