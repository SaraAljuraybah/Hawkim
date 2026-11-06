import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleCheck } from 'lucide-react'
import { blockerMessage } from '../../components/admin/blockerMessages'
import { DeleteUserButton } from '../../components/admin/DeleteUserButton'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserAvatar } from '../../components/admin/UserBits'
import { UserForm } from '../../components/admin/UserForm'
import { adminEn } from '../../content/admin.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { ADMIN_USERS_PATH } from '../../lib/routes'
import { permissionChangeBlockers, userFormValues, type NewUser } from '../../lib/userAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'
import type { AdminUsersLocationState } from './AdminUsersPage'

/**
 * Edit user ("/admin/users/:id/edit"): the Add User form, filled in with the user's details, with
 * Delete user next to their name. Save stays here; a change the rules refuse saves nothing and is
 * explained. Deleted and unknown users show Not Found.
 */
export function EditUserPage() {
  const { id } = useParams()
  // Another user starts fresh (their values, no messages).
  return <EditUser key={id} id={id} />
}

function EditUser({ id }: { id: string | undefined }) {
  const content = adminEn.editUser
  const { activeUsers } = useUsers()
  const user = activeUsers.find((item) => item.id === id)
  useDocumentTitle(user ? adminEn.pageTitle.replace('{page}', content.title) : undefined)

  if (!user) return <NotFoundPage embedded />

  return <EditUserContent user={user} />
}

function EditUserContent({ user }: { user: User }) {
  const content = adminEn.editUser
  const { activeUsers, updateUser } = useUsers()
  const { activeDepartments } = useDepartments()
  const admin = useCurrentUser()
  const { sops } = useSops()
  const navigate = useNavigate()

  const [saved, setSaved] = useState(false)
  // Starts the form again from the saved values (the phone as stored, no errors).
  const [savedCount, setSavedCount] = useState(0)
  const [refusedReasons, setRefusedReasons] = useState<string[]>([])
  const [deleteRefused, setDeleteRefused] = useState<{ title: string; reasons: string[] }>()
  const statusRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)
  const deleteErrorRef = useRef<HTMLDivElement>(null)

  function save(next: NewUser) {
    setDeleteRefused(undefined)
    const rules = { actorId: admin.id, users: activeUsers, sops }
    const blockers = permissionChangeBlockers(user, next.permissions, rules)
    if (blockers.length > 0) {
      setSaved(false)
      flushSync(() => setRefusedReasons(blockers.map((blocker) => blockerMessage(blocker, user, adminEn.userDetails.blockers, true))))
      refusedRef.current?.focus()
      return
    }
    updateUser(user.id, next, rules)
    flushSync(() => {
      setRefusedReasons([])
      setSaved(true)
      setSavedCount((count) => count + 1)
    })
    // Save is at the bottom of the form: this also brings the message into view.
    statusRef.current?.focus()
  }

  function deleted(message: string) {
    const state: AdminUsersLocationState = { deleted: message }
    navigate(ADMIN_USERS_PATH, { state })
  }

  function refuseDelete(title: string, reasons: string[]) {
    setSaved(false)
    flushSync(() => setDeleteRefused({ title, reasons }))
    deleteErrorRef.current?.focus()
  }

  return (
    <>
      <Link
        to={adminEn.addUser.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {adminEn.addUser.back.label}
      </Link>
      <h1 className="mt-5 text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
      <p className="mt-2 text-text-gray">{content.subtitle}</p>

      {/* Success message after saving (live region stays mounted) */}
      <div role="status" ref={statusRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        {saved && (
          <p className="mt-6 flex items-center gap-2.5 rounded-lg border border-status-approved-fg/20 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {content.saved}
          </p>
        )}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <UserAvatar user={user} />
        <p className="min-w-0 font-medium break-words text-maroon">{user.name}</p>
        <DeleteUserButton user={user} onDeleted={deleted} onRefused={refuseDelete} />
      </div>
      {deleteRefused && <RefusedBox ref={deleteErrorRef} title={deleteRefused.title} messages={deleteRefused.reasons} />}

      <UserForm
        key={savedCount}
        initial={userFormValues(user, activeDepartments)}
        // The user's own email isn't a duplicate of itself.
        otherUsers={activeUsers.filter((other) => other.id !== user.id)}
        submitLabel={content.submit}
        notice={refusedReasons.length > 0 && <RefusedBox ref={refusedRef} title={content.refused} messages={refusedReasons} />}
        onEdit={() => setSaved(false)}
        onSubmit={save}
      />
    </>
  )
}
