import { departments } from '../data/mock/departments'
import type { Department, User, UserRequest } from '../data/mock/types'

/**
 * The departments a user belongs to: their home department plus every department
 * where their department-access request was APPROVED ("joined" departments).
 * Listed in the order of the department list. Pass the requests from the shared
 * requests store, so the result updates as soon as requests change.
 */
export function getUserDepartments(user: Pick<User, 'departmentId'>, requests: UserRequest[]): Department[] {
  const joined = new Set(
    requests
      .filter((request) => request.type === 'department-access' && request.status === 'approved')
      .map((request) => request.departmentId),
  )
  return departments.filter((department) => department.id === user.departmentId || joined.has(department.id))
}
