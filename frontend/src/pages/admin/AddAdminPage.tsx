import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Info } from 'lucide-react'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserForm } from '../../components/admin/UserForm'
import { adminsEn } from '../../content/admins.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { adminAdminPath } from '../../lib/routes'
import type { NewUser } from '../../lib/userAdmin'
import { AddUserError } from '../../services/people'
import { useUsers } from '../../state/usersContext'
import type { AdminDetailsLocationState } from './AdminDetailsPage'

// Always the Admin permission: Add Admin never chooses a role, and never makes a Super Admin.
const EMPTY_ADMIN: NewUser = { name: '', email: '', phone: '', departmentId: '', position: '', permissions: ['admin'] }

/**
 * Add Admin ("/admin/admins/new"): full name, email and phone. Like Add Staff, it creates a real
 * sign-in account through the add-user Edge Function and emails an invitation to set a password; the
 * new account is a regular Admin with no division, department or position. Retrying after a failure
 * re-uses the same sign-in account rather than creating another. On success the new Admin's page opens.
 */
export function AddAdminPage() {
  const content = adminsEn.add
  useDocumentTitle(adminsEn.pageTitle.replace('{page}', content.title))
  const { activeUsers, addUser } = useUsers()
  const navigate = useNavigate()
  const [refused, setRefused] = useState<string[]>([])
  const refusedRef = useRef<HTMLDivElement>(null)

  async function add(admin: NewUser) {
    try {
      const added = await addUser({ ...admin, permissions: ['admin'] })
      const state: AdminDetailsLocationState = { added: true, invitationFailed: !added.emailSent }
      navigate(adminAdminPath(added.user.id), { state })
    } catch (error) {
      const reason = error instanceof AddUserError ? error.reason : 'failed'
      // The Staff-only refusals can't apply to an Admin; if one came back, the details were wrong.
      const message = reason in content.failures ? content.failures[reason as keyof typeof content.failures] : content.failures.invalid
      flushSync(() => setRefused([message]))
      refusedRef.current?.focus()
    }
  }

  return (
    <>
      <Link
        to={adminsEn.form.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {adminsEn.form.back.label}
      </Link>
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 max-w-2xl text-text-gray">{content.subtitle}</p>
      <p className="mt-4 flex max-w-2xl items-start gap-2 text-sm text-text-gray">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-maroon" strokeWidth={1.75} />
        {content.roleNote}
      </p>

      <UserForm
        initial={EMPTY_ADMIN}
        otherUsers={activeUsers}
        text={adminsEn.form}
        permissionOptions={[]}
        submitLabel={content.submit}
        busyLabel={content.adding}
        notice={refused.length > 0 && <RefusedBox ref={refusedRef} title={content.notAdded} messages={refused} />}
        onSubmit={add}
      />
    </>
  )
}
