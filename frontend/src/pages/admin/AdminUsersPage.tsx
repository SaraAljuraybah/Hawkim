import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleAlert, CircleCheck, Eye, Pencil, Plus, Users } from 'lucide-react'
import { DeleteUserButton } from '../../components/admin/DeleteUserButton'
import { ReactivateUserButton } from '../../components/admin/ReactivateUserButton'
import { PermissionBadges, UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { FilterPopover } from '../../components/ui/FilterPopover'
import { SelectField } from '../../components/ui/SelectField'
import { Tabs } from '../../components/ui/Tabs'
import { tabIds } from '../../components/ui/tabIds'
import { TextField } from '../../components/ui/TextField'
import { tableStyles } from '../../components/ui/tableStyles'
import { LIST_TOOLBAR } from '../../components/ui/toolbar'
import { adminEn } from '../../content/admin.en'
import { filtersEn } from '../../content/filters.en'
import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { departmentsKept, filterDepartmentsFrom, filterSelection, OTHERS_FILTER, ROLE_FILTERS, type RoleFilter } from '../../lib/organization'
import { listParam, readChoice, readList, updateParams } from '../../lib/pagination'
import { adminUserEditPath, adminUserPath } from '../../lib/routes'
import { clearedStaffParams, divisionLabel, filterUsers, STAFF_SORTS, STAFF_STATUSES, staffSortGroup, staffWithStatus, type StaffSort, type StaffStatus } from '../../lib/userAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'

/**
 * The Permission chips, labelled as on the badges: Author, Reviewer and Approver (Admins are on the Admins page),
 * then Others (none of the three), the same choices and rule as Organizational Structure's filter.
 */
const permissionOptions = ROLE_FILTERS.map((role) => ({ value: role, label: role === OTHERS_FILTER ? filtersEn.permission.others : usersEn.permissions[role] }))

/** Ids of the Active Staff / Deactive Staff tabs and their panel. */
const TAB_ID_PREFIX = 'staff-status'

/** Set after deleting (or reactivating) a user, to say so on the list. */
export interface AdminUsersLocationState {
  deleted?: string
}

/**
 * Staff ("/admin/users", PBI 17): one search, the Filter (Division, Department and Permission, several of each,
 * kept in the URL), Sort by name (in the URL too), Clear Filters, then the Active Staff and Deactive Staff tabs
 * (`?status=deactivated`, Active Staff by default) right above the table. Search, Filter and Sort apply to the
 * selected tab's staff only. Active Staff rows have Delete (it deactivates them); Deactive Staff rows have
 * Reactivate in that column. Administrators aren't staff: they are on Manage Organization → Admins.
 */
export function AdminUsersPage() {
  const content = adminEn.usersList
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  // Every profile (deactivated ones included); each tab shows its own staff.
  const { users: everyone } = useUsers()
  const { activeDepartments, getDepartment } = useDepartments()
  const navigate = useNavigate()
  const arrived = (useLocation().state as AdminUsersLocationState | null)?.deleted
  const [notice, setNotice] = useState(arrived ?? '')
  const [refused, setRefused] = useState<{ title: string; reasons: string[] }>()
  const noticeRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // The Filter is in the URL (`?division=a,b&dept=x,y&permission=author,reviewer`); the Department chips follow the
  // selected divisions, and choices no longer offered (an old link) are dropped.
  const [params, setParams] = useSearchParams()
  const filterData = useMemo(() => filterDepartmentsFrom(activeDepartments), [activeDepartments])
  const { divisionChoices, divisions, groups: departmentGroups, departments: departmentIds } = useMemo(
    () => filterSelection(filterData, readList(params, 'division'), readList(params, 'dept')), [filterData, params])
  // An old link's ?permission=admin is ignored.
  const permissions = useMemo(() => ROLE_FILTERS.filter((role) => readList(params, 'permission').includes(role)), [params])
  // `?sort=name-asc`, `?sort=division-desc` and so on (STAFF_SORTS); the default order leaves it out.
  const sort = readChoice<StaffSort>(params, 'sort', STAFF_SORTS, 'default')
  // `?status=deactivated`: the Deactive Staff tab; Active Staff (the default) leaves it out.
  const status = readChoice<StaffStatus>(params, 'status', STAFF_STATUSES, 'active')
  const deactivatedTab = status === 'deactivated'
  const tabStaff = useMemo(() => staffWithStatus(everyone, status), [everyone, status])
  const selectTab = (next: StaffStatus) => setParams((current) => updateParams(current, { status: next }, { status: 'active' }), { replace: true })
  const hasFilters = query.trim().length > 0 || divisions.length > 0 || departmentIds.length > 0 || permissions.length > 0 || sort !== 'default'
  const visible = useMemo(
    () => filterUsers(tabStaff, getDepartment, { query, divisions, departmentIds, permissions, sort }, usersEn.permissions),
    [tabStaff, getDepartment, query, divisions, departmentIds, permissions, sort],
  )
  const setSort = (next: StaffSort) => setParams((current) => updateParams(current, { sort: next }, { sort: 'default' }), { replace: true })
  // Replacing the URL: no history entry per click. Deselecting a division also deselects its departments (one update).
  const setFilter = (changes: { division?: string[]; dept?: string[]; permission?: string[] }) => setParams((current) => updateParams(current,
    Object.fromEntries(Object.entries(changes).map(([name, ids]) => [name, listParam(ids)])), { division: '', dept: '', permission: '' }), { replace: true })
  const setDivisions = (ids: string[]) => setFilter({ division: ids, dept: departmentsKept(filterData, ids, departmentIds) })
  function clearFilters() {
    setQuery('')
    setParams(clearedStaffParams, { replace: true })
    searchRef.current?.focus()
  }
  function deleted(message: string) {
    flushSync(() => {
      setRefused(undefined)
      setNotice(message)
    })
    // The row is gone: focus the notice instead.
    noticeRef.current?.focus()
  }
  function refuse(title: string, reasons: string[]) {
    flushSync(() => {
      setNotice('')
      setRefused({ title, reasons })
    })
    refusedRef.current?.focus()
  }

  const divisionText = (user: User) => divisionLabel(getDepartment(user.departmentId)) || content.none
  // Each action on its own, for its column in the table; the cards (below md) keep them together.
  const actionButtons = (user: User) => ({
    preview: <IconButton label={content.actions.view.replace('{name}', user.name)} icon={Eye} onClick={() => navigate(adminUserPath(user.id))} />,
    edit: <IconButton label={content.actions.edit.replace('{name}', user.name)} icon={Pencil} onClick={() => navigate(adminUserEditPath(user.id))} />,
    // The last column: Delete on Active Staff, Reactivate on Deactive Staff.
    action: user.deletedAt
      ? <ReactivateUserButton user={user} onReactivated={deleted} onRefused={refuse} />
      : <DeleteUserButton user={user} onDeleted={deleted} onRefused={refuse} />,
  })
  const actions = (user: User) => {
    const buttons = actionButtons(user)
    return <div className="flex justify-end gap-1">{buttons.preview}{buttons.edit}{buttons.action}</div>
  }
  const panelIds = tabIds(TAB_ID_PREFIX, status)

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
          <p className="mt-2 text-text-gray">{content.subtitle}</p>
        </div>
        <Button to={content.addUser.href} className="shrink-0 self-start sm:self-auto">
          <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
          {content.addUser.label}
        </Button>
      </div>

      <div role="status" ref={noticeRef} tabIndex={-1} className="rounded-lg focus:outline-none">
        {notice && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {notice}
          </p>
        )}
      </div>
      {refused && (
        <div ref={refusedRef} role="alert" tabIndex={-1} className="mt-6 rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-4 py-3 text-sm text-status-rejected-fg focus:outline-none">
          <p className="flex items-start gap-2 font-semibold">
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            {refused.title}
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-11">
            {refused.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      )}

      {/* Search | Filter | Sort, the same row as on every list page; from lg the Filter panel lines up with its right edge. */}
      <div className={`mt-8 ${LIST_TOOLBAR}`}>
        <TextField
          ref={searchRef}
          className="min-w-0"
          name="search"
          type="search"
          label={content.search.label}
          placeholder={content.search.placeholder}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {/* The Filter field of every list page. */}
        <FilterPopover className="relative min-w-0 lg:static" label={filtersEn.label} allLabel={filtersEn.all} title={filtersEn.title} clearLabel={filtersEn.clearAll}
          onClear={() => setFilter({ division: [], dept: [], permission: [] })}
          sections={[
            { id: 'division', legend: filtersEn.division.legend, options: divisionChoices, value: divisions, onChange: setDivisions,
              emptyText: filtersEn.division.empty, summary: filtersEn.division.count, scrollable: true },
            { id: 'department', legend: filtersEn.department.legend, value: departmentIds, onChange: (ids) => setFilter({ dept: ids }),
              emptyText: filtersEn.department.empty, summary: filtersEn.department.count, scrollable: true,
              groups: departmentGroups.map((group) => ({ id: group.id, label: group.unassigned ? filtersEn.department.unassigned : group.label, options: group.options })) },
            { id: 'permission', legend: filtersEn.permission.legend, options: permissionOptions, value: permissions,
              onChange: (next) => setFilter({ permission: next as RoleFilter[] }), emptyText: '', summary: filtersEn.permission.count },
          ]} />
        <SelectField className="min-w-0" name="staffSort" label={content.sort.label} value={sort}
          options={STAFF_SORTS.map((value) => {
            const group = staffSortGroup(value)
            return { value, label: content.sort.options[value], ...(group ? { group: content.sort.groups[group] } : {}) }
          })}
          onChange={(event) => setSort(event.target.value as StaffSort)} />
      </div>

      {/* Active Staff | Deactive Staff, right under Search | Filter | Sort, side by side on top of the table frame
          and lined up with its left edge; Clear Filters (when something is set) at the right of the same row. */}
      <div className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <Tabs
          className="order-last sm:order-first"
          variant="folder"
          items={STAFF_STATUSES.map((key) => ({ key, label: content.tabs[key] }))}
          selected={status}
          onSelect={selectTab}
          label={content.tabs.label}
          idPrefix={TAB_ID_PREFIX}
        />
        {hasFilters && <Button size="sm" variant="secondary" className="mb-2 ml-auto" onClick={clearFilters}>{content.clearFilters}</Button>}
      </div>
      <div role="tabpanel" id={panelIds.panel} aria-labelledby={panelIds.tab}>
      {visible.length === 0 ? (
        <div className="flex flex-col items-center rounded-xl rounded-tl-none border border-beige bg-white px-6 py-14 text-center">
          <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
            <Users className="size-6" strokeWidth={1.75} />
          </span>
          {/* Announced when switching tabs or searching leaves nothing to show */}
          <p role="status" className="mt-4 text-text-gray">{deactivatedTab ? content.emptyDeactivated : content.empty}</p>
        </div>
      ) : (
        <div className={`${tableStyles.frame} rounded-tl-none`}>
          {/* Table — md and up */}
          <div className={tableStyles.wide}>
            {/* The first heading's corner is square, under the tabs. */}
            <table aria-label={content.tableLabel} className={`${tableStyles.table} [&_thead_th:first-child]:rounded-tl-none`}>
              {/* The action columns are as wide as on Divisions and Departments (6rem each). */}
              <colgroup><col /><col /><col /><col /><col className={tableStyles.actionCol} /><col className={tableStyles.actionCol} /><col className={tableStyles.actionCol} /></colgroup>
              {/* The admin sidebar's maroon, off-white text (about 16:1). The colour is on the cells, so the
                  last keeps the table's rounded top corner. */}
              <thead className={tableStyles.head}>
                <tr>
                  <th scope="col" className={tableStyles.headCell}>{content.columns.name}</th>
                  <th scope="col" className={tableStyles.headCell}>{content.columns.division}</th>
                  <th scope="col" className={tableStyles.headCell}>{content.columns.department}</th>
                  <th scope="col" className={tableStyles.headCell}>{content.columns.permissions}</th>
                  {/* One column per action, each heading centred above its button, as on Divisions and Departments. */}
                  <th scope="col" className={tableStyles.actionHead}>{content.columns.preview}</th>
                  <th scope="col" className={tableStyles.actionHead}>{content.columns.edit}</th>
                  <th scope="col" className={tableStyles.actionHead}>{deactivatedTab ? content.columns.reactivate : content.columns.delete}</th>
                </tr>
              </thead>
              <tbody className={tableStyles.body}>
                {visible.map((user) => (
                  <tr key={user.id}>
                    <th scope="row" className={tableStyles.rowHeader}>
                      <span className="flex items-center gap-3">
                        <UserAvatar user={user} />
                        {user.name}
                      </span>
                    </th>
                    <td className={`${tableStyles.cell} text-text-gray`}>{divisionText(user)}</td>
                    <td className={`${tableStyles.cell} text-text-gray`}>{getDepartment(user.departmentId)?.name ?? content.none}</td>
                    <td className={tableStyles.cell}>
                      <PermissionBadges user={user} />
                    </td>
                    {(['preview', 'edit', 'action'] as const).map((action) => (
                      <td key={action} className={tableStyles.actionCell}>{actionButtons(user)[action]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked cards — below md */}
          <ul aria-label={content.tableLabel} className={tableStyles.cards}>
            {visible.map((user) => (
              <li key={user.id} className="flex gap-3 p-4">
                <UserAvatar user={user} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium break-words text-maroon">{user.name}</p>
                  <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
                    <dt className="text-text-gray">{content.columns.division}</dt>
                    <dd className="text-maroon">{divisionText(user)}</dd>
                    <dt className="text-text-gray">{content.columns.department}</dt>
                    <dd className="text-maroon">{getDepartment(user.departmentId)?.name ?? content.none}</dd>
                  </dl>
                  <PermissionBadges user={user} className="mt-2" />
                  <div className="mt-3 flex justify-end">{actions(user)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </>
  )
}
