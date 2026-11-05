import type { CSSProperties } from 'react'
import { ChevronDown } from 'lucide-react'
import { organizationEn as content } from '../../content/organization.en'
import { usersEn } from '../../content/users.en'
import type { OrganizationDepartment, OrganizationHierarchy } from '../../services/organization'
import { UserAvatar } from '../ui/UserAvatar'
import './organizationChart.css'

export function OrganizationDepartmentCard({ department }: { department: OrganizationDepartment }) {
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
        {department.employees.length === 0 ? <p className="p-4 text-sm text-text-gray">{content.noEmployees}</p> : (
          <ul aria-label={department.name} tabIndex={0} className="max-h-80 overflow-y-auto overscroll-contain divide-y divide-beige">
            {department.employees.map((employee) => (
              <li key={employee.id} className="flex items-start gap-3 bg-offwhite p-3">
                <UserAvatar user={employee} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words text-maroon">{employee.name}</p>
                  {employee.position && <p className="mt-0.5 text-xs font-normal text-text-gray"><span className="sr-only">{content.positionLabel}: </span>{employee.position}</p>}
                  <p className="mt-0.5 text-xs font-normal text-text-gray">
                    <span className="sr-only">{content.permissionsLabel}: </span>
                    {employee.permissions.length ? employee.permissions.map((permission) => usersEn.permissions[permission]).join(', ') : usersEn.employee}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}

export function OrganizationChart({ hierarchy }: { hierarchy: OrganizationHierarchy }) {
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
                      <li key={department.id}><OrganizationDepartmentCard department={department} /></li>
                    ))}
                  </ul>
                </li>
              ))}
              {!hierarchy.divisions.length && direct.map((department) => <li key={department.id} className="org-branch"><OrganizationDepartmentCard department={department} /></li>)}
            </ul>
          )}
        </div>
      </section>
    </>
  )
}
