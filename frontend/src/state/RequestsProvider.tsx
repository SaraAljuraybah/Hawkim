import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { mockRequests } from '../data/mock/requests'
import type { UserRequest } from '../data/mock/types'
import { todayIsoDate } from '../lib/format'
import { RequestsContext, type NewRequest, type RequestsStore } from './requestsContext'
import { useSession } from './sessionContext'

/**
 * In-memory requests store shared by Submit a Request, My Requests, the dashboard
 * and the admin portal (a user's joined departments).
 * It starts with the sample data; changes are lost on reload (no backend, no storage).
 * TODO: Replace with API calls (load, submit and cancel requests) once the backend exists.
 */
export function RequestsProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<UserRequest[]>(mockRequests)
  const userId = useSession().user?.id

  const addRequest = useCallback((request: NewRequest) => {
    if (!userId) throw new Error('Sign in to send a request')
    const created: UserRequest = {
      ...request,
      // Unique enough for an in-memory demo (the backend will assign real ids).
      id: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: todayIsoDate(),
      status: 'pending',
      requesterId: userId,
    }
    setRequests((current) => [created, ...current])
    return created
  }, [userId])

  const cancelRequest = useCallback((id: string) => {
    setRequests((current) =>
      current.map((request) =>
        request.id === id && request.status === 'pending' ? { ...request, status: 'cancelled' } : request,
      ),
    )
  }, [])

  const store = useMemo<RequestsStore>(
    () => ({ requests, addRequest, cancelRequest }),
    [requests, addRequest, cancelRequest],
  )

  return <RequestsContext.Provider value={store}>{children}</RequestsContext.Provider>
}
