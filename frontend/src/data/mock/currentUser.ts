import type { User } from './types'

/**
 * Sample signed-in user (from the approved design).
 * TODO: Replace with the authenticated user once real authentication exists.
 */
export const currentUser: User = {
  id: 'user-sara',
  name: 'Sara Aljuraybah',
  initials: 'SA',
  departmentId: 'information-technology',
  // Every user is an employee; Sara also has the Author permission.
  permissions: ['author'],
}
