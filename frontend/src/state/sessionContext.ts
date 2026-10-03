import { createContext, useContext } from 'react'
import type { User } from '../data/mock/types'

export interface SessionStore {
  /** The signed-in user, or null when nobody is signed in. */
  user: User | null
  /** Starts a session for this user (after the auth service accepted the sign-in). */
  signIn: (userId: string) => void
  signOut: () => void
}

export const SessionContext = createContext<SessionStore | null>(null)

/** Access the session. Must be used inside <SessionProvider>. */
export function useSession(): SessionStore {
  const store = useContext(SessionContext)
  if (!store) throw new Error('useSession must be used inside <SessionProvider>')
  return store
}

/**
 * The signed-in user. Only for screens behind the sign-in guard (src/routes/guards.tsx),
 * which never render without one.
 */
export function useCurrentUser(): User {
  const { user } = useSession()
  if (!user) throw new Error('useCurrentUser needs a signed-in user')
  return user
}
