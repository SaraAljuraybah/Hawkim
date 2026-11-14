import { createContext, useContext } from 'react'
import { adminsEn } from '../content/admins.en'
import type { User } from '../data/mock/types'
import type { SuperAdminState } from '../hooks/useSuperAdmin'

/** Who the Super Admin is, shared by the admin portal (<SuperAdminProvider>); null outside it. */
export const SuperAdminContext = createContext<SuperAdminState | null>(null)

/**
 * The administrator role to show for `user` in the admin portal: "Super Admin" for the current Super
 * Admin, "Admin" for any other administrator. Null while it isn't known yet (loading, or it couldn't
 * be loaded), so the Super Admin is never briefly shown as "Admin". Undefined for anyone who isn't an
 * administrator, or outside the admin portal (callers then use the plain permission label).
 */
export function useAdminRoleLabel(user: Pick<User, 'id' | 'permissions'> | null | undefined): string | null | undefined {
  const shared = useContext(SuperAdminContext)
  if (!user || !user.permissions.includes('admin') || !shared) return undefined
  if (shared.status !== 'ready') return null
  return user.id === shared.superAdminId ? adminsEn.roles.superAdmin : adminsEn.roles.admin
}
