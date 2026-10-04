import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { mockRequests } from '../data/mock/requests'
import type { UserRequest } from '../data/mock/types'
import { todayIsoDate } from '../lib/format'
import { approveBlocker, decideRequest, rejectBlocker } from '../lib/requestAdmin'
import { useDepartments } from './departmentsContext'
import { RequestsContext, type NewRequest, type RequestsStore } from './requestsContext'
import { useSession } from './sessionContext'
import { useUsers } from './usersContext'

/**
 * In-memory requests store shared by Submit a Request, My Requests, the dashboard
 * and the admin portal (the requests list, and a user's joined departments).
 * It starts with the sample data; changes are lost on reload (no backend, no storage).
 * Must be inside <DepartmentsProvider>, <UsersProvider> and <SessionProvider>.
 * TODO: Replace with API calls (load, submit, cancel and decide requests) once the backend exists.
 */
export function RequestsProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<UserRequest[]>(mockRequests)
  // The latest list (as in the other stores): actions check against it, not the last render.
  const latestRef = useRef<UserRequest[]>(mockRequests)
  const commit = useCallback((next: UserRequest[]) => {
    latestRef.current = next
    setRequests(next)
  }, [])

  const user = useSession().user
  const userId = user?.id
  const { users } = useUsers()
  const { departments } = useDepartments()

  const addRequest = useCallback(
    (request: NewRequest) => {
      if (!userId) throw new Error('Sign in to send a request')
      const now = new Date()
      const created: UserRequest = {
        ...request,
        // Unique enough for an in-memory demo (the backend will assign real ids).
        id: `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: todayIsoDate(now),
        submittedAt: now.toISOString(),
        status: 'pending',
        requesterId: userId,
      }
      commit([created, ...latestRef.current])
      return created
    },
    [commit, userId],
  )

  const cancelRequest = useCallback(
    (id: string) => {
      commit(
        latestRef.current.map((request) =>
          request.id === id && request.status === 'pending' ? { ...request, status: 'cancelled' } : request,
        ),
      )
    },
    [commit],
  )

  /** Applies the signed-in admin's decision to a request the rules allow (throws otherwise). */
  const decide = useCallback(
    (id: string, decision: 'approved' | 'rejected') => {
      if (!user?.permissions.includes('admin')) throw new Error('Only an admin can respond to requests')
      const request = latestRef.current.find((item) => item.id === id)
      if (!request) throw new Error(`Unknown request ${id}`)
      const blocker = decision === 'approved' ? approveBlocker(request, { users, departments }) : rejectBlocker(request)
      if (blocker) throw new Error(`This request can't be ${decision} (${blocker})`)
      commit(latestRef.current.map((item) => (item.id === id ? decideRequest(item, decision, user.id) : item)))
    },
    [commit, user, users, departments],
  )
  const approveRequest = useCallback((id: string) => decide(id, 'approved'), [decide])
  const rejectRequest = useCallback((id: string) => decide(id, 'rejected'), [decide])

  const store = useMemo<RequestsStore>(
    () => ({ requests, addRequest, cancelRequest, approveRequest, rejectRequest }),
    [requests, addRequest, cancelRequest, approveRequest, rejectRequest],
  )

  return <RequestsContext.Provider value={store}>{children}</RequestsContext.Provider>
}
