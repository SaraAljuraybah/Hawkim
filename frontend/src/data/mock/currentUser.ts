import type { User } from './types'
import { users } from './users'

/**
 * Sample signed-in user (from the approved design): Sara, from the sample users.
 * TODO: Replace with the authenticated user once real authentication exists.
 */
export const currentUser: User = users[0]
