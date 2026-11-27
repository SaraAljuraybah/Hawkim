import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, Eye, LoaderCircle, Pencil, Plus, UserCog } from 'lucide-react'
import { AdminRoleBadge } from '../../components/admin/AdminRoleBadge'
import { DeleteAdminButton } from '../../components/admin/DeleteAdminButton'
import { EmailDetail } from '../../components/admin/DetailsCard'
import { ReactivateAdminButton } from '../../components/admin/ReactivateAdminButton'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { FilterPopover } from '../../components/ui/FilterPopover'
import { IconButton } from '../../components/ui/IconButton'
import { SelectField } from '../../components/ui/SelectField'
import { Tabs } from '../../components/ui/Tabs'
import { tabIds } from '../../components/ui/tabIds'
import { TextField } from '../../components/ui/TextField'
import { Tooltip } from '../../components/ui/Tooltip'
import { LIST_TOOLBAR } from '../../components/ui/toolbar'
import { tableStyles } from '../../components/ui/tableStyles'
import { adminsEn } from '../../content/admins.en'
import { filtersEn } from '../../content/filters.en'
import type { AdminRoleKey } from '../../content/types'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useSuperAdmin } from '../../hooks/useSuperAdmin'
import {
  ADMIN_ROLES, ADMIN_SORTS, ADMIN_STATUSES, adminRole, adminSortGroup, administratorsWithStatus, canDeleteAdmin, canEditAdmin, canReactivateAdmin, listAdmins,
  type AdminSort, type AdminStatus,
} from '../../lib/adminAccess'
import { listParam, readChoice, readList, updateParams } from '../../lib/pagination'
import { adminAdminEditPath, adminAdminPath } from '../../lib/routes'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'

/** Ids of the Active Admins / Deactivated Admins tabs and their panel. */
const TAB_ID_PREFIX = 'admin-status'

/** Set after deleting an administrator or transferring the role, to say so on the list. */
export interface AdminAdminsLocationState {
  notice?: string
}

/**
 * An administrator's permission badge in the list. The Super Admin's explains the role in a tooltip, on hover,
 * keyboard focus (the badge is focusable and described by it) or a tap; Escape closes it.
 */
function RoleBadge({ role }: { role: AdminRoleKey }) {
  if (role !== 'superAdmin') return <AdminRoleBadge role={role} />
  return (
    <Tooltip wide openOnTap text={adminsEn.superAdminTooltip}>
      {(tooltipId) => <AdminRoleBadge role={role} describedBy={tooltipId} />}
    </Tooltip>
  )
}

/**
 * Manage Organization → Admins ("/admin/admins"): the administrators with their role, a Filter (Role) and Sort
 * (in the URL, as on Staff), a search by
 * name or email, and the actions the signed-in administrator may take on each (Delete only for the
 * Super Admin, never on the Super Admin; Edit on the Super Admin only for the Super Admin).
 * As on the Staff page, the Active Admins and Deactivated Admins tabs (`?status=deactivated`, Active Admins by
 * default) sit right above the table, and Search, Filter and Sort apply to the selected tab. Deactivated Admins
 * rows have Preview, and Reactivate (Super Admin only) where Active Admins has Delete.
 */
