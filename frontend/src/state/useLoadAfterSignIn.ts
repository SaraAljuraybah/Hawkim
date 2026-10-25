import { useEffect, useState } from 'react'
import { useSession } from './sessionContext'

/** Where shared data from the database is: still loading, loaded, or it couldn't be loaded. */
export type LoadStatus = 'loading' | 'ready' | 'error'

/**
 * Loads data from the database once this tab has a signed-in user (row level security
 * shows nothing before that), then keeps it for the rest of the tab, also across signing
 * out and in, like the other in-memory stores. After an error, reloading the page tries again.
 * `load` and `onLoaded` must be stable (module functions or useCallback).
 * Must be inside <SessionProvider>.
 */
export function useLoadAfterSignIn<T>(load: () => Promise<T>, onLoaded: (data: T) => void): LoadStatus {
  const signedIn = useSession().status === 'signed-in'
  const [status, setStatus] = useState<'idle' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (!signedIn || status !== 'idle') return
    let active = true
    load().then(
      (data) => {
        if (!active) return
        onLoaded(data)
        setStatus('ready')
      },
      () => {
        if (active) setStatus('error')
      },
    )
    return () => {
      active = false
    }
  }, [signedIn, status, load, onLoaded])

  return status === 'idle' ? 'loading' : status
}
