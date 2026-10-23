import type { Department, DepartmentId, User, UserRequest } from '../data/mock/types'

type DepartmentUser = Pick<User, 'id' | 'departmentId' | 'deletedAt'>

/** Membership is the home department; directory requests never add memberships. */
export function getUserDepartments(user: DepartmentUser, departments: Department[]): Department[] {
  return user.deletedAt ? [] : departments.filter((department) => !department.removedAt && department.id === user.departmentId)
}

/** Published-directory reading is independent of membership and roles. */
export function hasDirectoryAccess(user: DepartmentUser, departmentId: DepartmentId, requests: UserRequest[]): boolean {
  return !user.deletedAt && (user.departmentId === departmentId || requests.some((request) =>
    request.requesterId === user.id && request.type === 'department-access' && request.departmentId === departmentId && request.status === 'approved'))
}

/** Home first, then independently approved read-only directories, each once. */
export function getDirectoryDepartments(user: DepartmentUser, requests: UserRequest[], departments: Department[]): Department[] {
  const home = getUserDepartments(user, departments)
  const others = departments.filter((department) => !department.removedAt && department.id !== user.departmentId && hasDirectoryAccess(user, department.id, requests))
  return [...home, ...others]
}

export type DepartmentState = 'current' | 'member' | 'directory' | 'requested' | 'none'

/** Directory selection is a browsing preference, never a membership or role change. */
export function getDepartmentState(departmentId: DepartmentId, activeDirectoryId: DepartmentId, user: DepartmentUser, requests: UserRequest[]): DepartmentState {
  if (hasDirectoryAccess(user, departmentId, requests)) {
    if (departmentId === activeDirectoryId) return 'current'
    return departmentId === user.departmentId ? 'member' : 'directory'
  }
  const pending = !user.deletedAt && requests.some((request) => request.requesterId === user.id && request.type === 'department-access' && request.departmentId === departmentId && request.status === 'pending')
  return pending ? 'requested' : 'none'
}
