import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react'
import { flushSync } from 'react-dom'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, CircleCheck } from 'lucide-react'
import { blockerMessage } from '../../components/admin/blockerMessages'
import { DeleteUserButton } from '../../components/admin/DeleteUserButton'
import { PermissionBadges, UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { CheckboxGroup } from '../../components/ui/CheckboxGroup'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import type { Permission, User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { ADMIN_USERS_PATH, USER_PERMISSIONS_SECTION } from '../../lib/routes'
import { divisionLabel, involvement, PERMISSIONS, permissionChangeBlockers } from '../../lib/userAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'
import type { AdminUsersLocationState } from './AdminUsersPage'

/** Set by Add user, to show "User added." */
export interface UserDetailsLocationState {
  added?: boolean
}

/**
 * A user's page in the admin portal ("/admin/users/:id", PBI 17, 18, 19): their
 * details, their permissions (granted or revoked here; "#permissions-title" opens the page
 * there), the SOPs they are involved in, and Delete user in the header. Changes the rules
 * refuse are explained, naming the SOPs that block them. Deleted and unknown users show Not Found.
 */
export function UserDetailsPage() {
  const { id } = useParams()
  // Another user starts fresh (their permissions, no messages).
  return <UserDetails key={id} id={id} />
}

function UserDetails({ id }: { id: string | undefined }) {
  const text = adminEn.userDetails
  const { activeUsers } = useUsers()
  const user = activeUsers.find((item) => item.id === id)
  useDocumentTitle(user ? adminEn.pageTitle.replace('{page}', user.name) : undefined)

  if (!user) return <NotFoundPage embedded />

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

/** A white card with an h2 (focusable from script, to open the page at a section). */
function Panel({ id, title, children, headingRef }: { id: string; title: string; children: ReactNode; headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24 rounded-xl border border-beige bg-white p-5 sm:p-6">
      <h2 ref={headingRef} id={id} tabIndex={headingRef ? -1 : undefined} className="rounded-sm text-lg">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Reasons a change was refused (announced, and focused so keyboard users land on it). */
function RefusedBox({ title, messages, ref }: { title: string; messages: string[]; ref: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="mt-4 rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-4 py-3 text-sm text-status-rejected-fg focus:outline-none"
    >
      <p className="flex items-start gap-2 font-semibold">
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        {title}
      </p>
      <ul className="mt-1.5 list-disc space-y-1 pl-11">
        {messages.map((message) => (
          <li key={message}>{message}</li>
        ))}
      </ul>
    </div>
  )
}

function UserPanels({ user }: { user: User }) {
  const text = adminEn.userDetails
  const { activeUsers, updatePermissions } = useUsers()
  const admin = useCurrentUser()
  const { sops } = useSops()
  const { getDepartment } = useDepartments()
  const navigate = useNavigate()
  const location = useLocation()
  const rules = { actorId: admin.id, users: activeUsers, sops }

  const [added, setAdded] = useState(() => !!(location.state as UserDetailsLocationState | null)?.added)
  const [selected, setSelected] = useState<Permission[]>(user.permissions)
  const [saved, setSaved] = useState(false)
  const [permissionErrors, setPermissionErrors] = useState<string[]>([])
  const [deleteRefused, setDeleteRefused] = useState<{ title: string; reasons: string[] }>()
  const permissionErrorRef = useRef<HTMLDivElement>(null)
  const deleteErrorRef = useRef<HTMLDivElement>(null)
  const permissionsRef = useRef<HTMLHeadingElement>(null)

  const involved = involvement(user.id, sops)
  const department = getDepartment(user.departmentId)

  // Opened from "Edit permissions" on the list: go to the Permission section.
  const openAtPermissions = location.hash === '#' + USER_PERMISSIONS_SECTION
  useEffect(() => {
    if (!openAtPermissions) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    permissionsRef.current?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' })
    permissionsRef.current?.focus({ preventScroll: true })
  }, [openAtPermissions])

  function savePermissions() {
    setAdded(false)
    const blockers = permissionChangeBlockers(user, selected, rules)
    if (blockers.length > 0) {
      setSaved(false)
      flushSync(() => setPermissionErrors(blockers.map((blocker) => blockerMessage(blocker, user, text.blockers, true))))
      permissionErrorRef.current?.focus()
      return
    }
    updatePermissions(user.id, selected, rules)
    setPermissionErrors([])
    setSaved(true)
  }

  function deleted(message: string) {
    const state: AdminUsersLocationState = { deleted: message }
    navigate(ADMIN_USERS_PATH, { state })
  }

  function refuseDelete(title: string, reasons: string[]) {
    setAdded(false)
    flushSync(() => setDeleteRefused({ title, reasons }))
    deleteErrorRef.current?.focus()
  }

  // Same order and look as My Profile; an empty value shows notSet.
  const details: [string, string | undefined][] = [
    [text.details.name, user.name],
    [text.details.email, user.email],
    [text.details.phone, user.phone],
    [text.details.division, divisionLabel(department)],
    [text.details.department, department?.name],
    [text.details.position, user.position],
    [text.details.permission, user.permissions.map((permission) => usersEn.permissions[permission]).join(', ')],
  ]

  return (
    <>
      {/* Header, with Delete user at the top right */}
      <div className="mt-5 flex items-start gap-4">
        <UserAvatar user={user} className="size-14 text-base" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl break-words tracking-tight sm:text-3xl">{user.name}</h1>
          <PermissionBadges user={user} className="mt-2" />
        </div>
        <DeleteUserButton user={user} onDeleted={deleted} onRefused={refuseDelete} />
      </div>

      {deleteRefused && <RefusedBox ref={deleteErrorRef} title={deleteRefused.title} messages={deleteRefused.reasons} />}

      <div role="status">
        {added && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {text.added}
          </p>
        )}
      </div>

      <div className="mt-6 grid max-w-3xl gap-6">
        <Panel id="details-title" title={text.details.title}>
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
            {details.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="font-bold text-maroon">{label}</dt>
                <dd className="min-w-0 break-words text-maroon max-sm:mb-1">{value?.trim() || text.details.notSet}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel id={USER_PERMISSIONS_SECTION} title={text.permissions.title} headingRef={permissionsRef}>
          <CheckboxGroup
            name="permissions"
            legend={text.permissions.legend.replace('{name}', user.name)}
            hideLegend
            options={PERMISSIONS.map((permission) => ({
              value: permission,
              label: usersEn.permissions[permission],
              description: adminEn.permissionDescriptions[permission],
            }))}
            value={selected}
            onChange={(next) => {
              setSelected(PERMISSIONS.filter((permission) => next.includes(permission)))
              setSaved(false)
            }}
          />
          {permissionErrors.length > 0 && (
            <RefusedBox ref={permissionErrorRef} title={text.permissions.refused} messages={permissionErrors} />
          )}
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button onClick={savePermissions}>{text.permissions.save}</Button>
            <p role="status" className="text-sm font-medium text-status-approved-fg">
              {saved && (
                <span className="inline-flex items-center gap-1.5">
                  <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
                  {text.permissions.saved}
                </span>
              )}
            </p>
          </div>
        </Panel>

        <Panel id="involvement-title" title={text.involvement.title}>
          {involved.length === 0 ? (
            <p className="text-sm text-text-gray">{text.involvement.empty}</p>
          ) : (
            <ul aria-label={text.involvement.label} className="divide-y divide-beige">
              {involved.map(({ sop, roles }) => (
                <li key={sop.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-maroon">
                      {sop.title}
                    </p>
                    <p className="mt-0.5 text-text-gray">
                      <span className="sr-only">{text.involvement.rolesLabel} </span>
                      {roles.map((role) => text.involvement.roles[role]).join(', ')}
                    </p>
                  </div>
                  <StatusBadge status={sop.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  )
}
