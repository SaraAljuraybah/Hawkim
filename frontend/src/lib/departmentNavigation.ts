import type { AppNavItem } from '../content/types'
import type { DepartmentId, User } from '../data/mock/types'
import { hasAnyPermission } from './permissions'
import { DEPARTMENTS_PATH, SOP_DIRECTORY_PATH, SUBMIT_REQUEST_PATH } from './routes'

/*
 * Which screens the employee app offers for the active department. In the home
 * department everything the user's roles allow; in a department they only have
 * read-only access to, just browsing its SOP Directory (plus Organization Structure,
 * and the request form its "Request access" buttons open). Used by both the sidebar
 * and the route guard, so the rule lives in one place. Pure functions.
 */

/** Paths (and the pages below them) open in a read-only department. */
const READ_ONLY_PATHS = [SOP_DIRECTORY_PATH, DEPARTMENTS_PATH, SUBMIT_REQUEST_PATH]

/** Where hidden pages lead in a read-only department. */
export const READ_ONLY_LANDING_PATH = SOP_DIRECTORY_PATH

/** Whether the active department is one the user only has read-only access to. */
export function isReadOnlyDepartment(activeDepartmentId: DepartmentId, user: Pick<User, 'departmentId'>): boolean {
  return activeDepartmentId !== user.departmentId
}

/** Whether a page can be opened: any page at home, only the directory pages in a read-only department. */
export function isPathAllowed(pathname: string, readOnly: boolean): boolean {
  if (!readOnly) return true
  return READ_ONLY_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
}

/** The sidebar items to show: those the user's permissions allow and the active department permits. */
export function visibleNavItems(items: AppNavItem[], user: Pick<User, 'permissions'>, readOnly: boolean): AppNavItem[] {
  return items.filter(
    (item) => (!item.permission || hasAnyPermission(user, item.permission)) && isPathAllowed(item.href, readOnly),
  )
}
