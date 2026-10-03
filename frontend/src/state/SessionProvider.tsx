import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { SessionContext, type SessionStore } from './sessionContext'
import { useUsers } from './usersContext'

const STORAGE_KEY = 'hawkim.session'

function readStored(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null // storage unavailable (private mode, blocked): nobody is signed in
  }
}

/**
 * Who is signed in. DEMO ONLY: the session is just the user's id, kept in
 * sessionStorage so a reload keeps the person (until the tab is closed or they
 * sign out). Never store the password or any other credential here.
 * A deleted (or unknown) user's session ends at once: they are signed out.
 * TODO: Replace with the auth provider's session (e.g. Supabase Auth) once the backend exists.
 * Must be inside <UsersProvider>.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { activeUsers } = useUsers()
  const [userId, setUserId] = useState<string | null>(readStored)
  const user = activeUsers.find((item) => item.id === userId) ?? null

  const signIn = useCallback((id: string) => {
    setUserId(id)
    try {
      sessionStorage.setItem(STORAGE_KEY, id)
    } catch {
      // Without storage the session only lasts until reload.
    }
  }, [])

  const signOut = useCallback(() => {
    setUserId(null)
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      // Nothing was stored.
    }
  }, [])

  const store = useMemo<SessionStore>(() => ({ user, signIn, signOut }), [user, signIn, signOut])

  return <SessionContext.Provider value={store}>{children}</SessionContext.Provider>
}
