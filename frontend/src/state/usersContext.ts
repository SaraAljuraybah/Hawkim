import { createContext, useContext } from 'react'
import type { User } from '../data/mock/types'

export interface UsersStore {
  /** Every user, deleted ones included (their names stay on SOP history). */
  users: User[]
  /** Users who can use Hawkim (not deleted): lists, pickers and sign-in. */
  activeUsers: User[]
  /** A user by id, deleted or not (undefined if unknown). */
  getUser: (id: string | undefined) => User | undefined
  /** A user's name for display; "(deleted)" is added for a deleted user. */
  nameOf: (id: string | undefined) => string
}

export const UsersContext = createContext<UsersStore | null>(null)

/** Access the shared users store. Must be used inside <UsersProvider>. */
export function useUsers(): UsersStore {
  const store = useContext(UsersContext)
  if (!store) throw new Error('useUsers must be used inside <UsersProvider>')
  return store
}
