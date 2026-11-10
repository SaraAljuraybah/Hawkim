import { useCallback, useContext, useEffect, useState } from 'react'
import { fetchSuperAdminId } from '../services/admins'
import { SuperAdminContext } from '../state/superAdminContext'
import type { LoadStatus } from '../state/useLoadAfterSignIn'

export interface SuperAdminState {
  status: LoadStatus
  /** The current Super Admin's id; null when none is assigned (or not loaded yet). */
  superAdminId: string | null
  /** Loads it again (Try Again). */
  reload: () => void
  /** After a transfer: the id the server returned. */
  set: (id: string) => void
}

/**
 * Reads who the Super Admin is from the database (when `enabled`). Used by <SuperAdminProvider>,
 * and by useSuperAdmin outside of one. Elevated actions stay hidden until it has loaded; the server
 * checks them again in any case.
 */
export function useSuperAdminLoader(enabled = true): SuperAdminState {
  const [state, setState] = useState<{ status: LoadStatus; superAdminId: string | null }>({ status: 'loading', superAdminId: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let active = true
    fetchSuperAdminId().then(
      (superAdminId) => active && setState({ status: 'ready', superAdminId }),
      () => active && setState((previous) => ({ ...previous, status: 'error' })),
    )
    return () => {
      active = false
    }
  }, [attempt, enabled])

  // Keeps showing what it has while it reads again; only a failed load shows loading again.
  const reload = useCallback(() => {
    setState((previous) => (previous.status === 'error' ? { ...previous, status: 'loading' } : previous))
    setAttempt((count) => count + 1)
  }, [])
  const set = useCallback((superAdminId: string) => setState({ status: 'ready', superAdminId }), [])

  return { ...state, reload, set }
}

/**
 * Who the Super Admin is, for the Admins pages. Inside the admin portal this is the portal's shared
 * state (<SuperAdminProvider>), so a transfer updates the sidebar, top bar and My Profile at once. It
 * is read again from the database each time an Admins page opens, so a transfer made anywhere
 * (another tab, another Admin) shows there too.
 */
export function useSuperAdmin(): SuperAdminState {
  const shared = useContext(SuperAdminContext)
  const local = useSuperAdminLoader(!shared)
  const reloadShared = shared?.reload
  useEffect(() => {
    reloadShared?.()
  }, [reloadShared])
  return shared ?? local
}
