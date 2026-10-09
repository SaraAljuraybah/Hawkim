import { createContext, useContext, useMemo } from 'react'
import type { UserRequest } from '../data/mock/types'
import { useCurrentUser } from './sessionContext'

/** Fields the user fills in; id, dates, status and requester are set by the store. */
export type NewRequest = Pick<UserRequest, 'title' | 'type' | 'departmentId' | 'description'>

export interface RequestsStore {
  /** Every user's requests (each has its requester). */
  requests: UserRequest[]
  /** Adds a pending request by the signed-in user, dated today, and returns it. */
  addRequest: (request: NewRequest) => UserRequest
  /** Cancels a pending request (other statuses are left unchanged). */
  cancelRequest: (id: string) => void

  // Admin responses (PBI 33), by the signed-in admin. Each checks lib/requestAdmin.ts and throws if not allowed.
  /** Approves a pending request (a Department Access request gives access at once). */
  approveRequest: (id: string) => void
  rejectRequest: (id: string) => void
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
