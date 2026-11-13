import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { organizationEn as content } from '../../content/organization.en'
import { usersEn } from '../../content/users.en'
import { overflows, type DivisionRow } from '../../lib/organization'
import { DepartmentBadge } from '../admin/DepartmentBadge'
import { CopyButton } from '../ui/CopyButton'
import { tableStyles } from '../ui/tableStyles'
import { UserAvatar } from '../ui/UserAvatar'
import { DepartmentDetailsPreview, type DepartmentDetailsPreviewDepartment } from './DepartmentDetailsPreview'
import { StaffProfilePreview, type StaffProfilePreviewPerson } from './StaffProfilePreview'

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

/** The Email column's share of the table's width; the Name column has the rest. */
const EMAIL_COLUMN_PERCENT = 40

/**
 * A department's staff as a table of their own (same columns as the main table, screen-reader-only
 * headers), in a box about 6 rows tall that scrolls when they don't fit: only that box scrolls,
 * never the division and department rows. Only while it actually overflows (checked when shown and
 * whenever its size or content changes, e.g. names wrapping on a narrow screen) is it a named,
 * focusable region, so keyboard users can scroll it with the arrow keys. Tabbing to a copy button
 * inside scrolls it into view; nothing traps focus. A visible scrollbar takes width, so the Name
 * column grows by the same share to keep the emails under the main table's Email column.
 */
