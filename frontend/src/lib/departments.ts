import { departments } from '../data/mock/departments'
import type { Department, DepartmentId, User, UserRequest } from '../data/mock/types'

/**
 * The departments a user belongs to: their home department plus every department
 * where their department-access request was APPROVED ("joined" departments).
 * The home department comes first, then the joined ones in department-list order.
 * Pass the requests from the shared requests store, so the result updates as soon
 * as requests change.
 */
export function getUserDepartments(user: Pick<User, 'departmentId'>, requests: UserRequest[]): Department[] {
  const joined = new Set(
    requests
      .filter((request) => request.type === 'department-access' && request.status === 'approved')
      .map((request) => request.departmentId),
  )
  const home = departments.filter((department) => department.id === user.departmentId)
  const others = departments.filter((department) => department.id !== user.departmentId && joined.has(department.id))
  return [...home, ...others]
}

/**
 * The user's relationship with a department (Departments page):
 * - current:   the active department
 * - member:    another department the user belongs to
 * - requested: a department-access request for it is pending
 * - none:      none of the above (the user can request access)
 */
export type DepartmentState = 'current' | 'member' | 'requested' | 'none'

export function getDepartmentState(
  departmentId: DepartmentId,
  activeDepartmentId: DepartmentId,
  userDepartments: Department[],
  requests: UserRequest[],
): DepartmentState {
  if (departmentId === activeDepartmentId) return 'current'
  if (userDepartments.some((department) => department.id === departmentId)) return 'member'
  const pending = requests.some(
    (request) =>
      request.type === 'department-access' && request.departmentId === departmentId && request.status === 'pending',
  )
  return pending ? 'requested' : 'none'
}
