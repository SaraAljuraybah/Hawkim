import { useCallback, useEffect, useState } from 'react'
import { fetchOrganizationName } from '../services/organizationSettings'
import type { LoadStatus } from '../state/useLoadAfterSignIn'

export interface OrganizationNameState {
  status: LoadStatus
  /** The saved name; null when none is saved yet (or not loaded). */
  name: string | null
  /** After saving: the name the server returned. */
  set: (name: string) => void
}

/** Reads the organization's name from the database once, when the page opens. */
export function useOrganizationName(): OrganizationNameState {
  const [state, setState] = useState<{ status: LoadStatus; name: string | null }>({ status: 'loading', name: null })
  useEffect(() => {
    let active = true
    fetchOrganizationName().then(
      (name) => active && setState({ status: 'ready', name }),
      () => active && setState({ status: 'error', name: null }),
    )
    return () => {
      active = false
    }
  }, [])
  const set = useCallback((name: string) => setState({ status: 'ready', name }), [])
  return { ...state, set }
}
