import type { SopWorkflowContent } from '../../content/types'
import { getUser } from '../../data/mock/users'
import { SYSTEM_ACTOR, type Sop } from '../../data/mock/types'
import { isApprover, isCoAuthor, isReviewer } from '../../lib/workflow'

/** A user's role on this SOP, as a label (or '' if they have none). */
export function roleLabel(sop: Sop, userId: string | undefined, roles: SopWorkflowContent['roles']): string {
  if (!userId) return ''
  if (userId === SYSTEM_ACTOR) return ''
  if (userId === sop.authorId) return roles.author
  if (isCoAuthor(sop, userId)) return roles.coAuthor
  if (isReviewer(sop, userId)) return roles.reviewer
  if (isApprover(sop, userId)) return roles.approver
  return ''
}

/** "Noura Alqahtani (Reviewer)": a user's name with their role on this SOP; "System" for automatic steps. */
export function personWithRole(sop: Sop, userId: string | undefined, roles: SopWorkflowContent['roles']): string {
  if (userId === SYSTEM_ACTOR) return roles.system
  const name = getUser(userId)?.name ?? ''
  const role = roleLabel(sop, userId, roles)
  return role ? `${name} (${role})` : name
}
