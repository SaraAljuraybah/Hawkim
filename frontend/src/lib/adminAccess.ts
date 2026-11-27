import type { AdminRoleKey } from '../content/types'
import type { User } from '../data/mock/types'
import { isSystemAdmin } from './userAdmin'

/*
 * Who may do what on Manage Organization → Admins. These only decide what the pages show; the
 * database refuses the same things on its own (supabase/migrations/20261111120000_super_admin.sql),
 * reading who the Super Admin is at that moment.
 *
 * | Action                        | Super Admin | Admin |
 * | View Admins                   | yes         | yes   |
 * | Add / Edit a regular Admin    | yes         | yes   |
 * | Edit the Super Admin          | themselves  | no    |
 * | Delete a regular Admin        | yes         | no    |
 * | Reactivate a deleted Admin    | yes         | no    |
 * | Make Super Admin (transfer)   | yes         | no    |
 * | Delete the Super Admin        | no          | no    |
 */

/** The administrators: active accounts with the Admin permission. */
export function administrators(activeUsers: User[]): User[] {
  return activeUsers.filter(isSystemAdmin)
}

/** The Admins page's Active Admins / Deactivated Admins tabs (`?status=deactivated`), as on the Staff page. */
export const ADMIN_STATUSES = ['active', 'deactivated'] as const
export type AdminStatus = (typeof ADMIN_STATUSES)[number]

/** The administrators of one tab: active ones, or deleted ones (Deactivated Admins). `users` includes deleted accounts. */
export function administratorsWithStatus(users: User[], status: AdminStatus): User[] {
  return users.filter((user) => isSystemAdmin(user) && (status === 'deactivated' ? !!user.deletedAt : !user.deletedAt))
}

/** Only the Super Admin (a deleted Admin is never the Super Admin). */
export function canReactivateAdmin(viewerId: string, superAdminId: string | null): boolean {
  return superAdminId !== null && viewerId === superAdminId
}

export function adminRole(userId: string, superAdminId: string | null): AdminRoleKey {
  return userId === superAdminId ? 'superAdmin' : 'admin'
}

/** Anyone may edit a regular Admin (themselves included); only the Super Admin edits the Super Admin. */
export function canEditAdmin(viewerId: string, targetId: string, superAdminId: string | null): boolean {
  return targetId !== superAdminId || viewerId === superAdminId
}

/** Only the Super Admin, and never the Super Admin's own account. */
export function canDeleteAdmin(viewerId: string, targetId: string, superAdminId: string | null): boolean {
  return superAdminId !== null && viewerId === superAdminId && targetId !== superAdminId
}

/** Only the Super Admin, to another (regular) Admin. */
export function canMakeSuperAdmin(viewerId: string, targetId: string, superAdminId: string | null): boolean {
  return canDeleteAdmin(viewerId, targetId, superAdminId)
}

/**
 * The Admins page's Filter (Role) choices and Sort orders. By date added as an admin (User.adminSince): 'default' is
 * the newest first, 'oldest' the oldest first; or by name, A to Z or Z to A. Admins without a known date are listed
 * last either way; ties go by name, then the id.
 */
export const ADMIN_ROLES: AdminRoleKey[] = ['superAdmin', 'admin']
export const ADMIN_SORTS = ['default', 'oldest', 'name-asc', 'name-desc'] as const
export type AdminSort = (typeof ADMIN_SORTS)[number]
export type AdminSortGroup = 'added' | 'name'
/** The group each sort is listed under in the Sort menu: Date added (the default is its newest first) or Name. */
export const adminSortGroup = (sort: AdminSort): AdminSortGroup => (sort.startsWith('name-') ? 'name' : 'added')

export function listAdmins(
  admins: User[], superAdminId: string | null, query: string,
  { roles = [], sort = 'default' }: { roles?: AdminRoleKey[]; sort?: AdminSort } = {},
): User[] {
  const needle = query.trim().toLowerCase()
  const byName = (a: User, b: User) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  /** By date added (newest first when `newest`); unknown dates last either way. */
  const byAdded = (newest: boolean) => (a: User, b: User) => {
    const first = a.adminSince ? Date.parse(a.adminSince) : NaN, second = b.adminSince ? Date.parse(b.adminSince) : NaN
    if (Number.isNaN(first) || Number.isNaN(second)) return Number(Number.isNaN(first)) - Number(Number.isNaN(second)) || byName(a, b)
    return (newest ? second - first : first - second) || byName(a, b)
  }
  const orders: Record<AdminSort, (a: User, b: User) => number> = {
    default: byAdded(true),
    oldest: byAdded(false),
    'name-asc': byName,
    'name-desc': (a, b) => -byName(a, b),
  }
  return admins
    .filter((admin) => !needle || admin.name.toLowerCase().includes(needle) || admin.email.toLowerCase().includes(needle))
    .filter((admin) => roles.length === 0 || roles.includes(adminRole(admin.id, superAdminId)))
    .sort(orders[sort])
}
