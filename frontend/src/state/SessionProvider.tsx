import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '../data/mock/types'
import { FRONTEND_PROTOTYPE } from '../lib/frontendRuntime'
import { clearStoredActiveDepartment } from './activeDepartmentStorage'
import { SessionContext, type SessionStatus, type SessionStore } from './sessionContext'

type SessionState = { status: SessionStatus; user: User | null }

const SIGNED_OUT: SessionState = { status: 'signed-out', user: null }

/**
 * Local prototype identity, held only in memory. Experimental authentication is
 * retained behind the disabled integration branch and is never imported here.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(FRONTEND_PROTOTYPE ? SIGNED_OUT : { status: 'loading', user: null })

  useEffect(() => {
    if (FRONTEND_PROTOTYPE) return
    let active = true
    let unsubscribe = () => {}
    // Only the first answer counts: a sign-in finished in the meantime wins.
    const settle = (next: SessionState) => {
      if (active) setState((current) => (current.status === 'loading' ? next : current))
    }
    void import('../services/auth').then(({ restoreSession, onSignedOut }) => {
      if (!active) return
      void restoreSession().then((user) => settle(user ? { status: 'signed-in', user } : SIGNED_OUT))
      unsubscribe = onSignedOut(() => {
        if (active) setState(SIGNED_OUT)
      })
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
    if (!FRONTEND_PROTOTYPE) void import('../services/auth').then(({ signOut }) => signOut())
  }, [])

  const store = useMemo<SessionStore>(() => ({ ...state, signIn, signOut }), [state, signIn, signOut])

  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>
}
