import type { User } from '../data/mock/types'

/**
 * Whether a person can be given new work (a reviewer, an approver, a co-author, a Quality Document Controller):
 * active, and not waiting on an invitation (sent, expired or cancelled; see User.invitation). People without an
 * invitation record (added before invitations were tracked) count as activated. The database refuses the
 * others as new reviewers and co-authors too (20261123120000). Never used for history: names, past assignments.
 */
export function isAssignable(user: Pick<User, 'deletedAt'> & Partial<Pick<User, 'invitation'>>): boolean {
  return !user.deletedAt && !user.invitation
}
