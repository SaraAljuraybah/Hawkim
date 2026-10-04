import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Building2, CircleCheck, Plus } from 'lucide-react'
import { DepartmentBadge } from '../../components/admin/DepartmentBadge'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { formatCount } from '../../lib/count'
import { members, sopsIn, withAccess } from '../../lib/departmentAdmin'
import { adminDepartmentPath } from '../../lib/routes'
import { useDepartments } from '../../state/departmentsContext'
import { useRequests } from '../../state/requestsContext'
import { useSops } from '../../state/sopsContext'
import { useUsers } from '../../state/usersContext'

/** Set after removing a department, to say so on the list. */
export interface AdminDepartmentsLocationState {
  removed?: string
}

/* One link per row, stretched over the whole row with ::after (as in the other lists). */
const stretchedLink = 'after:absolute after:inset-0 focus-visible:outline-none'
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/**
 * Departments ("/admin/departments", PBI 13): every department (removed ones are not
 * listed) with its real member, access and SOP counts. Search by name.
 */
export function AdminDepartmentsPage() {
  const content = adminEn.departmentsList
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  const notice = (useLocation().state as AdminDepartmentsLocationState | null)?.removed
  const { activeDepartments } = useDepartments()
  const { users } = useUsers()
  const { requests } = useRequests()
  const { sops } = useSops()

  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const text = query.trim().toLowerCase()
    return activeDepartments
      .filter((department) => !text || department.name.toLowerCase().includes(text))
      .map((department) => ({
        department,
        members: members(department.id, users).length,
        withAccess: withAccess(department.id, users, requests).length,
        sops: sopsIn(department.id, sops).length,
      }))
  }, [activeDepartments, query, users, requests, sops])

  return (
    <>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl tracking-tight sm:text-3xl">{content.title}</h1>
          <p className="mt-2 text-text-gray">{content.subtitle}</p>
        </div>
        <Button to={content.addDepartment.href} className="shrink-0 self-start sm:self-auto">
          <Plus aria-hidden="true" className="size-4" strokeWidth={2} />
          {content.addDepartment.label}
        </Button>
      </div>

      <div role="status">
        {notice && (
          <p className="mt-6 flex items-center gap-2 rounded-lg border border-status-approved-fg/25 bg-status-approved-bg px-4 py-3 text-sm font-medium text-status-approved-fg">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
            {notice}
          </p>
        )}
      </div>

      <TextField
        name="search"
        type="search"
        label={content.search.label}
        placeholder={content.search.placeholder}
        autoComplete="off"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="mt-8 max-w-md"
      />

      {/* Announced as the results change */}
      <p role="status" className="mt-6 text-sm font-medium text-text-gray">
        {formatCount(rows.length, content.count)}
      </p>

      {rows.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
          <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
            <Building2 className="size-6" strokeWidth={1.75} />
          </span>
          <p className="mt-4 text-text-gray">{content.empty}</p>
        </div>
      ) : (
        <div className="mt-3 overflow-hidden rounded-xl border border-beige bg-white">
          {/* Table — md and up (scrolls inside its own box if it is ever too wide) */}
          <div className="hidden overflow-x-auto md:block">
            <table aria-label={content.tableLabel} className="w-full text-left text-sm">
              <thead className="bg-beige/60 text-maroon">
                <tr>
                  <th scope="col" className="px-5 py-3 font-semibold">{content.columns.name}</th>
                  <th scope="col" className="px-5 py-3 font-semibold">{content.columns.description}</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold whitespace-nowrap">{content.columns.members}</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold whitespace-nowrap">{content.columns.withAccess}</th>
                  <th scope="col" className="px-5 py-3 text-right font-semibold whitespace-nowrap">{content.columns.sops}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-beige">
                {rows.map((row) => (
                  <tr key={row.department.id} className={`relative transition-colors hover:bg-beige/40 ${focusRing}`}>
                    <th scope="row" className="px-5 py-3.5 font-medium text-maroon">
                      <span className="flex items-center gap-3">
                        <DepartmentBadge department={row.department} />
                        <Link to={adminDepartmentPath(row.department.id)} className={stretchedLink}>
                          {row.department.name}
                        </Link>
                      </span>
                    </th>
                    <td className="px-5 py-3.5 text-text-gray">{row.department.description}</td>
                    <td className="px-5 py-3.5 text-right text-maroon tabular-nums">{row.members}</td>
                    <td className="px-5 py-3.5 text-right text-maroon tabular-nums">{row.withAccess}</td>
                    <td className="px-5 py-3.5 text-right text-maroon tabular-nums">{row.sops}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked cards — below md */}
          <ul aria-label={content.tableLabel} className="divide-y divide-beige md:hidden">
            {rows.map((row) => (
              <li key={row.department.id} className={`relative flex gap-3 p-4 ${focusRing}`}>
                <DepartmentBadge department={row.department} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-maroon">
                    <Link to={adminDepartmentPath(row.department.id)} className={stretchedLink}>
                      {row.department.name}
                    </Link>
                  </p>
                  {row.department.description && (
                    <p className="mt-0.5 text-sm text-text-gray">{row.department.description}</p>
                  )}
                  <p className="mt-1.5 text-sm text-maroon">
                    {formatCount(row.members, content.cardCounts.members)}
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {formatCount(row.withAccess, content.cardCounts.withAccess)}
                    <span aria-hidden="true"> · </span>
                    <span className="sr-only">, </span>
                    {formatCount(row.sops, content.cardCounts.sops)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
