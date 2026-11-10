import type { ReactNode } from 'react'
import { useSuperAdminLoader } from '../hooks/useSuperAdmin'
import { SuperAdminContext } from './superAdminContext'

/**
 * Who the Super Admin is, for the whole admin portal: the role shown in the sidebar, the top bar and
 * My Profile, and the Admins pages. Make Super Admin updates it, so every label changes at once.
 * Render it with `key` set to the signed-in user's id, so another user never sees the previous state.
 */
export function SuperAdminProvider({ children }: { children: ReactNode }) {
  const state = useSuperAdminLoader()
  return <SuperAdminContext.Provider value={state}>{children}</SuperAdminContext.Provider>
}
