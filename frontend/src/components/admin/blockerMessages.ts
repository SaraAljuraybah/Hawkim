import type { AdminUserDetailsContent } from '../../content/types'
import { statusLabelsEn } from '../../content/status.en'
import { usersEn } from '../../content/users.en'
import type { User } from '../../data/mock/types'
import type { Blocker } from '../../lib/userAdmin'

/**
 * One sentence per reason a change is refused, naming the SOPs that block it.
 * `removing`: about removing a permission ("Reviewer can't be removed: …"), not deleting the user.
 */
export function blockerMessage(
  blocker: Blocker,
  user: User,
  text: AdminUserDetailsContent['blockers'],
  removing: boolean,
): string {
  const cantRemove = (permission: string, reason: string) =>
    removing ? text.cantRemove.replace('{permission}', permission).replace('{reason}', reason) : reason
  switch (blocker.kind) {
    case 'self-delete':
      return text.selfDelete
    case 'self-admin':
      return text.selfAdmin
    case 'last-admin':
      return cantRemove(usersEn.permissions.admin, text.lastAdmin.replace('{name}', user.name))
    case 'in-use':
      return cantRemove(
        usersEn.permissions[blocker.permission],
        text.inUse[blocker.permission]
          .replace('{name}', user.name)
          .replace(
            '{sops}',
            blocker.sops
              .map((sop) =>
                // Reviewers and approvers: with the status, e.g. "SOP-081 (Returned)".
                blocker.permission === 'author'
                  ? sop.code
                  : text.sopWithStatus.replace('{code}', sop.code).replace('{status}', statusLabelsEn[sop.status]),
              )
              .join(', '),
          ),
      )
  }
}