function StaffTable({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ scrollable: false, widthRatio: 1 })
  useEffect(() => {
    const element = ref.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const check = () => {
      const scrollable = overflows(element.scrollHeight, element.clientHeight)
      // Full width (with the scrollbar) over the width left for the table.
      const widthRatio = element.clientWidth > 0 ? element.offsetWidth / element.clientWidth : 1
      setBox((current) => current.scrollable === scrollable && current.widthRatio === widthRatio ? current : { scrollable, widthRatio })
    }
    const observer = new ResizeObserver(check)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    check()
    return () => observer.disconnect()
  }, [])
  // Only the Name column gets a width; the Email column takes the rest (setting both would make the browser scale them).
  const nameWidth = { width: `${(100 - EMAIL_COLUMN_PERCENT) * box.widthRatio}%` }
  return (
    <div ref={ref} className="max-h-[22.5rem] overflow-y-auto overscroll-contain"
      {...(box.scrollable ? { tabIndex: 0, role: 'region', 'aria-label': label } : {})}>
      <table aria-label={label} className="w-full table-fixed text-left text-sm">
        <colgroup><col style={nameWidth} /><col /></colgroup>
        <thead className="sr-only"><tr><th scope="col">{content.name}</th><th scope="col">{content.email}</th></tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** A name that opens a pop-up (a staff member's or a department's): it looks like a link, as on every list. */
const PREVIEW_NAME = 'block cursor-pointer rounded-sm text-left break-words text-maroon underline underline-offset-2'

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
 * Each staff member's name is a button that opens their Profile Preview (StaffProfilePreview). A department's
 * arrow opens and closes its staff; its name is a separate button that opens its details (DepartmentDetailsPreview,
 * read-only). Closing a pop-up returns focus to the name. `departmentDescription` gives a department's description
 * (from the departments every signed-in user loads).
 */
export function OrganizationTable({ rows, filtering, filterKey, departmentDescription }: {
  rows: DivisionRow[]; filtering: boolean; filterKey: string; departmentDescription?: (id: string) => string | undefined
}) {
  // The rows toggled by hand, from the default (closed, or opened automatically while filtering).
  const [toggles, setToggles] = useState<{ key: string; ids: ReadonlySet<string> }>({ key: filterKey, ids: NO_TOGGLES })
  const toggled = toggles.key === filterKey ? toggles.ids : NO_TOGGLES
  const isOpen = (id: string, autoOpen: boolean) => (filtering && autoOpen) !== toggled.has(id)
  const [preview, setPreview] = useState<StaffProfilePreviewPerson>()
  const [departmentPreview, setDepartmentPreview] = useState<DepartmentDetailsPreviewDepartment>()
  const previewOpener = useRef<HTMLButtonElement | null>(null)
  function closePreview() {
    setPreview(undefined)
    setDepartmentPreview(undefined)
    previewOpener.current?.focus()
  }
  const toggle = (id: string) => {
    const next = new Set(toggled)
    if (next.has(id)) next.delete(id); else next.add(id)
    setToggles({ key: filterKey, ids: next })
  }

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-beige bg-white">
      <table aria-label={content.title} className="w-full min-w-[600px] table-fixed text-left text-sm">
        {/* Fixed column widths, so expanding, searching, filtering or sorting never shifts the columns. */}
        <colgroup><col /><col style={{ width: `${EMAIL_COLUMN_PERCENT}%` }} /></colgroup>
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
                  const staffId = `org-staff-${department.id}`
                  return (
                    <Fragment key={departmentKey}>
                      <tr className="border-t border-beige hover:bg-beige/20">
                        <th scope="row" className="py-3 pr-4 pl-12 font-medium">
                          <span className="flex min-w-0 items-start gap-3 border-l border-beige pl-5">
                            {/* Two buttons: the arrow shows or hides the staff; the name opens the department's details. */}
                            <button type="button" aria-expanded={open} aria-controls={staffId} aria-label={content.departmentPreview.toggle(department.name)}
                              className="group -m-0.5 shrink-0 rounded p-0.5" onClick={() => toggle(departmentKey)}>
                              <Chevron open={open} />
                            </button>
                            <DepartmentBadge department={department} />
                            <span className="min-w-0">
                              <button type="button" aria-haspopup="dialog" aria-label={content.departmentPreview.open(department.name)}
                                className={PREVIEW_NAME}
                                onClick={(event) => {
                                  previewOpener.current = event.currentTarget
                                  setDepartmentPreview({
                                    name: department.name, divisionName: division.unassigned ? undefined : division.name,
                                    description: departmentDescription?.(department.id), email: department.email,
                                  })
                                }}>
                                {department.name}
                              </button>
                              <span className="mt-1 block text-xs font-normal text-text-gray">{content.staffCount(department.employees.length)}</span>
                            </span>
                          </span>
                        </th>
                        <EmailCell email={department.email} name={department.name} />
                      </tr>
                      {staff.length === 0 ? (
                        <tr id={staffId} hidden={!open} className="border-t border-beige bg-offwhite">
                          <td colSpan={2} className="py-3 pr-4 pl-24 text-text-gray"><span className="block border-l border-beige pl-5">{content.noStaff}</span></td>
                        </tr>
                      ) : (
                        // One row holding the staff as a table of their own (same columns, so they line up), which can scroll.
                        <tr id={staffId} hidden={!open} className="border-t border-beige bg-offwhite">
                          <td colSpan={2} className="p-0">
                            <StaffTable label={content.staffListLabel(department.name)}>
                                  {staff.map((person) => (
                                    <tr key={person.id} className="border-t border-beige first:border-t-0">
                                      <th scope="row" className="py-3 pr-4 pl-24 font-normal">
                                        <span className="flex items-center gap-3 border-l border-beige pl-5">
                                          <UserAvatar user={person} />
                                          <span className="min-w-0">
                                            <button type="button" aria-haspopup="dialog" aria-label={content.profilePreview.open(person.name)}
                                              className={`${PREVIEW_NAME} font-medium`}
                                              onClick={(event) => {
                                                previewOpener.current = event.currentTarget
                                                setPreview({ person, departmentName: department.name, divisionName: division.unassigned ? undefined : division.name })
                                              }}>
                                              {person.name}
                                            </button>
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
                            </StaffTable>
                          </td>
                        </tr>
                      )}
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
      {preview && <StaffProfilePreview preview={preview} onClose={closePreview} />}
      {departmentPreview && <DepartmentDetailsPreview department={departmentPreview} onClose={closePreview} />}
    </div>
  )
}
