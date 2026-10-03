import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Users } from 'lucide-react'
import { PermissionBadges, UserAvatar } from '../../components/admin/UserBits'
import { Button } from '../../components/ui/Button'
import { SelectField } from '../../components/ui/SelectField'
import { TextField } from '../../components/ui/TextField'
import { adminEn } from '../../content/admin.en'
import { usersEn } from '../../content/users.en'
import { departments, getDepartmentName } from '../../data/mock/departments'
import type { Permission, User } from '../../data/mock/types'
import { useDocumentTitle } from '../../hooks/useDocumentTitle'
import { adminUserPath } from '../../lib/routes'
import { PERMISSIONS } from '../../lib/userAdmin'
import { useUsers } from '../../state/usersContext'

/** "All" in the filters. */
const ALL = 'all'

/* One link per row, stretched over the whole row with ::after (as in the SOPs list). */
const stretchedLink = 'after:absolute after:inset-0 focus-visible:outline-none'
const focusRing =
  'has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-maroon-secondary has-[a:focus-visible]:outline-solid'

/** Users matching the search (name or email, ignoring case) and both filters, by name. */
function filterUsers(users: User[], query: string, departmentId: string, permission: string): User[] {
  const text = query.trim().toLowerCase()
  return users
    .filter(
      (user) =>
        (!text || user.name.toLowerCase().includes(text) || user.email.toLowerCase().includes(text)) &&
        (departmentId === ALL || user.departmentId === departmentId) &&
        (permission === ALL || user.permissions.includes(permission as Permission)),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Users ("/admin/users", PBI 17): search, filters and every user (deleted users are not listed). */
export function AdminUsersPage() {
  const content = adminEn.usersList
  useDocumentTitle(adminEn.pageTitle.replace('{page}', content.title))
  const { activeUsers } = useUsers()

  const [query, setQuery] = useState('')
  const [departmentId, setDepartmentId] = useState(ALL)
  const [permission, setPermission] = useState(ALL)
  const visible = useMemo(
    () => filterUsers(activeUsers, query, departmentId, permission),
    [activeUsers, query, departmentId, permission],
  )
  const count = (visible.length === 1 ? content.count.one : content.count.other).replace('{count}', String(visible.length))

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

      {/* Search and filters */}
      <div className="mt-8 grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <TextField
          name="search"
          type="search"
          label={content.search.label}
          placeholder={content.search.placeholder}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SelectField
          name="department"
          label={content.departmentFilter.label}
          options={[
            { value: ALL, label: content.departmentFilter.all },
            ...departments.map((department) => ({ value: department.id, label: department.name })),
          ]}
          value={departmentId}
          onChange={(event) => setDepartmentId(event.target.value)}
        />
        <SelectField
          name="permission"
          label={content.permissionFilter.label}
          options={[
            { value: ALL, label: content.permissionFilter.all },
            ...PERMISSIONS.map((key) => ({ value: key, label: usersEn.permissions[key] })),
          ]}
          value={permission}
          onChange={(event) => setPermission(event.target.value)}
        />
      </div>

      {/* Announced as the results change */}
      <p role="status" className="mt-6 text-sm font-medium text-text-gray">
        {count}
      </p>

      {visible.length === 0 ? (
        <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-beige bg-white px-6 py-14 text-center">
          <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-lg bg-beige text-maroon">
            <Users className="size-6" strokeWidth={1.75} />
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
                  <th scope="col" className="px-5 py-3 font-semibold">{content.columns.email}</th>
                  <th scope="col" className="px-5 py-3 font-semibold">{content.columns.department}</th>
                  <th scope="col" className="px-5 py-3 font-semibold">{content.columns.permissions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-beige">
                {visible.map((user) => (
                  <tr key={user.id} className={`relative transition-colors hover:bg-beige/40 ${focusRing}`}>
                    <th scope="row" className="px-5 py-3.5 font-medium text-maroon">
                      <span className="flex items-center gap-3">
                        <UserAvatar user={user} />
                        <Link to={adminUserPath(user.id)} className={stretchedLink}>
                          {user.name}
                        </Link>
                      </span>
                    </th>
                    <td className="px-5 py-3.5 break-all text-text-gray">{user.email}</td>
                    <td className="px-5 py-3.5 text-text-gray">{getDepartmentName(user.departmentId)}</td>
                    <td className="px-5 py-3.5">
                      <PermissionBadges user={user} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Stacked cards — below md */}
          <ul aria-label={content.tableLabel} className="divide-y divide-beige md:hidden">
            {visible.map((user) => (
              <li key={user.id} className={`relative flex gap-3 p-4 ${focusRing}`}>
                <UserAvatar user={user} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-maroon">
                    <Link to={adminUserPath(user.id)} className={stretchedLink}>
                      {user.name}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-sm break-all text-text-gray">{user.email}</p>
                  <p className="mt-0.5 text-sm text-text-gray">{getDepartmentName(user.departmentId)}</p>
                  <PermissionBadges user={user} className="mt-2" />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
