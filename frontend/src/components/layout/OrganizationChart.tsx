import { useState, type CSSProperties } from 'react'
import { ChevronDown, Funnel, Mail, Search } from 'lucide-react'
import { organizationEn as content } from '../../content/organization.en'
import { usersEn } from '../../content/users.en'
import { filterPeople, OTHERS_FILTER, roleFilters, type RoleFilter } from '../../lib/organization'
import type { OrganizationDepartment, OrganizationHierarchy } from '../../services/organization'
import { CopyButton } from '../ui/CopyButton'
import { MultiSelectField } from '../ui/MultiSelectField'
import { TextField } from '../ui/TextField'
import { UserAvatar } from '../ui/UserAvatar'
import './organizationChart.css'

/**
 * One department: a disclosure with its employees. When it has employees, its own name search and
 * role filter (one row: the search takes the width, the filter is an icon button at the end) narrow the list.
 */
export function OrganizationDepartmentCard({ department, isQuality = false }: { department: OrganizationDepartment; isQuality?: boolean }) {
  const [query, setQuery] = useState('')
  const [roles, setRoles] = useState<RoleFilter[]>([])
  const shown = filterPeople(department.employees, query, roles)
  const roleOptions = roleFilters(isQuality).map((role) => ({ value: role, label: role === OTHERS_FILTER ? content.others : usersEn.permissions[role] }))
  return (
    <details className="group min-w-0 rounded-xl border border-beige bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4 text-maroon transition-colors hover:bg-beige/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold break-words">{department.name}</span>
          <span className="mt-1 block text-xs text-text-gray">{content.employees(department.employees.length)}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 motion-safe:transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-beige">
        {department.employees.length === 0 ? <p className="p-4 text-sm text-text-gray">{content.noEmployees}</p> : (<>
          <div role="search" aria-label={content.searchAndFilterLabel(department.name)} className="flex items-center gap-2 border-b border-beige p-3">
            <TextField
              name={`organization-search-${department.id}`}
              type="search"
              label={content.searchLabel}
              labelHidden
              compact
              placeholder={content.searchPlaceholder}
              autoComplete="off"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              endAdornment={<Search aria-hidden="true" className="mr-2 size-4 text-text-gray" />}
              className="min-w-0 flex-1"
            />
            <MultiSelectField
              trigger="icon"
              icon={Funnel}
              name={`organization-roles-${department.id}`}
              label={content.filterLabel}
              buttonLabel={roles.length ? content.filterSelected(roles.length) : content.filterLabel}
              placeholder={content.filterLabel}
              emptyText={content.filterEmpty}
              options={roleOptions}
              value={roles}
              onChange={(next) => setRoles(next as RoleFilter[])}
            />
          </div>
          {/* Announced when nothing matches. */}
          <p role="status" className={shown.length ? 'sr-only' : 'p-4 text-sm text-text-gray'}>{shown.length ? '' : content.noMatches}</p>
          {shown.length > 0 && <ul aria-label={department.name} tabIndex={0} className="max-h-80 overflow-y-auto overscroll-contain divide-y divide-beige">
            {shown.map((employee) => (
              // Two columns: the avatar beside the name and roles, then the envelope beside the email line.
              <li key={employee.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 bg-offwhite p-3">
                <UserAvatar user={employee} />
                <div className="min-w-0">
                  <p className="text-sm font-medium break-words text-maroon">{employee.name}</p>
                  {/* People without a role show no role line here. */}
                  {employee.permissions.length > 0 && (
                    <p className="mt-0.5 text-xs font-normal text-text-gray">
                      <span className="sr-only">{content.permissionsLabel}: </span>
                      {employee.permissions.map((permission) => usersEn.permissions[permission]).join(', ')}
                    </p>
                  )}
                </div>
                {/* Decorative: centred under the avatar, on the email line's height (the copy button's 24px). */}
                <span aria-hidden="true" className="flex h-6 items-center justify-center text-text-gray">
                  <Mail aria-hidden="true" className="size-4" strokeWidth={1.75} />
                </span>
                {/* One line: the email is truncated (full address on hover and for screen readers), the copy button stays at the end. */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs font-normal text-text-gray">
                  <p title={employee.email} className="min-w-0 flex-1 truncate"><span className="sr-only">{content.emailLabel}: </span>{employee.email}</p>
                  <CopyButton text={employee.email} label={content.copyEmail(employee.name)} copiedText={content.copied} failedText={content.copyFailed} />
                </div>
              </li>
            ))}
          </ul>}
        </>)}
      </div>
    </details>
  )
}

/** `qualityDepartmentId`: the Quality department (the only one whose role filter offers Approver). */
export function OrganizationChart({ hierarchy, qualityDepartmentId }: { hierarchy: OrganizationHierarchy; qualityDepartmentId?: string }) {
  const direct = hierarchy.departments.filter((department) => !hierarchy.divisions.some((division) => division.id === department.divisionId))
  const branches = hierarchy.divisions.map((division) => ({
    key: `division:${division.id}`, name: division.name,
    departments: hierarchy.departments.filter((department) => department.divisionId === division.id),
  }))
  if (hierarchy.divisions.length && direct.length) branches.push({ key: 'unassigned', name: content.directDepartments, departments: direct })
  const branchCount = hierarchy.divisions.length ? branches.length : direct.length
  const columns = {
    '--org-columns-small': Math.min(2, branchCount),
    '--org-columns-wide': Math.min(4, branchCount),
  } as CSSProperties
  return (
    <>
      {!hierarchy.divisions.length && hierarchy.departments.length > 0 && <p className="mt-6 text-sm text-text-gray">{content.noDivisions}</p>}
      <section aria-label={content.title} className="mt-6 min-w-0 rounded-xl border border-beige bg-white/50 p-3 sm:p-5">
        <div className="org-chart mx-auto w-full min-w-0">
          <div className={`org-root mx-auto w-full max-w-72 rounded-xl bg-maroon px-5 py-5 text-center shadow-sm${branchCount ? ' org-root--connected' : ''}`}>
            <h2 className="text-lg !text-white">{hierarchy.organization?.name || content.organization}</h2>
          </div>
          {!hierarchy.departments.length && !hierarchy.divisions.length ? <p className="mt-8 text-center text-sm text-text-gray">{content.empty}</p> : (
            <ul className={`org-branches${branchCount <= 4 ? ' org-branches--single-row' : ''}`} style={columns}>
              {branches.map((branch) => (
                <li key={branch.key} className="org-branch">
                  <div className="org-division-header flex items-center justify-center rounded-xl border border-beige bg-beige p-4 text-center shadow-sm">
                    <h3 className="text-sm text-maroon">{branch.name}</h3>
                  </div>
                  <ul className="org-departments">
                    {branch.departments.map((department) => (
                      <li key={department.id}><OrganizationDepartmentCard department={department} isQuality={department.id === qualityDepartmentId} /></li>
                    ))}
                  </ul>
                </li>
              ))}
              {!hierarchy.divisions.length && direct.map((department) => <li key={department.id} className="org-branch"><OrganizationDepartmentCard department={department} isQuality={department.id === qualityDepartmentId} /></li>)}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
