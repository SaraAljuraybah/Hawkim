import { useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { CircleCheck, Eye, LoaderCircle, Pencil, Plus, UserCog } from 'lucide-react'
import { AdminRoleBadge } from '../../components/admin/AdminRoleBadge'
import { DeleteAdminButton } from '../../components/admin/DeleteAdminButton'
import { RefusedBox } from '../../components/admin/RefusedBox'
import { UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { TextField } from '../../components/ui/TextField'
import { LIST_TOOLBAR } from '../../components/ui/toolbar'
import { tableStyles } from '../../components/ui/tableStyles'
import { adminsEn } from '../../content/admins.en'
import type { User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { useSuperAdmin } from '../../hooks/useSuperAdmin'
import { adminRole, administrators, canDeleteAdmin, canEditAdmin, listAdmins } from '../../lib/adminAccess'
import { adminAdminEditPath, adminAdminPath } from '../../lib/routes'
import { useCurrentUser } from '../../state/sessionContext'
import { useUsers } from '../../state/usersContext'

/** Set after deleting an administrator or transferring the role, to say so on the list. */
export interface AdminAdminsLocationState {
  notice?: string
}

/**
 * Manage Organization → Admins ("/admin/admins"): the administrators with their role, a search by
 * name or email, and the actions the signed-in administrator may take on each (Delete only for the
 * Super Admin, never on the Super Admin; Edit on the Super Admin only for the Super Admin).
 */
export function AdminAdminsPage() {
  const content = adminsEn.list
  useDocumentTitle(adminsEn.pageTitle.replace('{page}', content.title))
  const viewer = useCurrentUser()
  const { status, activeUsers } = useUsers()
  const superAdmin = useSuperAdmin()
  const navigate = useNavigate()
  const arrived = (useLocation().state as AdminAdminsLocationState | null)?.notice
  const [notice, setNotice] = useState(arrived ?? '')
  const [refused, setRefused] = useState<{ title: string; reasons: string[] }>()
  const noticeRef = useRef<HTMLDivElement>(null)
  const refusedRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')

  const admins = useMemo(() => administrators(activeUsers), [activeUsers])
  const superAdminId = superAdmin.superAdminId
  const visible = useMemo(() => listAdmins(admins, superAdminId, query), [admins, superAdminId, query])
  const count = (visible.length === 1 ? content.count.one : content.count.other).replace('{count}', String(visible.length))
  const loading = status === 'loading' || superAdmin.status === 'loading'
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
  })
  // The cards (below md) keep the actions together at the end.
  const actions = (admin: User) => {
    const buttons = actionButtons(admin)
    return <div className="flex justify-end gap-1">{buttons.preview}{buttons.edit}{buttons.delete}</div>
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

      {/* The search in the same row as every list page's, so it's just as wide (no Filter or Sort here). */}
      <div className={`mt-8 ${LIST_TOOLBAR}`}>
        <TextField
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
          {/* Announced as the results change */}
          <p role="status" className="mt-6 text-sm font-medium text-text-gray">
            {count}
          </p>

          {visible.length === 0 ? (
            <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
              <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
                <UserCog className="size-6" strokeWidth={1.75} />
              </span>
              <p className="mt-4 text-text-gray">{admins.length === 0 ? content.empty : content.noMatches}</p>
            </div>
          ) : (
            <div className={`mt-3 ${tableStyles.frame}`}>
              {/* Table — md and up */}
              <div className={tableStyles.wide}>
                <table aria-label={content.tableLabel} className={tableStyles.table}>
                  {/* The action columns are as wide as on Divisions and Departments (6rem each). */}
                  <colgroup><col /><col /><col /><col /><col className={tableStyles.actionCol} /><col className={tableStyles.actionCol} /><col className={tableStyles.actionCol} /></colgroup>
                  <thead className={tableStyles.head}>
                    <tr>
                      <th scope="col" className={tableStyles.headCell}>{content.columns.name}</th>
                      <th scope="col" className={tableStyles.headCell}>{content.columns.email}</th>
                      <th scope="col" className={tableStyles.headCell}>{content.columns.phone}</th>
                      <th scope="col" className={tableStyles.headCell}>{content.columns.role}</th>
                      {/* One column per action, each heading centred above its button, as on Divisions and Departments. */}
                      <th scope="col" className={tableStyles.actionHead}>{content.columns.preview}</th>
                      <th scope="col" className={tableStyles.actionHead}>{content.columns.edit}</th>
                      <th scope="col" className={tableStyles.actionHead}>{content.columns.delete}</th>
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
                        <td className={`${tableStyles.cell} break-all text-text-gray`}>{admin.email}</td>
                        <td className={`${tableStyles.cell} whitespace-nowrap text-text-gray`}>{admin.phone ?? content.none}</td>
                        <td className={tableStyles.cell}>
                          <AdminRoleBadge role={adminRole(admin.id, superAdminId)} />
                        </td>
                        {/* An action the viewer can't take (e.g. Delete on the Super Admin) leaves its cell empty, so the columns stay aligned. */}
                        {(['preview', 'edit', 'delete'] as const).map((action) => (
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
                        <dd className="break-all text-maroon">{admin.email}</dd>
                        <dt className="text-text-gray">{content.columns.phone}</dt>
                        <dd className="text-maroon">{admin.phone ?? content.none}</dd>
                      </dl>
                      <AdminRoleBadge role={adminRole(admin.id, superAdminId)} className="mt-2" />
                      <div className="mt-3 flex justify-end">{actions(admin)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </>
  )
}
