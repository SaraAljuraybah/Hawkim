import { createContext, useContext } from 'react'
import type { Sop, User } from '../data/mock/types'
import type { NewUser } from '../lib/userAdmin'
import type { LoadStatus } from './useLoadAfterSignIn'

/** What the admin actions check against: who is acting, and every SOP (for permissions in use). */
export interface AdminActionContext {
  actorId: string
  sops: Sop[]
}

export interface UsersStore {
  /** Whether the people have been loaded from the database (after sign-in). */
  status: LoadStatus
  /** Every user, deleted ones included (their names stay on SOP history). */
  users: User[]
  /** Users who can use Hawkim (not deleted): lists and pickers. */
  activeUsers: User[]
  /** A user by id, deleted or not (undefined if unknown). */
  getUser: (id: string | undefined) => User | undefined
  /** A user's name for display; "(deleted)" is added for a deleted user. */
  nameOf: (id: string | undefined) => string

  // Admin actions (PBI 15, 18, 19). Each checks the rules in lib/userAdmin.ts and throws if not allowed.
  /**
   * Adds a user for real (required fields, unique email): a sign-in account, their profile and permissions,
   * and an invitation email. Rejects with an AddUserError and adds nothing to the list. `emailSent` is false
   * when only the invitation failed: the user was added. `reactivated`: the email was a deactivated staff
   * member's, who is active again (the same person, with these details) with a new invitation.
   */
  addUser: (user: NewUser) => Promise<{ user: User; emailSent: boolean; reactivated: boolean }>
  /**
   * Changes a user's details and permissions (the same checks as adding, and permissions in use can't
   * be removed). Everything but the email is saved to the database first, all or nothing: if that fails
   * it rejects with a SaveUserError and nothing changes. The email only changes this tab's copy.
   */
  updateUser: (userId: string, user: NewUser, context: AdminActionContext) => Promise<void>
  /**
   * Delete Staff: deactivates a staff member in the database (deactivate_staff). They can no longer use
   * Hawkim, nothing is removed and their name stays on SOP history. The list changes only once the server
   * has done it; rejects with a DeactivateStaffError (nothing changes).
   */
  deleteUser: (userId: string, context: AdminActionContext) => Promise<void>

  // Manage Organization → Admins. The server checks who may do each (services/admins.ts).
  /**
   * Saves an administrator's name and phone, then their email (which changes their sign-in account).
   * Rejects with an AdminActionError (nothing saved) or a ChangeEmailError (the rest was saved).
   */
  updateAdmin: (userId: string, details: AdminDetails) => Promise<void>
  /** Deletes a regular Admin (Super Admin only). Rejects with an AdminActionError. */
  deleteAdmin: (userId: string) => Promise<void>
}

/** What Edit Admin saves; `phone` as typed (+9665XXXXXXXX). */
export interface AdminDetails {
  name: string
  email: string
  phone: string
}

export const UsersContext = createContext<UsersStore | null>(null)

/** Access the shared users store. Must be used inside <UsersProvider>. */
export function useUsers(): UsersStore {
  const store = useContext(UsersContext)
  if (!store) throw new Error('useUsers must be used inside <UsersProvider>')
  return store
}
