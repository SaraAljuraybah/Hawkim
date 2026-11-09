import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserForm } from '../../components/admin/UserForm'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { adminUserPath } from '../../lib/routes'
import type { NewUser } from '../../lib/userAdmin'
import { AddUserError } from '../../services/people'
import { useUsers } from '../../state/usersContext'
import type { UserDetailsLocationState } from './UserDetailsPage'

// divisionId stays undefined until the admin changes it, so the default follows the departments.
const EMPTY_USER: NewUser = { name: '', email: '', phone: '', departmentId: '', position: '', permissions: [] }

/**
 * Add user ("/admin/users/new", PBI 15): a real sign-in account, the user's profile and permissions,
 * and an invitation email to set their password; the admin never chooses one. Nothing is added while
 * any required information is missing (see UserForm), and the server refuses what the rules don't
 * allow. On success, the new user's page opens, saying whether the invitation went out.
 */
export function AddUserPage() {
  const content = adminEn.addUser
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  const { activeUsers, addUser } = useUsers()
  const navigate = useNavigate()
  const [refused, setRefused] = useState<string[]>([])
  const refusedRef = useRef<HTMLDivElement>(null)

  /** What to tell the admin about an add the server refused. */
  function failureMessages(error: unknown): string[] {
    if (!(error instanceof AddUserError)) return [content.failures.failed]
    if (error.reason !== 'permission-in-use') return [content.failures[error.reason]]
    if (error.inUse.length === 0) return [content.failures.invalid]
    return error.inUse.map(({ permission, count }) =>
      (count === 1 ? adminEn.editUser.inUse.one : adminEn.editUser.inUse.other).replace('{permission}', usersEn.permissions[permission]).replace('{count}', String(count)),
    )
  }

  async function add(user: NewUser) {
    try {
      const added = await addUser(user)
      const state: UserDetailsLocationState = { added: true, invitationFailed: !added.emailSent }
      navigate(adminUserPath(added.user.id), { state })
    } catch (error) {
      flushSync(() => setRefused(failureMessages(error)))
      refusedRef.current?.focus()
    }
  }

  return (
    <>
      <Link
        to={content.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {content.back.label}
      </Link>
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

      <UserForm
        initial={EMPTY_USER}
        otherUsers={activeUsers}
        submitLabel={content.submit}
        busyLabel={content.adding}
        notice={refused.length > 0 && <RefusedBox ref={refusedRef} title={content.notAdded} messages={refused} />}
        onSubmit={add}
      />
    </>
  )
}
