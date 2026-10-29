import { useEffect, useState } from 'react'
import { FRONTEND_PROTOTYPE } from '../lib/frontendRuntime'
import { useSession } from './sessionContext'

/** Where shared data from the database is: still loading, loaded, or it couldn't be loaded. */
export type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * The prototype uses its existing local fixtures without importing any service.
 * The disabled integration path loads separately for each identity, ignoring late
 * replies after sign-out or a user switch. A prior user's ready state never carries over.
 * `load` and `onLoaded` must be stable (module functions or useCallback).
 * Must be inside <SessionProvider>.
 */
export function useLoadAfterSignIn<T>(load: () => Promise<T>, onLoaded: (data: T) => void): LoadStatus {
  const userId = useSession().user?.id ?? ''
  const [loaded, setLoaded] = useState<{ userId: string; status: LoadStatus } | null>(null)

  useEffect(() => {
    if (FRONTEND_PROTOTYPE || !userId) return
    let active = true
    load().then(
      (data) => {
        if (!active) return
        onLoaded(data)
        setLoaded({ userId, status: 'ready' })
      },
      () => {
        if (active) setLoaded({ userId, status: 'error' })
      },
    )
    return () => {
      active = false
    }
  }, [userId, load, onLoaded])

  if (FRONTEND_PROTOTYPE) return 'ready'
  return userId && loaded?.userId === userId ? loaded.status : 'loading'
}
