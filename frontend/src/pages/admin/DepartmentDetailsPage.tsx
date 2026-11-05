import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, CircleCheck, Pencil, Trash2 } from 'lucide-react'
import { DepartmentBadge } from '../../components/admin/DepartmentBadge'
import { UserAvatar } from '../../components/admin/UserBits'
import { PageLoading } from '../../components/ui/PageLoading'
import { Button } from '../../components/ui/Button'
import { DeleteDepartmentDialog } from '../../components/admin/DeleteDepartmentDialog'
import { IconButton } from '../../components/ui/IconButton'
import { PermissionBadges } from '../../components/admin/UserBits'
import { useOrganizationManagement } from '../../hooks/useOrganizationManagement'
import { organizationAdminEn as orgText } from '../../content/organizationAdmin.en'
import { adminEn } from '../../content/admin.en'
import { statusLabelsEn } from '../../content/status.en'
import type { Department, User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { withAccess } from '../../lib/departmentAdmin'
import { adminDepartmentEditPath, adminUserPath } from '../../lib/routes'
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

/** Department details with authoritative employees, role badges and SOP statistics. */
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
  const { users } = useUsers()
  const { requests } = useRequests()
  const management = useOrganizationManagement()
  const record = management.data?.departments.find((row) => row.id === department.id)
  const navigate = useNavigate()
  const location = useLocation()

  const [notice] = useState(() => (location.state as DepartmentDetailsLocationState | null)?.notice)
  const [showNotice, setShowNotice] = useState(!!notice)
  const [confirming, setConfirming] = useState(false)
  const withCount = (title: string, count: number) =>
    text.titleWithCount.replace('{title}', title).replace('{count}', String(count))
  const departmentMembers = record?.people ?? []
  const departmentWithAccess = withAccess(department.id, users, requests)
  const sopCount = record?.sops ?? 0

  return (
    <>
      {/* Header */}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <DepartmentBadge department={department} className="size-14 text-base" />
          <div><h1 className="min-w-0 text-2xl tracking-tight break-words sm:text-3xl">{department.name}</h1>
          <p className="mt-2 text-sm text-text-gray">{department.description}</p></div>
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
        <Panel id="members-title" title={record ? withCount(orgText.employees, record.employees) : orgText.employees}>
          {!record ? <PageLoading /> : departmentMembers.length === 0 ? <p className="text-sm text-text-gray">{text.members.empty}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead><tr><th className="pb-3">{orgText.name}</th><th className="pb-3">{orgText.email}</th><th className="pb-3">{orgText.position}</th></tr></thead>
            <tbody>{departmentMembers.map((person) => <tr key={person.id} className="border-t border-beige">
              <th scope="row" className="py-3 pr-4 font-medium"><Link to={adminUserPath(person.id)} className="text-maroon hover:underline">{person.name}</Link></th>
              <td className="py-3 pr-4">{person.email}</td><td className="py-3"><PermissionBadges user={person} /></td>
            </tr>)}</tbody></table></div>}
        </Panel>

        <Panel id="access-title" title={withCount(text.withAccess.title, departmentWithAccess.length)}>
          <p className="-mt-2 mb-3 text-sm text-text-gray">{text.withAccess.hint}</p>
          <PeopleList people={departmentWithAccess} empty={text.withAccess.empty} label={text.withAccess.title} />
        </Panel>

        <Panel id="sops-title" title={record ? withCount(text.sops.title, sopCount) : text.sops.title}>
          {!record ? management.error ? <div role="alert"><p>{orgText.loadFailed}</p><Button onClick={() => void management.refresh()}>{orgText.retry}</Button></div> : <PageLoading /> : <dl aria-label={text.sops.label} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SOP_STATUSES.map((status) => {
              const count = record?.status_counts[status] ?? 0
              return (
                <div key={status} className="rounded-lg border border-beige p-3.5">
                  <dt className={`text-sm ${count ? 'text-maroon' : 'text-text-gray'}`}>{statusLabelsEn[status]}</dt>
                  <dd className={`mt-1 text-2xl leading-none font-semibold tabular-nums ${count ? 'text-maroon' : 'text-text-gray'}`}>
                    {count}
                  </dd>
                </div>
              )
            })}
          </dl>}
        </Panel>

        <IconButton label={record?.deletion_job_id ? orgText.retryCleanup : orgText.delete} icon={Trash2} danger
          disabledReason={(record?.employees ?? 0) > 0 ? orgText.departmentBlocked : !record ? orgText.loadFailed : undefined}
          onClick={() => { setShowNotice(false); setConfirming(true) }} />
      </div>
      {confirming && record && <DeleteDepartmentDialog department={record} onClose={() => setConfirming(false)}
        onDeleted={() => { const state: AdminDepartmentsLocationState = { removed: text.remove.done.replace('{name}', department.name) }; navigate('/admin/divisions-departments', { state }) }} />}

    </>
  )
}
