import { useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleCheck } from 'lucide-react'
import { blockerMessage } from '../../components/admin/blockerMessages'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserForm } from '../../components/admin/UserForm'
import { UserHeader } from '../../components/admin/UserHeader'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { ADMIN_USERS_PATH, adminAdminPath } from '../../lib/routes'
import { isSystemAdmin, permissionChangeBlockers, responsibilitiesInProgress, transfersDepartment, userFormValues, type NewUser } from '../../lib/userAdmin'
import { ChangeEmailError, SaveUserError, type SaveUserFailure } from '../../services/people'
import { useDepartments } from '../../state/departmentsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'
import type { AdminUsersLocationState } from './AdminUsersPage'

/**
 * Edit Staff ("/admin/users/:id/edit", opened from the Staff list and a staff member's page): the staff
 * member's page header (with "Edit Staff" above the name and Delete beside it), then the Add Staff form,
 * filled in with their details. Save stays here; a change the rules or the database refuse saves nothing
 * and is explained. Everything is saved to the database; a new email also changes their sign-in
 * account. Moving someone to another department is refused while they have SOP work in progress.
 * Leaving with unsaved changes asks first. Deleted and unknown staff show Not Found.
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
  // Administrators are managed on Manage Organization → Admins.
  if (isSystemAdmin(user)) return <Navigate to={adminAdminPath(user.id)} replace />

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

  /** "Department Transfer Not Allowed" with the explanation and, when known, how many SOPs block it. */
  function refuseTransfer(blockingSops: number) {
    const count = blockingSops > 0
      ? [(blockingSops === 1 ? content.transfer.count.one : content.transfer.count.other).replace('{count}', String(blockingSops))]
      : []
    refuse(content.transfer.title, [content.transfer.message, ...count])
  }

  /** What to tell the admin about a save the database refused. */
  function failureMessages(error: unknown): string[] {
    const reason: SaveUserFailure = error instanceof SaveUserError ? error.reason : 'failed'
    if (reason === 'department-transfer-blocked') return [content.failures.failed]
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
    // The database refuses it too (profiles_department_transfer_guard); this explains it without a round trip.
    if (transfersDepartment(user, next)) {
      const work = responsibilitiesInProgress(user, sops)
      if (work.total > 0) {
        refuseTransfer(work.total)
        return
      }
    }
    try {
      await updateUser(user.id, next, rules)
    } catch (error) {
      if (error instanceof SaveUserError && error.reason === 'department-transfer-blocked') {
        refuseTransfer(error.blockingSops)
      } else if (error instanceof ChangeEmailError) {
        // The other changes are saved: the form starts again from them, with the email as it was.
        setSavedCount((count) => count + 1)
        refuse(content.emailNotSaved, [content.emailFailures[error.reason]])
      } else {
        refuse(content.notSaved, failureMessages(error))
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
        unsavedChanges={content.discard}
      />
    </>
  )
}
