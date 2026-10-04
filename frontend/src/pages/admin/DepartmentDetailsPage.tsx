import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, CircleCheck, Pencil, Trash2 } from 'lucide-react'
import { DepartmentBadge } from '../../components/admin/DepartmentBadge'
import { UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { adminEn } from '../../content/admin.en'
import { statusLabelsEn } from '../../content/status.en'
import type { Department, User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { formatCount } from '../../lib/count'
import { members, removalBlockers, sopsIn, withAccess } from '../../lib/departmentAdmin'
import { ADMIN_DEPARTMENTS_PATH, adminDepartmentEditPath, adminUserPath } from '../../lib/routes'
import { useDepartments } from '../../state/departmentsContext'
import { useRequests } from '../../state/requestsContext'
import { useCurrentUser } from '../../state/sessionContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'
import type { SopStatus } from '../../types/status'
import { NotFoundPage } from '../NotFoundPage'
import type { AdminDepartmentsLocationState } from './AdminDepartmentsPage'

/** Set by Add and Edit, to say what happened. */
export interface DepartmentDetailsLocationState {
  notice?: 'added' | 'updated'
}

/** SOP statuses, in lifecycle order. */
const SOP_STATUSES: SopStatus[] = ['draft', 'in-review', 'in-approval', 'returned', 'approved', 'published']

/**
 * A department's page in the admin portal ("/admin/departments/:id", PBI 13): its
 * details, members, users with access and SOP counts, with Edit and Remove. A
 * department that isn't empty can't be removed; what blocks it is listed.
 * Removed and unknown departments show Not Found.
 */
export function DepartmentDetailsPage() {
  const { id } = useParams()
  const { activeDepartments } = useDepartments()
  const department = activeDepartments.find((item) => item.id === id)
  const text = adminEn.departmentDetails
  useDocumentTitle(department ? adminEn.pageTitle.replace('{page}', department.name) : undefined)

  if (!department) return <NotFoundPage embedded />
  return (
    <>
      <Link
        to={text.back.href}
        className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-text-gray transition-colors hover:text-maroon"
      >
        <ArrowLeft aria-hidden="true" className="size-4" strokeWidth={1.75} />
        {text.back.label}
      </Link>
      {/* Another department starts fresh (no messages). */}
      <DepartmentPanels key={department.id} department={department} />
    </>
  )
}

/** A white card with an h2. */
function Panel({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-beige bg-white p-5 sm:p-6">
      <h2 id={id} className="text-lg">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** Users, each linking to their admin page. */
function PeopleList({ people, empty, label }: { people: User[]; empty: string; label: string }) {
  if (people.length === 0) return <p className="text-sm text-text-gray">{empty}</p>
  return (
    <ul aria-label={label} className="divide-y divide-beige">
      {[...people]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((person) => (
          <li key={person.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <UserAvatar user={person} />
            <div className="min-w-0 text-sm">
              <Link
                to={adminUserPath(person.id)}
                className="rounded-sm font-medium text-maroon underline-offset-2 hover:underline"
              >
                {person.name}
              </Link>
              <p className="break-all text-text-gray">{person.email}</p>
            </div>
          </li>
        ))}
    </ul>
  )
}

function DepartmentPanels({ department }: { department: Department }) {
  const text = adminEn.departmentDetails
  const { removeDepartment } = useDepartments()
  const { users } = useUsers()
  const { requests } = useRequests()
  const { sops } = useSops()
  const admin = useCurrentUser()
  const navigate = useNavigate()
  const location = useLocation()

  const [notice] = useState(() => (location.state as DepartmentDetailsLocationState | null)?.notice)
  const [showNotice, setShowNotice] = useState(!!notice)
  const [blockers, setBlockers] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const blockersRef = useRef<HTMLDivElement>(null)
  const removeButtonRef = useRef<HTMLButtonElement | null>(null)

  const data = { users, sops, requests }
  const withCount = (title: string, count: number) =>
    text.titleWithCount.replace('{title}', title).replace('{count}', String(count))
  const departmentMembers = members(department.id, users)
  const departmentWithAccess = withAccess(department.id, users, requests)
  const departmentSops = sopsIn(department.id, sops)

  function startRemove() {
    setShowNotice(false)
    const found = removalBlockers(department.id, data)
    if (found.length > 0) {
      const labels = { members: 'members', sops: 'sops', 'with-access': 'withAccess', 'pending-requests': 'pendingRequests' } as const
      flushSync(() => setBlockers(found.map((blocker) => formatCount(blocker.count, text.remove.blockers[labels[blocker.kind]]))))
      blockersRef.current?.focus()
      return
    }
    setBlockers([])
    setConfirming(true)
  }

  function confirmRemove() {
    setConfirming(false)
    removeDepartment(department.id, { actorId: admin.id, ...data })
    const state: AdminDepartmentsLocationState = { removed: text.remove.done.replace('{name}', department.name) }
    navigate(ADMIN_DEPARTMENTS_PATH, { state })
  }

  return (
    <>
      {/* Header */}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <DepartmentBadge department={department} className="size-14 text-base" />
          <h1 className="min-w-0 text-2xl tracking-tight break-words sm:text-3xl">{department.name}</h1>
        </div>
        <Button variant="secondary" to={adminDepartmentEditPath(department.id)} className="shrink-0 self-start sm:self-auto">
          <Pencil aria-hidden="true" className="size-4" strokeWidth={1.75} />
          {text.edit}
        </Button>
      </div>

      <div role="status">
        {showNotice && notice && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {notice === 'added' ? text.added : text.updated}
          </p>
        )}
      </div>

      <div className="mt-6 grid max-w-3xl gap-6">
        <Panel id="details-title" title={text.details.title}>
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-[auto_1fr]">
            <div>
              <dt className="text-text-gray">{text.details.initials}</dt>
              <dd className="mt-0.5 font-medium text-maroon">{department.initials}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-text-gray">{text.details.description}</dt>
              <dd className={`mt-0.5 ${department.description ? 'font-medium text-maroon' : 'text-text-gray'}`}>
                {department.description || text.details.noDescription}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel id="members-title" title={withCount(text.members.title, departmentMembers.length)}>
          <PeopleList people={departmentMembers} empty={text.members.empty} label={text.members.title} />
        </Panel>

        <Panel id="access-title" title={withCount(text.withAccess.title, departmentWithAccess.length)}>
          <p className="-mt-2 mb-3 text-sm text-text-gray">{text.withAccess.hint}</p>
          <PeopleList people={departmentWithAccess} empty={text.withAccess.empty} label={text.withAccess.title} />
        </Panel>

        <Panel id="sops-title" title={withCount(text.sops.title, departmentSops.length)}>
          <dl aria-label={text.sops.label} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SOP_STATUSES.map((status) => {
              const count = departmentSops.filter((sop) => sop.status === status).length
              return (
                <div key={status} className="rounded-lg border border-beige p-3.5">
                  <dt className={`text-sm ${count ? 'text-maroon' : 'text-text-gray'}`}>{statusLabelsEn[status]}</dt>
                  <dd className={`mt-1 text-2xl leading-none font-semibold tabular-nums ${count ? 'text-maroon' : 'text-text-gray'}`}>
                    {count}
                  </dd>
                </div>
              )
            })}
          </dl>
        </Panel>

        <Panel id="remove-title" title={text.remove.title}>
          <p className="text-sm text-text-gray">{text.remove.text}</p>
          {blockers.length > 0 && (
            <div
              ref={blockersRef}
              role="alert"
              tabIndex={-1}
              className="mt-4 rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-4 py-3 text-sm text-status-rejected-fg focus:outline-none"
            >
              <p className="flex items-start gap-2 font-semibold">
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                {text.remove.refused.replace('{name}', department.name)}
              </p>
              <ul className="mt-1.5 list-disc space-y-1 pl-11">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          )}
          <Button
            variant="danger"
            className="mt-4"
            onClick={(event) => {
              removeButtonRef.current = event.currentTarget
              startRemove()
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
            {text.remove.button}
          </Button>
        </Panel>
      </div>

      <ConfirmDialog
        open={confirming}
        title={text.remove.dialog.title.replace('{name}', department.name)}
        description={text.remove.dialog.description}
        cancelLabel={text.remove.dialog.cancel}
        confirmLabel={text.remove.dialog.confirm}
        onConfirm={confirmRemove}
        onCancel={() => {
          setConfirming(false)
          removeButtonRef.current?.focus()
        }}
      />
    </>
  )
}
