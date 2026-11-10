import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleAlert, CircleCheck, Eye, Pencil, Plus, Users } from 'lucide-react'
import { DeleteUserButton } from '../../components/admin/DeleteUserButton'
import { PermissionBadges, UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { MultiSelectField } from '../../components/ui/MultiSelectField'
import { TextField } from '../../components/ui/TextField'
import { tableStyles } from '../../components/ui/tableStyles'
import { adminEn } from '../../content/admin.en'
import { organizationAdminEn as filterText } from '../../content/organizationAdmin.en'
import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { listParam, readList, updateParams } from '../../lib/pagination'
import { adminUserEditPath, adminUserPath } from '../../lib/routes'
import { departmentFilterOptions, divisionFilterOptions, divisionLabel, filterUsers, isSystemAdmin } from '../../lib/userAdmin'
import { useDepartments } from '../../state/departmentsContext'
import { useUsers } from '../../state/usersContext'

/** Set after deleting a user, to say so on the list. */
export interface AdminUsersLocationState {
  deleted?: string
}

/**
 * Staff ("/admin/users", PBI 17): one search, Filter by Division and Filter by Department (several of each,
 * independent, kept in the URL), Clear Filters, and each staff member's actions. Administrators aren't
 * staff: they are on Manage Organization → Admins.
 */
export function AdminUsersPage() {
  const content = adminEn.usersList
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  const { activeUsers: everyone } = useUsers()
  const activeUsers = useMemo(() => everyone.filter((user) => !isSystemAdmin(user)), [everyone])
  const { activeDepartments, getDepartment } = useDepartments()
  const navigate = useNavigate()
  const arrived = (useLocation().state as AdminUsersLocationState | null)?.deleted
  const [notice, setNotice] = useState(arrived ?? '')
  const [refused, setRefused] = useState<{ title: string; reasons: string[] }>()
  const noticeRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // The filters are in the URL (`?division=a,b&dept=x,y`); choices that no longer exist are dropped.
  const [params, setParams] = useSearchParams()
  const divisionChoices = useMemo(() => divisionFilterOptions(activeDepartments, filterText.filterNoDivision), [activeDepartments])
  const departmentChoices = useMemo(() => departmentFilterOptions(activeDepartments), [activeDepartments])
  const divisions = useMemo(() => readList(params, 'division').filter((id) => divisionChoices.some((option) => option.value === id)), [params, divisionChoices])
  const departmentIds = useMemo(() => readList(params, 'dept').filter((id) => departmentChoices.some((option) => option.value === id)), [params, departmentChoices])
  const hasFilters = query.trim().length > 0 || divisions.length > 0 || departmentIds.length > 0
  const visible = useMemo(
    () => filterUsers(activeUsers, getDepartment, { query, divisions, departmentIds }, usersEn.permissions),
    [activeUsers, getDepartment, query, divisions, departmentIds],
  )
  // Independent: changing one never changes the other. Replacing the URL: no history entry per click.
  const setFilter = (name: 'division' | 'dept', ids: string[]) =>
    setParams((current) => updateParams(current, { [name]: listParam(ids) }, { division: '', dept: '' }), { replace: true })
  function clearFilters() {
    setQuery('')
    setParams((current) => updateParams(current, { division: undefined, dept: undefined }, { division: '', dept: '' }), { replace: true })
    searchRef.current?.focus()
  }
  const count = (visible.length === 1 ? content.count.one : content.count.other).replace('{count}', String(visible.length))

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
  const actions = (user: User) => (
    <div className="flex justify-end gap-1">
      <IconButton label={content.actions.view.replace('{name}', user.name)} icon={Eye} onClick={() => navigate(adminUserPath(user.id))} />
      <IconButton label={content.actions.edit.replace('{name}', user.name)} icon={Pencil} onClick={() => navigate(adminUserEditPath(user.id))} />
      <DeleteUserButton user={user} onDeleted={deleted} onRefused={refuse} />
    </div>
  )

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
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

      {/* One search, then Filter by Division and Filter by Department (each lists all its choices): stacked on phones;
          from sm the search across the top and the two filters side by side; one row from xl. */}
      <div className="mt-8 grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <TextField
          ref={searchRef}
          className="sm:col-span-2 xl:col-span-1"
          name="search"
          type="search"
          label={content.search.label}
          placeholder={content.search.placeholder}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {/* As on Divisions & Departments: a visible label; the control's accessible name is the same text. */}
        <div className="min-w-0">
          <span aria-hidden="true" className="mb-1.5 block text-sm font-medium text-maroon">{filterText.filterDivisions}</span>
          <MultiSelectField name="division" label={filterText.filterDivisions} placeholder={filterText.filterPlaceholder} emptyText={filterText.filterEmpty}
            options={divisionChoices} value={divisions} onChange={(ids) => setFilter('division', ids)} />
        </div>
        <div className="min-w-0">
          <span aria-hidden="true" className="mb-1.5 block text-sm font-medium text-maroon">{filterText.filterDepartments}</span>
          <MultiSelectField name="department" label={filterText.filterDepartments} placeholder={filterText.filterDepartmentsPlaceholder}
            emptyText={filterText.filterDepartmentsEmpty} options={departmentChoices} value={departmentIds} onChange={(ids) => setFilter('dept', ids)} />
        </div>
      </div>

      <div className="mt-6 flex min-h-8 flex-wrap items-center justify-between gap-2">
        {/* Announced as the results change */}
        <p role="status" className="text-sm font-medium text-text-gray">
          {count}
        </p>
        {hasFilters && <Button size="sm" variant="secondary" onClick={clearFilters}>{content.clearFilters}</Button>}
      </div>

      {visible.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
          <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
            <Users className="size-6" strokeWidth={1.75} />
          </span>
          <p className="mt-4 text-text-gray">{content.empty}</p>
        </div>
      ) : (
        <div className={`mt-3 ${tableStyles.frame}`}>
          {/* Table — md and up */}
          <div className={tableStyles.wide}>
            <table aria-label={content.tableLabel} className={tableStyles.table}>
              {/* The admin sidebar's maroon, off-white text (about 16:1). The colour is on the cells, so the
                  first and last keep the table's rounded top corners. */}
              <thead className={tableStyles.head}>
                <tr>
                  <th scope="col" className={tableStyles.headCell}>{content.columns.name}</th>
                  <th scope="col" className={tableStyles.headCell}>{content.columns.division}</th>
                  <th scope="col" className={tableStyles.headCell}>{content.columns.department}</th>
                  <th scope="col" className={tableStyles.headCell}>{content.columns.permissions}</th>
                  <th scope="col" className={`${tableStyles.headCell} text-right`}>
                    <span className="sr-only">{content.columns.actions}</span>
                  </th>
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
                    <td className={tableStyles.cell}>{actions(user)}</td>
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
    </>
  )
}
