import { createContext, useContext } from 'react'
import type { Permission, Sop, User } from '../data/mock/types'
import type { NewUser } from '../lib/userAdmin'

/** What the admin actions check against: who is acting, and every SOP (for permissions in use). */
export interface AdminActionContext {
  actorId: string
  sops: Sop[]
}

export interface UsersStore {
  /** Every user, deleted ones included (their names stay on SOP history). */
  users: User[]
  /** Users who can use Hawkim (not deleted): lists, pickers and sign-in. */
  activeUsers: User[]
  /** A user by id, deleted or not (undefined if unknown). */
  getUser: (id: string | undefined) => User | undefined
  /** A user's name for display; "(deleted)" is added for a deleted user. */
  nameOf: (id: string | undefined) => string

  // Admin actions (PBI 15, 18, 19). Each checks the rules in lib/userAdmin.ts and throws if not allowed.
  /** Adds a user (required fields, unique email) and returns them. */
  addUser: (user: NewUser) => User
  updatePermissions: (userId: string, permissions: Permission[], context: AdminActionContext) => void
  /** Deletes a user: they can no longer sign in, and their name stays on SOP history. */
  deleteUser: (userId: string, context: AdminActionContext) => void
}

export const UsersContext = createContext<UsersStore | null>(null)

/** Access the shared users store. Must be used inside <UsersProvider>. */
export function useUsers(): UsersStore {
  const store = useContext(UsersContext)
  if (!store) throw new Error('useUsers must be used inside <UsersProvider>')
  return store
}
