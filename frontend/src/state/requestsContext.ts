import { createContext, useContext, useMemo } from 'react'
import type { UserRequest } from '../data/mock/types'
import { useCurrentUser } from './sessionContext'
import type { LoadStatus } from './useLoadAfterSignIn'

/** Fields the user fills in; id, dates, status and requester are set by the store. */
export type NewRequest = Pick<UserRequest, 'title' | 'type' | 'departmentId' | 'description'>

/*
 * Two kinds of requests share this store. Regulatory Guideline Addition requests are saved in the database
 * (services/requests.ts): they survive a reload and a new session, and the database decides who reads,
 * cancels and decides them. The other types (Department Access, Permission Change, Role Change) are still
 * kept in the browser only, as before. For those, every action takes effect at once (and throws at once when
 * it isn't allowed); for saved ones, the returned promise settles once the database has answered and the
 * saved requests have been read again (it rejects with a RequestError when refused).
 */
export interface RequestsStore {
  /** Every request this user may see: the saved ones (theirs, or for an Admin the organization's) and the browser's. */
  requests: UserRequest[]
  /** Whether the saved requests have been read ('error': they couldn't be; the others are still shown). */
  savedStatus: LoadStatus
  /** Reads the saved requests again (when a requests page opens, or after an error). */
  refreshSaved: () => Promise<void>
  /** Adds a pending request by the signed-in user, dated today, and returns it. */
  addRequest: (request: NewRequest) => Promise<UserRequest>
  /** Cancels only the signed-in user's own pending request; other requests are left unchanged. */
  cancelRequest: (id: string) => Promise<void>

  // Admin responses (PBI 33), by the signed-in admin. Each checks lib/requestAdmin.ts and throws if not allowed.
  /** Approves a pending request; Department Access grants read-only published-directory access. Approving a
   * Regulatory Guideline Addition only records the decision (no guideline is added). */
  approveRequest: (id: string) => Promise<void>
  rejectRequest: (id: string) => Promise<void>
}

export const RequestsContext = createContext<RequestsStore | null>(null)

/** Access the shared requests store. Must be used inside <RequestsProvider>. */
export function useRequests(): RequestsStore {
  const store = useContext(RequestsContext)
  if (!store) throw new Error('useRequests must be used inside <RequestsProvider>')
  return store
}

/** The signed-in user's own requests. */
export function useMyRequests(): UserRequest[] {
  const { requests } = useRequests()
  const user = useCurrentUser()
  return useMemo(() => requests.filter((request) => request.requesterId === user.id), [requests, user.id])
}
