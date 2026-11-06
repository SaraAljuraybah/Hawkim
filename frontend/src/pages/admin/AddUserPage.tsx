import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { UserForm } from '../../components/admin/UserForm'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { adminUserPath } from '../../lib/routes'
import type { NewUser } from '../../lib/userAdmin'
import { useUsers } from '../../state/usersContext'
import type { UserDetailsLocationState } from './UserDetailsPage'

// divisionId stays undefined until the admin changes it, so the default follows the departments.
const EMPTY_USER: NewUser = { name: '', email: '', phone: '', departmentId: '', position: '', permissions: [] }

/**
 * Add user ("/admin/users/new", PBI 15). Nothing is added while any required information is missing
 * (see UserForm). On success, the new user's page opens.
 * TODO: Create a real account (an invitation to set a password) once the backend
 * exists. There is no password field: the admin never chooses one.
 */
export function AddUserPage() {
  const content = adminEn.addUser
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  const { activeUsers, addUser } = useUsers()
  const navigate = useNavigate()

  function add(user: NewUser) {
    const created = addUser(user)
    const state: UserDetailsLocationState = { added: true }
    navigate(adminUserPath(created.id), { state })
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

      <UserForm initial={EMPTY_USER} otherUsers={activeUsers} submitLabel={content.submit} onSubmit={add} />
    </>
  )
}
