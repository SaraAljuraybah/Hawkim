/*
 * English content for saving user administration to the database (services/users.ts).
 */

import type { UsersAdminContent } from './types'

export const usersAdminEn: UsersAdminContent = {
  adding: 'Adding…',
  saving: 'Saving…',
  deleting: 'Deleting…',
  emailTaken: 'This email already has a Hawkim account. Use a different email.',
  departmentUnavailable: 'This department is no longer available. Refresh the page and choose another one.',
  approverQuality: 'Approver is only available in the Quality department. Remove it or choose the Quality department.',
  adminExclusive: 'An Admin can’t have other permissions. Choose Admin alone, or remove it.',
  selfAdmin: 'You can’t remove your own Admin permission.',
  selfDelete: 'You can’t delete your own account.',
  lastAdmin: 'At least one Admin is required. Give someone else Admin first.',
  inUse: 'This permission is still used on SOPs in progress. Finish or reassign that work first.',
  inviteFailed: 'The invitation email couldn’t be sent, so the user wasn’t added. Try again later.',
  banFailed: 'The user was deleted, but their sign-in couldn’t be blocked yet. Delete them again to finish.',
  forbidden: 'Only an active Admin can manage users.',
  conflict: 'Someone else changed this user. Refresh the page and try again.',
  invalid: 'Check the fields and try again.',
  failed: 'The change couldn’t be saved. Check your connection and try again.',
}
