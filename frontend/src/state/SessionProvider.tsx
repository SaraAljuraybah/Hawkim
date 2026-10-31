import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '../data/mock/types'
import { onSignedOut, restoreSession, signOut as endSession } from '../services/auth'
import { clearStoredActiveDepartment } from './activeDepartmentStorage'
import { SessionContext, type SessionStatus, type SessionStore } from './sessionContext'

type SessionState = { status: SessionStatus; user: User | null }

const SIGNED_OUT: SessionState = { status: 'signed-out', user: null }

/**
 * Who is signed in, from the Supabase Auth session (kept per browser tab, see
 * services/supabase.ts). On load it restores this tab's session, if any; the session
 * ends when the person signs out or Supabase can no longer refresh it.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading', user: null })

  useEffect(() => {
    let active = true
    // Only the first answer counts: a sign-in finished in the meantime wins.
    const settle = (next: SessionState) => {
      if (active) setState((current) => (current.status === 'loading' ? next : current))
    }
    restoreSession().then((user) => settle(user ? { status: 'signed-in', user } : SIGNED_OUT))
    const unsubscribe = onSignedOut(() => {
      if (active) setState(SIGNED_OUT)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const signIn = useCallback((user: User) => {
    // Every sign-in starts in the user's home department (not one remembered from before).
    clearStoredActiveDepartment()
    setState({ status: 'signed-in', user })
  }, [])

  const signOut = useCallback(() => {
    setState(SIGNED_OUT)
    clearStoredActiveDepartment()
    void endSession()
  }, [])

  const store = useMemo<SessionStore>(() => ({ ...state, signIn, signOut }), [state, signIn, signOut])

  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>
}
