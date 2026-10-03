import type { SopWorkflowContent } from '../../content/types'
import { getUser } from '../../data/mock/users'
import type { Sop } from '../../data/mock/types'

/** "Noura Alqahtani (Reviewer)": a user's name with their role on this SOP. */
export function personWithRole(sop: Sop, userId: string | undefined, roles: SopWorkflowContent['roles']): string {
  const name = getUser(userId)?.name ?? ''
  const role =
    userId === sop.reviewerId ? roles.reviewer : userId === sop.approverId ? roles.approver : userId === sop.authorId ? roles.author : ''
  return role ? `${name} (${role})` : name
}
