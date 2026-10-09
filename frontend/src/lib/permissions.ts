import type { Permission, User } from '../data/mock/types'

/**
 * Whether the user has a permission. Every user is an employee; permissions
 * (author, reviewer, approver, admin) only ADD features on top of that.
 */
export function hasPermission(user: Pick<User, 'permissions'>, permission: Permission): boolean {
  return user.permissions.includes(permission)
}

/** Whether the user has the permission, or any of several (e.g. reviewer or approver for My Reviews). */
export function hasAnyPermission(user: Pick<User, 'permissions'>, permission: Permission | Permission[]): boolean {
  return (Array.isArray(permission) ? permission : [permission]).some((item) => user.permissions.includes(item))
}
