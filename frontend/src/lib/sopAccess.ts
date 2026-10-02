import type { Sop, User, UserRequest } from '../data/mock/types'

/**
 * - granted:   the user may open the SOP
 * - requested: a department-access request for the SOP's department is pending
 * - locked:    no access and no pending request
 */
export type SopAccess = 'granted' | 'requested' | 'locked'

/**
 * Whether the user can open an SOP. Access is by department:
 * the user's own department, plus departments with an APPROVED
 * department-access request.
 *
 * Pass the requests from the shared requests store, so the result
 * updates as soon as a request is submitted, approved or cancelled.
 *
 * TODO: The backend must enforce this same rule before serving any SOP file.
 * Hiding or locking SOPs in the browser is a convenience, not security.
 */
export function getSopAccess(
  sop: Pick<Sop, 'departmentId'>,
  user: Pick<User, 'departmentId'>,
  requests: UserRequest[],
): SopAccess {
  if (sop.departmentId === user.departmentId) return 'granted'

  const departmentRequests = requests.filter(
    (request) => request.type === 'department-access' && request.departmentId === sop.departmentId,
  )
  if (departmentRequests.some((request) => request.status === 'approved')) return 'granted'
  if (departmentRequests.some((request) => request.status === 'pending')) return 'requested'
  return 'locked'
}
