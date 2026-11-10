import type { Department, Sop, User, UserRequest } from '../data/mock/types'
import { hasDirectoryAccess } from './departments'

export type SopAccess = 'granted' | 'requested' | 'locked'

/**
 * Published-directory access only. Authoring and review assignments are separate.
 * An SOP moved to Others belongs to a deleted department: membership of, or access requests for, that
 * department never open it. Only its main author and co-authors find it in the directory (the
 * database, can_view_sop, keeps the same people able to read it).
 * A System Admin may open every department's published SOPs, but not those in Others (the database's
 * admin_can_read_published_sop allows the same).
 */
export function getSopAccess(
  sop: Pick<Sop, 'departmentId' | 'status'> & Partial<Pick<Sop, 'directoryGroup' | 'authorId' | 'coAuthorIds'>>,
  user: Pick<User, 'id' | 'departmentId' | 'deletedAt'> & Partial<Pick<User, 'permissions'>>,
  requests: UserRequest[],
): SopAccess {
  if (sop.status !== 'published' || user.deletedAt) return 'locked'
  if (user.permissions?.includes('admin') && sop.directoryGroup !== 'others') return 'granted'
  if (sop.directoryGroup === 'others') {
    return sop.authorId === user.id || !!sop.coAuthorIds?.includes(user.id) ? 'granted' : 'locked'
  }
  if (hasDirectoryAccess(user, sop.departmentId, requests)) return 'granted'
  const pending = requests.some((request) => request.requesterId === user.id && request.type === 'department-access' && request.departmentId === sop.departmentId && request.status === 'pending')
  return pending ? 'requested' : 'locked'
}

/**
 * Whether the user worked on the SOP: its main author, a co-author, a reviewer who completed or returned
 * a review (any version, any round), or an approver who approved it. Approvals aren't saved in the
 * database yet, so approvers count only where this browser has them.
 */
export function workedOn(sop: Pick<Sop, 'authorId' | 'coAuthorIds' | 'reviewers' | 'approvers'> & Partial<Pick<Sop, 'internalReviewRounds'>>, userId: string): boolean {
  const reviewed = (decision: string) => decision === 'completed' || decision === 'returned'
  return sop.authorId === userId
    || sop.coAuthorIds.includes(userId)
    || !!sop.internalReviewRounds?.some((round) => round.assignments.some((item) => item.userId === userId && reviewed(item.decision)))
    || sop.reviewers.some((item) => item.userId === userId && reviewed(item.decision))
    || sop.approvers.some((item) => item.userId === userId && item.decision === 'approved')
}

/**
 * The SOP Directory and an SOP's directory page (not the workflow or review pages): only published SOPs.
 * A System Admin opens every department's (not Others); everyone else only those they worked on, in any
 * department, Others included. The active department and access requests don't matter here.
 */
export function directoryAccess(
  sop: Parameters<typeof workedOn>[0] & Pick<Sop, 'status'> & Partial<Pick<Sop, 'directoryGroup'>>,
  user: Pick<User, 'id' | 'deletedAt'> & Partial<Pick<User, 'permissions'>>,
): 'granted' | 'locked' {
  if (sop.status !== 'published' || user.deletedAt) return 'locked'
  if (user.permissions?.includes('admin')) return sop.directoryGroup === 'others' ? 'locked' : 'granted'
  return workedOn(sop, user.id) ? 'granted' : 'locked'
}

/** Authorize before directory search, counts, links or document rendering. */
export function directorySopsFor(sops: Sop[], user: Pick<User, 'id' | 'deletedAt'> & Partial<Pick<User, 'permissions'>>): Sop[] {
  return sops.filter((sop) => directoryAccess(sop, user) === 'granted')
}

/** Directory approvals cannot authorize creation, including direct store calls. */
export function assertCanCreateSop(user: User | undefined, departmentId: string, departments: Department[]): void {
  if (!user || user.deletedAt || !user.permissions.includes('author') || user.permissions.includes('admin')) throw new Error('An active Author account is required to create an SOP')
  if (user.departmentId !== departmentId) throw new Error('SOPs can only be created in your home department')
  if (!departments.some((department) => department.id === departmentId && !department.removedAt)) throw new Error('The home department is unavailable')
}
