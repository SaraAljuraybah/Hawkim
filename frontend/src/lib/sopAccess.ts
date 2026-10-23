import type { Department, Sop, User, UserRequest } from '../data/mock/types'
import { hasDirectoryAccess } from './departments'

export type SopAccess = 'granted' | 'requested' | 'locked'

/** Published-directory access only. Authoring and review assignments are separate. */
export function getSopAccess(sop: Pick<Sop, 'departmentId' | 'status'>, user: Pick<User, 'id' | 'departmentId' | 'deletedAt'>, requests: UserRequest[]): SopAccess {
  if (sop.status !== 'published' || user.deletedAt) return 'locked'
  if (hasDirectoryAccess(user, sop.departmentId, requests)) return 'granted'
  const pending = requests.some((request) => request.requesterId === user.id && request.type === 'department-access' && request.departmentId === sop.departmentId && request.status === 'pending')
  return pending ? 'requested' : 'locked'
}

/** Authorize before directory search, counts, links or document rendering. */
export function directorySopsFor(sops: Sop[], user: Pick<User, 'id' | 'departmentId' | 'deletedAt'>, requests: UserRequest[]): Sop[] {
  return sops.filter((sop) => getSopAccess(sop, user, requests) === 'granted')
}

/** Directory approvals cannot authorize creation, including direct store calls. */
export function assertCanCreateSop(user: User | undefined, departmentId: string, departments: Department[]): void {
  if (!user || user.deletedAt || !user.permissions.includes('author') || user.permissions.includes('admin')) throw new Error('An active Author account is required to create an SOP')
  if (user.departmentId !== departmentId) throw new Error('SOPs can only be created in your home department')
  if (!departments.some((department) => department.id === departmentId && !department.removedAt)) throw new Error('The home department is unavailable')
}
