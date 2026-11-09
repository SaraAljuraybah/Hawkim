import { useCallback, useEffect, useState } from 'react'
import { fetchSuperAdminId } from '../services/admins'
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
 * Who the Super Admin is, read from the database each time an Admins page opens, so a transfer
 * made anywhere (another tab, another Admin) shows on the next page. Elevated actions stay hidden
 * until it has loaded; the server checks them again in any case.
 */
export function useSuperAdmin(): SuperAdminState {
  const [state, setState] = useState<{ status: LoadStatus; superAdminId: string | null }>({ status: 'loading', superAdminId: null })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    fetchSuperAdminId().then(
      (superAdminId) => active && setState({ status: 'ready', superAdminId }),
      () => active && setState((previous) => ({ ...previous, status: 'error' })),
    )
    return () => {
      active = false
    }
  }, [attempt])

  // Keeps showing what it has while it reads again; only a failed load shows loading again.
  const reload = useCallback(() => {
    setState((previous) => (previous.status === 'error' ? { ...previous, status: 'loading' } : previous))
    setAttempt((count) => count + 1)
  }, [])
  const set = useCallback((superAdminId: string) => setState({ status: 'ready', superAdminId }), [])

  return { ...state, reload, set }
}
