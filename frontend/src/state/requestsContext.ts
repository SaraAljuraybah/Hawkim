import { createContext, useContext } from 'react'
import type { UserRequest } from '../data/mock/types'

/** Fields the user fills in; id, date and status are set by the store. */
export type NewRequest = Pick<UserRequest, 'title' | 'type' | 'departmentId' | 'description'>

export interface RequestsStore {
  requests: UserRequest[]
  /** Adds a pending request dated today and returns it. */
  addRequest: (request: NewRequest) => UserRequest
  /** Cancels a pending request (other statuses are left unchanged). */
  cancelRequest: (id: string) => void
}

export const RequestsContext = createContext<RequestsStore | null>(null)

/** Access the shared requests store. Must be used inside <RequestsProvider>. */
export function useRequests(): RequestsStore {
  const store = useContext(RequestsContext)
  if (!store) throw new Error('useRequests must be used inside <RequestsProvider>')
  return store
}
