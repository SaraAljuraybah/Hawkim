import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { User } from '../data/mock/types'
import { isProfileActive, onSignedOut, restoreSession, signOut as endSession } from '../services/auth'
import { clearStoredActiveDepartment } from './activeDepartmentStorage'
import { watchActiveProfile } from './profileWatch'
import { SessionContext, type SessionStatus, type SessionStore } from './sessionContext'

type SessionState = { status: SessionStatus; user: User | null }

const SIGNED_OUT: SessionState = { status: 'signed-out', user: null }

/**
 * Who is signed in, from the Supabase Auth session (kept per browser tab, see
 * services/supabase.ts). On load it restores this tab's session, if any; the session
 * ends when the person signs out, Supabase can no longer refresh it, or their profile was
 * deactivated meanwhile (state/profileWatch.ts).
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

  // Deactivated while this tab is open (Delete Staff): the session ends here too.
  const userId = state.user?.id
  useEffect(() => (userId ? watchActiveProfile(userId, isProfileActive, signOut) : undefined), [userId, signOut])

  const store = useMemo<SessionStore>(() => ({ ...state, signIn, signOut }), [state, signIn, signOut])

  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>
}
