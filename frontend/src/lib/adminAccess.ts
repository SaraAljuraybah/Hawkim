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
 * | Make Super Admin (transfer)   | yes         | no    |
 * | Delete the Super Admin        | no          | no    |
 */

/** The administrators: active accounts with the Admin permission. */
export function administrators(activeUsers: User[]): User[] {
  return activeUsers.filter(isSystemAdmin)
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

/** The Super Admin first, then by name; filtered by name or email, ignoring case. */
export function listAdmins(admins: User[], superAdminId: string | null, query: string): User[] {
  const needle = query.trim().toLowerCase()
  return admins
    .filter((admin) => !needle || admin.name.toLowerCase().includes(needle) || admin.email.toLowerCase().includes(needle))
    .sort((a, b) => Number(b.id === superAdminId) - Number(a.id === superAdminId) || a.name.localeCompare(b.name))
}
