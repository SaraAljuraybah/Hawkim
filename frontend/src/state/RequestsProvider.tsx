import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { UserRequest } from '../data/mock/types'
import { todayIsoDate } from '../lib/format'
import { approveBlockers, decideRequest, rejectBlocker } from '../lib/requestAdmin'
import { cancelSavedRequest, decideSavedRequest, isSavedRequestType, submitSavedRequest } from '../services/requests'
import { useDepartments } from './departmentsContext'
import { RequestsContext, type NewRequest, type RequestsStore } from './requestsContext'
import { useSession } from './sessionContext'
import { useSavedRequests } from './useSavedRequests'
import { useUsers } from './usersContext'

/** The default start: no requests in memory (one constant, so it never changes between renders). */
const NO_REQUESTS: UserRequest[] = []

/**
 * Requests store shared by Submit a Request, My Requests, the dashboard and the admin portal (the requests
 * list and published-directory access grants).
 * - Regulatory Guideline Addition requests are saved in the database (useSavedRequests, services/requests.ts):
 *   each change is sent to the database, which enforces who may make it, then they are read again.
 * - The other types are kept in memory: the store starts empty (no demo requests; tests pass their own as
 *   `initialRequests`), and their changes are lost on
 *   reload (no backend for them yet).
 * Must be inside <DepartmentsProvider>, <UsersProvider> and <SessionProvider>.
 * TODO: Save the other request types in the database too.
 */
export function RequestsProvider({ children, initialRequests = NO_REQUESTS }: { children: ReactNode; initialRequests?: UserRequest[] }) {
  const [requests, setRequests] = useState<UserRequest[]>(initialRequests)
  // The latest list (as in the other stores): actions check against it, not the last render.
  const latestRef = useRef<UserRequest[]>(initialRequests)
  const commit = useCallback((next: UserRequest[]) => {
    latestRef.current = next
    setRequests(next)
  }, [])
  const saved = useSavedRequests()
  const { latest: latestSaved, reload: reloadSaved } = saved

  const user = useSession().user
  const userId = user?.id
  const activeIdentity = useRef(userId)
  useLayoutEffect(() => {
    activeIdentity.current = userId
    return () => { activeIdentity.current = undefined }
  }, [userId])
  const { users } = useUsers()
  const { departments } = useDepartments()

  const addRequest = useCallback(
    async (request: NewRequest) => {
      if (!userId || activeIdentity.current !== userId) throw new Error('Sign in to send a request')
      if (isSavedRequestType(request.type)) {
        const id = await submitSavedRequest(request)
        await reloadSaved()
        const created = latestSaved().find((item) => item.id === id)
        const now = new Date()
        // Saved even if it couldn't be read again yet: what was sent, as the database stored it.
        return created ?? { ...request, id, createdAt: todayIsoDate(now), submittedAt: now.toISOString(), status: 'pending', requesterId: userId }
      }
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
    [commit, latestSaved, reloadSaved, userId],
  )

  const cancelRequest = useCallback(
    (id: string): Promise<void> => {
      const savedRequest = latestSaved().find((item) => item.id === id)
      if (savedRequest) {
        // The database checks that it is the caller's own pending request.
        return cancelSavedRequest(id).finally(() => reloadSaved())
      }
      const request = latestRef.current.find((item) => item.id === id)
      if (!userId || activeIdentity.current !== userId || !request || request.requesterId !== userId || request.status !== 'pending') return Promise.resolve()
      commit(
        latestRef.current.map((item) =>
          item.id === id ? { ...item, status: 'cancelled' } : item,
        ),
      )
      return Promise.resolve()
    },
    [commit, latestSaved, reloadSaved, userId],
  )

  /** Applies the signed-in admin's decision to a request the rules allow (throws otherwise). */
  const decide = useCallback(
    (id: string, decision: 'approved' | 'rejected'): Promise<void> => {
      if (activeIdentity.current !== userId || !user?.permissions.includes('admin')) throw new Error('Only an admin can respond to requests')
      const request = latestSaved().find((item) => item.id === id) ?? latestRef.current.find((item) => item.id === id)
      if (!request) throw new Error(`Unknown request ${id}`)
      const blockers =
        decision === 'approved' ? approveBlockers(request, { users, departments }) : [rejectBlocker(request)].filter(Boolean)
      if (blockers.length > 0) throw new Error(`This request can't be ${decision} (${blockers.join(', ')})`)
      // Saved: the database checks the same rules (and that this Admin is of the request's organization).
      if (isSavedRequestType(request.type)) return decideSavedRequest(id, decision).finally(() => reloadSaved())
      commit(latestRef.current.map((item) => (item.id === id ? decideRequest(item, decision, user.id) : item)))
      return Promise.resolve()
    },
    [commit, latestSaved, reloadSaved, user, userId, users, departments],
  )
  const approveRequest = useCallback((id: string) => decide(id, 'approved'), [decide])
  const rejectRequest = useCallback((id: string) => decide(id, 'rejected'), [decide])

  // The saved requests first (newest first), then the browser's; never one twice.
  const allRequests = useMemo(() => [...saved.requests, ...requests], [saved.requests, requests])

  const store = useMemo<RequestsStore>(
    () => ({ requests: allRequests, savedStatus: saved.status, refreshSaved: reloadSaved, addRequest, cancelRequest, approveRequest, rejectRequest }),
    [allRequests, saved.status, reloadSaved, addRequest, cancelRequest, approveRequest, rejectRequest],
  )

  return <RequestsContext.Provider value={store}>{children}</RequestsContext.Provider>
}
