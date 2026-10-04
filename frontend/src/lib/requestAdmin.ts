import type { Department, User, UserRequest } from '../data/mock/types'

/*
 * Admin rules for user requests (PBI 33): the admin approves or rejects pending
 * requests. Pure functions: the requests store refuses anything they don't allow,
 * and the admin pages use them to explain why.
 *
 * Approving a Department Access request gives access at once (membership comes
 * from approved requests, see lib/departments.ts). Approving a Permission or Role
 * Change only marks it approved; the admin makes any change on the user's page.
 * TODO: The backend must enforce these same rules.
 */

/**
 * Why an action isn't allowed:
 * - not-pending:        only pending requests can be decided (cancelled, approved and rejected are read-only);
 * - department-removed: a Department Access request for a removed department can't be approved;
 * - requester-deleted:  a request from a deleted user can't be approved.
 */
export type RequestBlocker = 'not-pending' | 'department-removed' | 'requester-deleted'

export interface RequestRulesData {
  /** Every user, deleted ones included. */
  users: User[]
  /** Every department, removed ones included. */
  departments: Department[]
}

/** Why the request can't be approved (undefined: it can). */
export function approveBlocker(request: UserRequest, data: RequestRulesData): RequestBlocker | undefined {
  if (request.status !== 'pending') return 'not-pending'
  const requester = data.users.find((user) => user.id === request.requesterId)
  if (!requester || requester.deletedAt) return 'requester-deleted'
  if (request.type === 'department-access') {
    const department = data.departments.find((item) => item.id === request.departmentId)
    if (!department || department.removedAt) return 'department-removed'
  }
  return undefined
}

/** Why the request can't be rejected (undefined: it can). Any pending request can be rejected. */
export function rejectBlocker(request: UserRequest): RequestBlocker | undefined {
  return request.status === 'pending' ? undefined : 'not-pending'
}

/** The request after the admin's decision: its status, who decided and when. */
export function decideRequest(
  request: UserRequest,
  decision: 'approved' | 'rejected',
  adminId: string,
  decidedAt = new Date().toISOString(),
): UserRequest {
  return { ...request, status: decision, decidedById: adminId, decidedAt }
}

/** Pending requests (the admin sidebar's count). */
export function pendingRequests(requests: UserRequest[]): UserRequest[] {
  return requests.filter((request) => request.status === 'pending')
}
