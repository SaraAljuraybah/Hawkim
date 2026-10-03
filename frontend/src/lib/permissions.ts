import type { Permission, User } from '../data/mock/types'

/**
 * Whether the user has a permission. Every user is an employee; permissions
 * (author, reviewer, approver, admin) only ADD features on top of that.
 */
export function hasPermission(user: Pick<User, 'permissions'>, permission: Permission): boolean {
  return user.permissions.includes(permission)
}
