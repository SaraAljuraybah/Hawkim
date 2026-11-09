import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleCheck } from 'lucide-react'
import { blockerMessage } from '../../components/admin/blockerMessages'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserForm } from '../../components/admin/UserForm'
import { UserHeader } from '../../components/admin/UserHeader'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { ADMIN_USERS_PATH } from '../../lib/routes'
import { changesEmail, permissionChangeBlockers, userFormValues, type NewUser } from '../../lib/userAdmin'
import { SaveUserError, type SaveUserFailure } from '../../services/people'
import { useDepartments } from '../../state/departmentsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'
import type { AdminUsersLocationState } from './AdminUsersPage'

/**
 * Edit user ("/admin/users/:id/edit"): the user's page header (with "Edit User" above the name and
 * Delete user beside it), then the Add User form, filled in with the user's details. Save stays here; a change the rules or the database refuse saves
 * nothing and is explained. Everything but the email is saved to the database; the email only lasts
 * until reload, and the message says so. Deleted and unknown users show Not Found.
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

  // The success message, or '' when there is none.
  const [saved, setSaved] = useState('')
  // Starts the form again from the saved values (the phone as stored, no errors).
  const [savedCount, setSavedCount] = useState(0)
  const [refused, setRefused] = useState<{ title: string; reasons: string[] }>()
  const [deleteRefused, setDeleteRefused] = useState<{ title: string; reasons: string[] }>()
  const statusRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)
  const deleteErrorRef = useRef<HTMLDivElement>(null)

  /** What to tell the admin about a save the database refused. */
  function failureMessages(error: unknown): string[] {
    const reason: SaveUserFailure = error instanceof SaveUserError ? error.reason : 'failed'
    if (reason !== 'permission-in-use' || !(error instanceof SaveUserError) || error.inUse.length === 0) {
      return [reason === 'permission-in-use' ? content.failures.invalid : content.failures[reason]]
    }
    return error.inUse.map(({ permission, count }) =>
      (count === 1 ? content.inUse.one : content.inUse.other).replace('{permission}', usersEn.permissions[permission]).replace('{count}', String(count)),
    )
  }

  function refuse(title: string, reasons: string[]) {
    setSaved('')
    flushSync(() => setRefused({ title, reasons }))
    refusedRef.current?.focus()
  }

  async function save(next: NewUser) {
    setDeleteRefused(undefined)
    const rules = { actorId: admin.id, users: activeUsers, sops }
    const blockers = permissionChangeBlockers(user, next.permissions, rules)
    if (blockers.length > 0) {
      refuse(content.refused, blockers.map((blocker) => blockerMessage(blocker, user, adminEn.userDetails.blockers, true)))
      return
    }
    // Worked out first: saving changes the user these are compared with.
    const message = changesEmail(user, next) ? content.savedUntilReload : content.saved
    try {
      await updateUser(user.id, next, rules)
    } catch (error) {
      refuse(content.notSaved, failureMessages(error))
      return
    }
    flushSync(() => {
      setRefused(undefined)
      setSaved(message)
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
    setSaved('')
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
      <UserHeader user={user} label={content.title} onDeleted={deleted} onRefused={refuseDelete} />
      {deleteRefused && <RefusedBox ref={deleteErrorRef} title={deleteRefused.title} messages={deleteRefused.reasons} />}

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
        initial={userFormValues(user, activeDepartments)}
        // The user's own email isn't a duplicate of itself.
        otherUsers={activeUsers.filter((other) => other.id !== user.id)}
        submitLabel={content.submit}
        busyLabel={content.saving}
        notice={refused && <RefusedBox ref={refusedRef} title={refused.title} messages={refused.reasons} />}
        onEdit={() => setSaved('')}
        onSubmit={save}
      />
    </>
  )
}
