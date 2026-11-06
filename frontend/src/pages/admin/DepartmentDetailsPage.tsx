import { useState, type ReactNode } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ArrowLeft, CircleCheck, Pencil } from 'lucide-react'
import { DepartmentBadge } from '../../components/admin/DepartmentBadge'
import { UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { CopyButton } from '../../components/ui/CopyButton'
import { adminEn } from '../../content/admin.en'
import { organizationAdminEn as orgText } from '../../content/organizationAdmin.en'
import type { Department, User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useOrganizationManagement } from '../../hooks/useOrganizationManagement'
import { members } from '../../lib/departmentAdmin'
import { adminDepartmentEditPath, adminUserPath } from '../../lib/routes'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'
import { NotFoundPage } from '../NotFoundPage'

/** Set by Add and Edit, to say what happened. */
export interface DepartmentDetailsLocationState {
  notice?: 'added' | 'updated'
}

/**
 * A department's page in the admin portal ("/admin/departments/:id", PBI 13): its description and
 * division, and its users, with Edit. The division comes from the admin management snapshot
 * (get_divisions_departments), the same source as the Divisions & Departments list, where a
 * department is also deleted. Removed and unknown departments show Not Found.
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

/** Users, each linking to their admin page, with their email and a small copy icon beside it. */
function PeopleList({ people, empty, label }: { people: User[]; empty: string; label: string }) {
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
              {/* The email and its copy icon stay together; a long address wraps, the confirmation takes its own line. */}
              {person.email && (
                <div className="flex flex-wrap items-center gap-x-1.5 text-text-gray">
                  <p className="min-w-0 break-all">{person.email}</p>
                  <CopyButton
                    text={person.email}
                    label={orgText.copyUserEmail.replace('{name}', person.name)}
                    copiedText={orgText.copied}
                    failedText={orgText.copyFailed}
                  />
                </div>
              )}
            </div>
          </li>
        ))}
    </ul>
  )
}

function DepartmentPanels({ department }: { department: Department }) {
  const text = adminEn.departmentDetails
  const { users } = useUsers()
  const management = useOrganizationManagement()
  const record = management.data?.departments.find((row) => row.id === department.id)
  const division = record?.division_id ? management.data?.divisions.find((item) => item.id === record.division_id) : undefined
  const location = useLocation()

  const [notice] = useState(() => (location.state as DepartmentDetailsLocationState | null)?.notice)
  const departmentUsers = members(department.id, users)
  const usersTitle = text.titleWithCount.replace('{title}', text.users.title).replace('{count}', String(departmentUsers.length))

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
        {notice && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {notice === 'added' ? text.added : text.updated}
          </p>
        )}
      </div>

      <div className="mt-6 grid max-w-3xl gap-6">
        <Panel id="details-title" title={text.details.title}>
          <dl className="grid gap-x-8 gap-y-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-w-0">
              <dt className="text-text-gray">{text.details.description}</dt>
              <dd className={`mt-0.5 break-words ${department.description ? 'font-medium text-maroon' : 'text-text-gray'}`}>
                {department.description || text.details.noDescription}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-text-gray">{orgText.division}</dt>
              {management.data ? (
                <dd className={`mt-0.5 break-words ${division ? 'font-medium text-maroon' : 'text-text-gray'}`}>{division?.name ?? orgText.divisionNone}</dd>
              ) : management.error ? (
                <dd role="alert" className="mt-0.5">
                  <p className="text-status-rejected-fg">{orgText.loadFailed}</p>
                  <Button variant="secondary" size="sm" className="mt-2" onClick={() => void management.refresh()}>{orgText.retry}</Button>
                </dd>
              ) : (
                <dd className="mt-0.5 text-text-gray">…</dd>
              )}
            </div>
          </dl>
        </Panel>

        <Panel id="users-title" title={usersTitle}>
          <PeopleList people={departmentUsers} empty={text.users.empty} label={text.users.title} />
        </Panel>
      </div>
    </>
  )
}
