import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { organizationEn as content } from '../../content/organization.en'
import { usersEn } from '../../content/users.en'
import type { DivisionRow } from '../../lib/organization'
import { DepartmentBadge } from '../admin/DepartmentBadge'
import { CopyButton } from '../ui/CopyButton'
import { tableStyles } from '../ui/tableStyles'
import { UserAvatar } from '../ui/UserAvatar'

const NO_TOGGLES: ReadonlySet<string> = new Set()

/** An email with its copy button, or "—" (read as "No email") when there is none. */
function EmailCell({ email, name }: { email?: string | null; name: string }) {
  return (
    <td className="px-4 py-3 text-xs text-text-gray">
      {email ? (
        // One line: the copy button sits right after the email, which is truncated (full address on hover and for screen readers) so the button stays visible.
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5">
          <span title={email} className="min-w-0 truncate">{email}</span>
          <CopyButton text={email} label={content.copyEmail(name)} copiedText={content.copied} failedText={content.copyFailed} />
        </div>
      ) : <><span aria-hidden="true">—</span><span className="sr-only">{content.noEmail}</span></>}
    </td>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span aria-hidden="true" className="mt-0.5 shrink-0 rounded p-1 text-maroon group-hover:bg-beige">
      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
    </span>
  )
}

/**
 * The Organizational Structure table (view only): divisions → departments → staff, each level
 * opened with its chevron button. `filterKey` identifies the current search and filters: while
 * filtering, rows open automatically to show the results and can still be closed or opened by hand;
 * any change to the search or filters (including clearing them) starts again from those defaults.
 */
export function OrganizationTable({ rows, filtering, filterKey }: { rows: DivisionRow[]; filtering: boolean; filterKey: string }) {
  // The rows toggled by hand, from the default (closed, or opened automatically while filtering).
  const [toggles, setToggles] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: filterKey, ids: NO_TOGGLES })
  const toggled = toggles.key === filterKey ? toggles.ids : NO_TOGGLES
  const isOpen = (id: string, autoOpen: boolean) => (filtering && autoOpen) !== toggled.has(id)
  const toggle = (id: string) => {
    const next = new Set(toggled)
    if (next.has(id)) next.delete(id); else next.add(id)
    setToggles({ key: filterKey, ids: next })
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-beige bg-white">
      <table aria-label={content.title} className="w-full min-w-[600px] table-fixed text-left text-sm">
        {/* Fixed column widths, so expanding, searching, filtering or sorting never shifts the columns. */}
        <colgroup><col /><col className="w-[40%]" /></colgroup>
        <thead className={tableStyles.head}><tr>
          <th scope="col" className="p-4">{content.name}</th>
          <th scope="col" className="p-4">{content.email}</th>
        </tr></thead>
        {/* Each division is its own row group, with its departments and staff in the next one (the toggle's aria-controls target). */}
        {rows.map((division) => {
          const divisionKey = `division:${division.id}`
          const childrenId = `org-children-${division.id}`
          const divisionOpen = division.unassigned || isOpen(divisionKey, division.autoOpen)
          return (
            <Fragment key={divisionKey}>
              <tbody>
                {division.unassigned ? (
                  <tr className="border-t border-beige"><th scope="colgroup" colSpan={2} className="bg-beige/20 p-4 text-maroon">{content.unassigned}</th></tr>
                ) : (
                  <tr className="border-t border-beige">
                    <th scope="row" className="p-4">
                      {/* The chevron and the division name are one toggle. */}
                      <button type="button" aria-expanded={divisionOpen} aria-controls={childrenId}
                        className="group flex items-start gap-3 rounded text-left" onClick={() => toggle(divisionKey)}>
                        <Chevron open={divisionOpen} />
                        <span className="min-w-0"><span className="block font-semibold break-words text-maroon">{division.name}</span>
                          <span className="mt-1 block text-xs font-normal text-text-gray">{content.departmentCount(division.departmentCount)}</span></span>
                      </button>
                    </th>
                    <EmailCell email={division.email} name={division.name} />
                  </tr>
                )}
              </tbody>
              <tbody id={childrenId} hidden={!divisionOpen}>
                {division.departments.length === 0 && (
                  <tr className="border-t border-beige"><td colSpan={2} className="py-4 pl-16 text-text-gray">{content.noDepartments}</td></tr>
                )}
                {division.departments.map(({ department, staff, autoOpen }) => {
                  const departmentKey = `department:${department.id}`
                  const open = isOpen(departmentKey, autoOpen)
                  const staffIds = staff.length ? staff.map((person) => `org-staff-${department.id}-${person.id}`) : [`org-staff-${department.id}-none`]
                  return (
                    <Fragment key={departmentKey}>
                      <tr className="border-t border-beige hover:bg-beige/20">
                        <th scope="row" className="py-3 pr-4 pl-12 font-medium">
                          <span className="flex border-l border-beige pl-5">
                            <button type="button" aria-expanded={open} aria-controls={staffIds.join(' ')}
                              className="group flex min-w-0 items-start gap-3 rounded text-left" onClick={() => toggle(departmentKey)}>
                              <Chevron open={open} />
                              <DepartmentBadge department={department} />
                              <span className="min-w-0"><span className="block break-words text-maroon">{department.name}</span>
                                <span className="mt-1 block text-xs font-normal text-text-gray">{content.staffCount(department.employees.length)}</span></span>
                            </button>
                          </span>
                        </th>
                        <EmailCell email={department.email} name={department.name} />
                      </tr>
                      {staff.length === 0 ? (
                        <tr id={staffIds[0]} hidden={!open} className="border-t border-beige bg-offwhite">
                          <td colSpan={2} className="py-3 pr-4 pl-24 text-text-gray"><span className="block border-l border-beige pl-5">{content.noStaff}</span></td>
                        </tr>
                      ) : staff.map((person, index) => (
                        <tr key={person.id} id={staffIds[index]} hidden={!open} className="border-t border-beige bg-offwhite">
                          <th scope="row" className="py-3 pr-4 pl-24 font-normal">
                            <span className="flex items-center gap-3 border-l border-beige pl-5">
                              <UserAvatar user={person} />
                              <span className="min-w-0">
                                <span className="block font-medium break-words text-maroon">{person.name}</span>
                                {/* People without a role show nothing under their name. */}
                                {person.permissions.length > 0 && (
                                  <span className="mt-0.5 block text-xs text-text-gray">
                                    <span className="sr-only">{content.rolesLabel}: </span>
                                    {person.permissions.map((permission) => usersEn.permissions[permission]).join(', ')}
                                  </span>
                                )}
                              </span>
                            </span>
                          </th>
                          <EmailCell email={person.email} name={person.name} />
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </Fragment>
          )
        })}
        {rows.length === 0 && (
          <tbody><tr><td colSpan={2} className="p-10 text-center text-text-gray">{filtering ? content.noMatches : content.empty}</td></tr></tbody>
        )}
      </table>
    </div>
  )
}