export function AdminAdminsPage() {
  const content = adminsEn.list
  useDocumentTitle(adminsEn.pageTitle.replace('{page}', content.title))
  const viewer = useCurrentUser()
  // Every profile (deleted ones included); each tab shows its own administrators.
  const { status, users } = useUsers()
  const superAdmin = useSuperAdmin()
  const navigate = useNavigate()
  const arrived = (useLocation().state as AdminAdminsLocationState | null)?.notice
  const [notice, setNotice] = useState(arrived ?? '')
  const [refused, setRefused] = useState<{ title: string; reasons: string[] }>()
  const noticeRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  // The Filter (Role) and Sort are in the URL, as on the Staff page: `?role=superAdmin,admin&sort=name-asc`.
  const [params, setParams] = useSearchParams()
  const roles = useMemo(() => ADMIN_ROLES.filter((role) => readList(params, 'role').includes(role)), [params])
  const sort = readChoice<AdminSort>(params, 'sort', ADMIN_SORTS, 'default')
  // `?status=deactivated`: the Deactivated Admins tab; Active Admins (the default) leaves it out.
  const adminStatus = readChoice<AdminStatus>(params, 'status', ADMIN_STATUSES, 'active')
  const deactivatedTab = adminStatus === 'deactivated'
  const selectTab = (next: AdminStatus) => setParams((current) => updateParams(current, { status: next }, { status: 'active' }), { replace: true })
  const hasFilters = query.trim().length > 0 || roles.length > 0 || sort !== 'default'
  const setRoles = (next: string[]) => setParams((current) => updateParams(current, { role: listParam(next) }, { role: '' }), { replace: true })
  const setSort = (next: AdminSort) => setParams((current) => updateParams(current, { sort: next }, { sort: 'default' }), { replace: true })
  function clearFilters() {
    setQuery('')
    setParams((current) => updateParams(current, { role: undefined, sort: undefined }, {}), { replace: true })
    searchRef.current?.focus()
  }

  const admins = useMemo(() => administratorsWithStatus(users, adminStatus), [users, adminStatus])
  const superAdminId = superAdmin.superAdminId
  const visible = useMemo(() => listAdmins(admins, superAdminId, query, { roles, sort }), [admins, superAdminId, query, roles, sort])
  const loading = status === 'loading' || superAdmin.status === 'loading'
  // Only the Super Admin can delete or reactivate Admins, so only they get that last column (no empty column for
  // anyone else). (Worked out only when there are rows to show.)
  const showLast = visible.length > 0 && superAdmin.status === 'ready' && canReactivateAdmin(viewer.id, superAdminId)
  // A deleted Admin can't be edited: Deactivated Admins has Preview, then Reactivate.
  const actionKeys = deactivatedTab
    ? (showLast ? (['preview', 'reactivate'] as const) : (['preview'] as const))
    : (showLast ? (['preview', 'edit', 'delete'] as const) : (['preview', 'edit'] as const))
  const panelIds = tabIds(TAB_ID_PREFIX, adminStatus)
  const failed = status === 'error' || superAdmin.status === 'error'

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

  // Each action on its own, so the table can put them in their columns (an action the viewer can't take: nothing).
  const actionButtons = (admin: User) => ({
    preview: <IconButton label={content.actions.view.replace('{name}', admin.name)} icon={Eye} onClick={() => navigate(adminAdminPath(admin.id))} />,
    edit: canEditAdmin(viewer.id, admin.id, superAdminId) ? (
      <IconButton label={content.actions.edit.replace('{name}', admin.name)} icon={Pencil} onClick={() => navigate(adminAdminEditPath(admin.id))} />
    ) : null,
    delete: canDeleteAdmin(viewer.id, admin.id, superAdminId) ? <DeleteAdminButton admin={admin} onDeleted={deleted} onFailed={refuse} /> : null,
    reactivate: canReactivateAdmin(viewer.id, superAdminId) ? <ReactivateAdminButton admin={admin} onReactivated={deleted} onRefused={refuse} /> : null,
  })
  // The cards (below md) keep the actions together at the end.
  const actions = (admin: User) => {
    const buttons = actionButtons(admin)
    return <div className="flex justify-end gap-1">{actionKeys.map((action) => <span key={action} className="contents">{buttons[action]}</span>)}</div>
  }

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
          <p className="mt-2 max-w-2xl text-text-gray">{content.description}</p>
        </div>
        <Button to={content.add.href} className="shrink-0 self-start sm:self-auto">
          <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
          {content.add.label}
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
      {refused && <RefusedBox ref={refusedRef} title={refused.title} messages={refused.reasons} />}

      {/* Search | Filter | Sort, the same row as on every list page. */}
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
        {/* The Filter field of every list page, with one section: Role. */}
        <FilterPopover className="relative min-w-0 lg:static" label={filtersEn.label} allLabel={filtersEn.all} title={filtersEn.title} clearLabel={filtersEn.clearAll}
          onClear={() => setRoles([])}
          sections={[
            { id: 'role', legend: content.role.legend, options: ADMIN_ROLES.map((role) => ({ value: role, label: adminsEn.roles[role] })),
              value: roles, onChange: setRoles, emptyText: '', summary: content.role.count },
          ]} />
        <SelectField className="min-w-0" name="adminSort" label={content.sort.label} value={sort}
          options={ADMIN_SORTS.map((value) => ({ value, label: content.sort.options[value], group: content.sort.groups[adminSortGroup(value)] }))}
          onChange={(event) => setSort(event.target.value as AdminSort)} />
      </div>

      {loading ? (
        <p role="status" className="mt-6 flex items-center gap-2 text-sm font-medium text-text-gray">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" strokeWidth={1.75} />
          {content.loading}
        </p>
      ) : failed ? (
        <div role="alert" className="mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-status-rejected-fg/25 bg-status-rejected-bg px-4 py-3 text-sm text-status-rejected-fg">
          <span className="font-medium">{content.loadFailed}</span>
          {/* The people come with the rest of the portal; a reload reads them again. */}
          <Button variant="secondary" size="sm" onClick={() => (status === 'error' ? window.location.reload() : superAdmin.reload())}>
            {content.retry}
          </Button>
        </div>
      ) : (
        <>
          {/* Active Admins | Deactivated Admins, as on the Staff page (they replace the count): on top of the table frame
              and lined up with its left edge; Clear Filters (when something is set) at the right of the same row. */}
          <div className="mt-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <Tabs
              className="order-last sm:order-first"
              variant="folder"
              items={ADMIN_STATUSES.map((key) => ({ key, label: content.tabs[key] }))}
              selected={adminStatus}
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
                <UserCog className="size-6" strokeWidth={1.75} />
              </span>
              {/* Announced when switching tabs or searching leaves nothing to show */}
              <p role="status" className="mt-4 text-text-gray">
                {admins.length > 0 ? content.noMatches : deactivatedTab ? content.emptyDeactivated : content.empty}
              </p>
            </div>
          ) : (
            <div className={`${tableStyles.frame} rounded-tl-none`}>
              {/* Table — md and up */}
              <div className={tableStyles.wide}>
                {/* The first heading's corner is square, under the tabs. */}
                <table aria-label={content.tableLabel} className={`${tableStyles.table} [&_thead_th:first-child]:rounded-tl-none`}>
                  {/* The action columns are as wide as on Divisions and Departments (6rem each). */}
                  <colgroup><col /><col /><col /><col />{actionKeys.map((action) => <col key={action} className={tableStyles.actionCol} />)}</colgroup>
                  <thead className={tableStyles.head}>
                    <tr>
                      <th scope="col" className={tableStyles.headCell}>{content.columns.name}</th>
                      <th scope="col" className={tableStyles.headCell}>{content.columns.email}</th>
                      <th scope="col" className={tableStyles.headCell}>{content.columns.phone}</th>
                      <th scope="col" className={tableStyles.headCell}>{content.columns.role}</th>
                      {/* One column per action, each heading centred above its button, as on Divisions and Departments. */}
                      {actionKeys.map((action) => <th key={action} scope="col" className={tableStyles.actionHead}>{content.columns[action]}</th>)}
                    </tr>
                  </thead>
                  <tbody className={tableStyles.body}>
                    {visible.map((admin) => (
                      <tr key={admin.id}>
                        <th scope="row" className={tableStyles.rowHeader}>
                          <span className="flex items-center gap-3">
                            <UserAvatar user={admin} />
                            {admin.name}
                          </span>
                        </th>
                        <td className={`${tableStyles.cell} text-text-gray`}>
                          <EmailDetail email={admin.email} copyLabel={adminsEn.details.copyEmail.replace('{name}', admin.name)} copiedText={adminsEn.details.copied} failedText={adminsEn.details.copyFailed} />
                        </td>
                        <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{admin.phone ?? content.none}</td>
                        <td className={tableStyles.cell}>
                          <RoleBadge role={adminRole(admin.id, superAdminId)} />
                        </td>
                        {/* An action the viewer can't take (e.g. Delete on the Super Admin) leaves its cell empty, so the columns stay aligned. */}
                        {actionKeys.map((action) => (
                          <td key={action} className={tableStyles.actionCell}>{actionButtons(admin)[action]}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Stacked cards — below md */}
              <ul aria-label={content.tableLabel} className={tableStyles.cards}>
                {visible.map((admin) => (
                  <li key={admin.id} className="flex gap-3 p-4">
                    <UserAvatar user={admin} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium break-words text-maroon">{admin.name}</p>
                      <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-sm">
                        <dt className="text-text-gray">{content.columns.email}</dt>
                        <dd className="min-w-0 text-maroon">
                          <EmailDetail email={admin.email} copyLabel={adminsEn.details.copyEmail.replace('{name}', admin.name)} copiedText={adminsEn.details.copied} failedText={adminsEn.details.copyFailed} />
                        </dd>
                        <dt className="text-text-gray">{content.columns.phone}</dt>
                        <dd className="text-maroon">{admin.phone ?? content.none}</dd>
                      </dl>
                      <div className="mt-2"><RoleBadge role={adminRole(admin.id, superAdminId)} /></div>
                      <div className="mt-3 flex justify-end">{actions(admin)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          </div>
        </>
      )}
    </>
  )
}
