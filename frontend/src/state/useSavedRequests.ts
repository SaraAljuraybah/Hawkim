import { useCallback, useEffect, useRef, useState } from 'react'
import type { UserRequest } from '../data/mock/types'
import { fetchSavedRequests } from '../services/requests'
import { useSession } from './sessionContext'
import type { LoadStatus } from './useLoadAfterSignIn'

/** The saved requests read for one signed-in user (`userId`), and whether they loaded. */
interface Saved {
  userId: string
  status: LoadStatus
  requests: UserRequest[]
}

export interface SavedRequests {
  status: LoadStatus
  requests: UserRequest[]
  /** The newest list, also right after a reload (before the next render). */
  latest: () => UserRequest[]
  reload: () => Promise<void>
}

/**
 * The requests saved in the database (services/requests.ts) for the signed-in user, read after sign-in and
 * again on `reload` (after each change, and when a requests page opens). A reply for a user who has signed
 * out or switched is ignored, and a prior user's requests never carry over. When a reload fails, the requests
 * already shown stay and the status says 'error'.
 * Must be inside <SessionProvider>.
 */
export function useSavedRequests(): SavedRequests {
  const userId = useSession().user?.id ?? ''
  const [saved, setSaved] = useState<Saved>({ userId: '', status: 'loading', requests: [] })
  const savedRef = useRef(saved)
  const userRef = useRef(userId)

  const reload = useCallback(async () => {
    const forUser = userRef.current
    if (!forUser) return
    let next: Saved
    try {
      next = { userId: forUser, status: 'ready', requests: await fetchSavedRequests() }
    } catch {
      const kept = savedRef.current.userId === forUser ? savedRef.current.requests : []
      next = { userId: forUser, status: 'error', requests: kept }
    }
    if (userRef.current !== forUser) return
    savedRef.current = next
    setSaved(next)
  }, [])

  useEffect(() => {
    userRef.current = userId
    if (userId) void reload()
  }, [userId, reload])

  const latest = useCallback(() => (savedRef.current.userId === userRef.current && userRef.current ? savedRef.current.requests : []), [])
  const mine = saved.userId === userId && !!userId
  return { status: mine ? saved.status : 'loading', requests: mine ? saved.requests : [], latest, reload }
}
