import { useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleAlert, CircleCheck, Pencil, Trash2 } from 'lucide-react'
import { DeleteDepartmentDialog } from '../../components/admin/DeleteDepartmentDialog'
import { DepartmentBadge } from '../../components/admin/DepartmentBadge'
import { EmployeePositionsDialog } from '../../components/admin/EmployeePositionsDialog'
import { UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { PageLoading } from '../../components/ui/PageLoading'
import { adminEn } from '../../content/admin.en'
import { organizationAdminEn as orgText } from '../../content/organizationAdmin.en'
import { statusLabelsEn } from '../../content/status.en'
import type { Department, User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useOrganizationManagement } from '../../hooks/useOrganizationManagement'
import { formatCount } from '../../lib/count'
import { members, withAccess } from '../../lib/departmentAdmin'
import { ADMIN_DEPARTMENTS_PATH, adminDepartmentEditPath, adminUserPath } from '../../lib/routes'
import type { ManagedPerson } from '../../services/organizationAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { useRequests } from '../../state/requestsContext'
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
 * details and division, members (with their positions), users with access and SOP
 * counts, with Edit and Delete. The division, positions, SOP counts and deletion come
 * from the admin management snapshot (get_divisions_departments) and its RPCs, the same
 * source as the Divisions & Departments list. Removed and unknown departments show Not Found.
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

/** Users, each linking to their admin page, with optional details after the email. */
function PeopleList({ people, empty, label, details }: { people: User[]; empty: string; label: string; details?: (person: User) => ReactNode }) {
  if (people.length === 0) return <p className="text-sm text-text-gray">{empty}</p>
  return (
    <ul aria-label={label} className="divide-y divide-beige">
      {[...people]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((person) => (
          <li key={person.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
            <UserAvatar user={person} />
            <div className="min-w-0 flex-1 text-sm">
              <Link
                to={adminUserPath(person.id)}
                className="rounded-sm font-medium text-maroon underline-offset-2 hover:underline"
              >
                {person.name}
              </Link>
              <p className="break-all text-text-gray">{person.email}</p>
            </div>
            {details?.(person)}
          </li>
        ))}
    </ul>
  )
}

/** While the management snapshot loads or can't be loaded. */
function SnapshotState({ error, onRetry }: { error?: string; onRetry: () => void }) {
  if (!error) return <PageLoading />
  return (
    <div role="alert">
      <p className="text-sm text-status-rejected-fg">{orgText.loadFailed}</p>
      <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>{orgText.retry}</Button>
    </div>
  )
}

function DepartmentPanels({ department }: { department: Department }) {
  const text = adminEn.departmentDetails
  const { users } = useUsers()
  const { requests } = useRequests()
  const management = useOrganizationManagement()
  const record = management.data?.departments.find((row) => row.id === department.id)
  const division = record?.division_id ? management.data?.divisions.find((item) => item.id === record.division_id) : undefined
  const navigate = useNavigate()
  const location = useLocation()

  const [notice] = useState(() => (location.state as DepartmentDetailsLocationState | null)?.notice)
  const [showNotice, setShowNotice] = useState(!!notice)
  const [blockers, setBlockers] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)
  const [editingPerson, setEditingPerson] = useState<ManagedPerson>()
  const [positionsSaved, setPositionsSaved] = useState(false)
  const blockersRef = useRef<HTMLDivElement>(null)
  const removeButtonRef = useRef<HTMLButtonElement | null>(null)
  const retry = () => void management.refresh()

  const withCount = (title: string, count: number) =>
    text.titleWithCount.replace('{title}', title).replace('{count}', String(count))
  const departmentMembers = members(department.id, users)
  const departmentWithAccess = withAccess(department.id, users, requests)
  const people = new Map((record?.people ?? []).map((person) => [person.id, person]))

  // The server refuses to delete a department with employees; say so before asking.
  function startRemove() {
    setShowNotice(false)
    setPositionsSaved(false)
    if (!record) return
    if (record.employees > 0 && !record.deletion_job_id) {
      flushSync(() => setBlockers([formatCount(record.employees, text.remove.blockers.members)]))
      blockersRef.current?.focus()
      return
    }
    setBlockers([])
    setConfirming(true)
  }

  function positionsOf(person: User) {
    const managed = people.get(person.id)
    if (!managed) return null
    return (
      <div className="flex shrink-0 items-center gap-2">
        <p className={`text-right text-sm ${managed.positions.length ? 'text-maroon' : 'text-text-gray'}`}>
          <span className="sr-only">{orgText.positions}: </span>
          {managed.positions.length ? managed.positions.join(', ') : orgText.noPositions}
        </p>
        <IconButton
          icon={Pencil}
          label={orgText.editPositions.replace('{name}', person.name)}
          disabledReason={record?.deletion_job_id ? orgText.cleanupPending : undefined}
          onClick={() => { setShowNotice(false); setPositionsSaved(false); setEditingPerson(managed) }}
        />
      </div>
    )
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
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-[auto_auto_1fr]">
            <div>
              <dt className="text-text-gray">{orgText.division}</dt>
              <dd className={`mt-0.5 ${division ? 'font-medium text-maroon' : 'text-text-gray'}`}>
                {management.data ? (division?.name ?? orgText.divisionNone) : management.error ? orgText.loadFailed : '…'}
              </dd>
            </div>
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
          <PeopleList people={departmentMembers} empty={text.members.empty} label={text.members.title} details={positionsOf} />
          <p role="status" className="mt-3 text-sm text-status-approved-fg">{positionsSaved ? orgText.positionsSaved : ''}</p>
        </Panel>

        <Panel id="access-title" title={withCount(text.withAccess.title, departmentWithAccess.length)}>
          <p className="-mt-2 mb-3 text-sm text-text-gray">{text.withAccess.hint}</p>
          <PeopleList people={departmentWithAccess} empty={text.withAccess.empty} label={text.withAccess.title} />
        </Panel>

        <Panel id="sops-title" title={record ? withCount(text.sops.title, record.sops) : text.sops.title}>
          {!record ? <SnapshotState error={management.error} onRetry={retry} /> : (
            <dl aria-label={text.sops.label} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {SOP_STATUSES.map((status) => {
                const count = record.status_counts[status] ?? 0
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
          )}
        </Panel>

        <Panel id="remove-title" title={text.remove.title}>
          <p className="text-sm text-text-gray">{record?.deletion_job_id ? orgText.cleanupDescription : text.remove.text}</p>
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
          {!record ? <div className="mt-4"><SnapshotState error={management.error} onRetry={retry} /></div> : (
            <Button
              variant="danger"
              className="mt-4"
              onClick={(event) => {
                removeButtonRef.current = event.currentTarget
                startRemove()
              }}
            >
              <Trash2 aria-hidden="true" className="size-4" strokeWidth={1.75} />
              {record.deletion_job_id ? orgText.retryCleanup : text.remove.button}
            </Button>
          )}
        </Panel>
      </div>

      {editingPerson && (
        <EmployeePositionsDialog
          person={editingPerson}
          onClose={() => setEditingPerson(undefined)}
          onSaved={() => { setPositionsSaved(true); void management.refresh() }}
        />
      )}
      {confirming && record && (
        <DeleteDepartmentDialog
          department={record}
          onClose={() => { setConfirming(false); removeButtonRef.current?.focus() }}
          onDeleted={() => {
            const state: AdminDepartmentsLocationState = { removed: text.remove.done.replace('{name}', department.name) }
            navigate(ADMIN_DEPARTMENTS_PATH, { state })
          }}
        />
      )}
    </>
  )
}
